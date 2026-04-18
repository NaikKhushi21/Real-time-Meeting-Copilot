import { useCallback, useEffect, useRef, useState } from "react";
import { buildChatMessages, buildDetailMessages } from "../services/promptBuilder";
import { streamChatCompletion } from "../services/apiClient";
import { createId } from "../utils/ids";
import { nowIso } from "../utils/time";
import { sanitizeAssistantText } from "../utils/text";
import { debugError, debugLog } from "../utils/debug";

function parseRetrySeconds(message) {
  const text = String(message || "");
  const secMatch = text.match(/try again in\s*(\d+(?:\.\d+)?)s/i);
  if (secMatch) {
    return Math.max(1, Math.ceil(Number(secMatch[1])));
  }
  const msMatch = text.match(/try again in\s*(\d+(?:\.\d+)?)ms/i);
  if (msMatch) {
    return Math.max(1, Math.ceil(Number(msMatch[1]) / 1000));
  }
  return 0;
}

function formatChatError(error) {
  const raw = String(error?.message || "");
  if (raw.includes("rate_limit_exceeded") || raw.includes("(429)")) {
    const waitSec = parseRetrySeconds(raw);
    if (waitSec) {
      return `I’m temporarily rate-limited. Please retry in about ${waitSec}s.`;
    }
    return "I’m temporarily rate-limited. Please retry in a few seconds.";
  }
  return "I couldn’t complete that response. Please retry.";
}

export function useChatEngine({ settingsRef, transcriptRef }) {
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatRef = useRef(chatMessages);
  const streamBufferRef = useRef("");
  const streamFlushTimerRef = useRef(null);

  const updateChatState = useCallback((nextChat) => {
    chatRef.current = nextChat;
    setChatMessages(nextChat);
  }, []);

  const appendChatMessage = useCallback(
    (message) => {
      const nextChat = [...chatRef.current, message];
      updateChatState(nextChat);
      return nextChat;
    },
    [chatRef, updateChatState]
  );

  const flushStreamBuffer = useCallback((assistantId) => {
    const buffered = streamBufferRef.current;
    if (!buffered) {
      return;
    }
    streamBufferRef.current = "";
    const nextChat = chatRef.current.map((entry) =>
      entry.id === assistantId ? { ...entry, content: `${entry.content}${buffered}` } : entry
    );
    updateChatState(nextChat);
  }, [chatRef, updateChatState]);

  useEffect(() => {
    return () => {
      if (streamFlushTimerRef.current) {
        clearTimeout(streamFlushTimerRef.current);
      }
    };
  }, []);

  // Chat pipeline: append user intent -> stream assistant response into one message.
  const streamAssistant = useCallback(
    async ({ label, messages }) => {
      debugLog("chat", "Starting assistant stream", {
        label,
        messageCount: messages.length
      });
      const assistantId = createId("assistant");
      appendChatMessage({
        id: assistantId,
        role: "assistant",
        label,
        timestamp: nowIso(),
        content: ""
      });

      setIsChatLoading(true);
      try {
        let streamedChars = 0;
        streamBufferRef.current = "";
        if (streamFlushTimerRef.current) {
          clearTimeout(streamFlushTimerRef.current);
          streamFlushTimerRef.current = null;
        }
        await streamChatCompletion({
          apiKey: settingsRef.current.apiKey,
          model: settingsRef.current.chatModel,
          temperature: settingsRef.current.chatTemperature,
          messages,
          onToken: (token) => {
            streamedChars += token.length;
            streamBufferRef.current += token;
            if (!streamFlushTimerRef.current) {
              streamFlushTimerRef.current = setTimeout(() => {
                streamFlushTimerRef.current = null;
                flushStreamBuffer(assistantId);
              }, 50);
            }
          },
          onDone: () => {
            if (streamFlushTimerRef.current) {
              clearTimeout(streamFlushTimerRef.current);
              streamFlushTimerRef.current = null;
            }
            flushStreamBuffer(assistantId);
            const nextChat = chatRef.current.map((entry) => {
              if (entry.id !== assistantId) {
                return entry;
              }
              const clean = sanitizeAssistantText(entry.content);
              return {
                ...entry,
                content: clean || "I couldn’t generate a clean response. Please retry your question."
              };
            });
            updateChatState(nextChat);
            debugLog("chat", "Assistant stream done", {
              label,
              streamedChars
            });
          }
        });
      } catch (error) {
        if (streamFlushTimerRef.current) {
          clearTimeout(streamFlushTimerRef.current);
          streamFlushTimerRef.current = null;
        }
        flushStreamBuffer(assistantId);
        debugError("chat", "Assistant stream failed", {
          label,
          error: error.message
        });
        const nextChat = chatRef.current.map((entry) => {
          if (entry.id !== assistantId) {
            return entry;
          }

          const sanitized = sanitizeAssistantText(entry.content);
          return {
            ...entry,
            content: sanitized || formatChatError(error)
          };
        });
        updateChatState(nextChat);
      } finally {
        streamBufferRef.current = "";
        setIsChatLoading(false);
      }
    },
    [appendChatMessage, chatRef, flushStreamBuffer, settingsRef, updateChatState]
  );

  const handleSuggestionClick = useCallback(
    async (suggestion) => {
      if (!settingsRef.current.apiKey || isChatLoading) {
        return;
      }
      debugLog("chat", "Suggestion selected", {
        type: suggestion.type
      });

      appendChatMessage({
        id: createId("user"),
        role: "user",
        label: suggestion.type,
        timestamp: nowIso(),
        content: suggestion.preview
      });

      const messages = buildDetailMessages({
        settings: settingsRef.current,
        transcriptChunks: transcriptRef.current,
        chatMessages: chatRef.current,
        selectedSuggestion: suggestion
      });

      await streamAssistant({
        label: "detailed_answer",
        messages
      });
    },
    [appendChatMessage, chatRef, isChatLoading, settingsRef, streamAssistant, transcriptRef]
  );

  const handleUserQuestion = useCallback(
    async (text) => {
      if (!settingsRef.current.apiKey || isChatLoading) {
        return;
      }
      debugLog("chat", "User question sent", {
        chars: text.length
      });

      const messages = buildChatMessages({
        settings: settingsRef.current,
        transcriptChunks: transcriptRef.current,
        chatMessages: chatRef.current,
        userText: text
      });

      appendChatMessage({
        id: createId("user"),
        role: "user",
        label: "question",
        timestamp: nowIso(),
        content: text
      });

      await streamAssistant({
        label: "response",
        messages
      });
    },
    [appendChatMessage, chatRef, isChatLoading, settingsRef, streamAssistant, transcriptRef]
  );

  return {
    chatMessages,
    isChatLoading,
    handleSuggestionClick,
    handleUserQuestion
  };
}

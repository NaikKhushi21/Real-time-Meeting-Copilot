import { memo, useEffect, useRef, useState } from "react";
import Panel from "../layout/Panel";
import ChatMessage from "./ChatMessage";
import { useAutoScroll } from "../../hooks/useAutoScroll";

function ChatPanel({ chatMessages, isChatLoading, onSubmitQuestion }) {
  const [input, setInput] = useState("");
  const messagesRef = useRef(null);
  const previousCountRef = useRef(chatMessages.length);
  const previousLastIdRef = useRef(chatMessages[chatMessages.length - 1]?.id || null);
  useAutoScroll(messagesRef, `${chatMessages.length}-${isChatLoading}`);
  const lastMessage = chatMessages[chatMessages.length - 1] || null;
  const lastMessageId = lastMessage?.id || null;
  const lastMessageContentLength = lastMessage?.content?.length || 0;
  const isStreamingAssistantAnswer =
    Boolean(isChatLoading) && lastMessage?.role === "assistant";

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    // Always follow user question/suggestion insertion and live assistant streaming.
    const countIncreased = chatMessages.length > previousCountRef.current;
    const lastMessageChanged = lastMessageId !== previousLastIdRef.current;
    if (countIncreased || lastMessageChanged || isStreamingAssistantAnswer) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: isStreamingAssistantAnswer ? "auto" : "smooth"
      });
    }

    previousCountRef.current = chatMessages.length;
    previousLastIdRef.current = lastMessageId;
  }, [
    chatMessages.length,
    isStreamingAssistantAnswer,
    lastMessageContentLength,
    lastMessageId
  ]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!input.trim() || isChatLoading) {
      return;
    }

    const text = input.trim();
    setInput("");
    await onSubmitQuestion(text);
  };

  return (
    <Panel title="3. Chat (Detailed Answers)" rightLabel="session-only" className="panel-scroll">
      <p className="helper-text">
        Clicking a suggestion adds it here and requests a longer-form detailed answer.
      </p>

      <div ref={messagesRef} className="scroll-region chat-list">
        {chatMessages.length ? (
          chatMessages.map((message) => <ChatMessage key={message.id} message={message} />)
        ) : (
          <p className="empty-text">Click a suggestion or ask a question directly.</p>
        )}
      </div>

      <form className="chat-input-row" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask anything..."
          disabled={isChatLoading}
        />
        <button type="submit" disabled={isChatLoading}>
          {isChatLoading ? "..." : "Send"}
        </button>
      </form>
    </Panel>
  );
}

export default memo(ChatPanel);

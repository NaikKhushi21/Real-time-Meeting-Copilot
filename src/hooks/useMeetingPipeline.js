import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS } from "../app/defaults";
import { useRecorder } from "./useRecorder";
import { formatTime, nowIso } from "../utils/time";
import { createId } from "../utils/ids";
import { appendTranscriptChunk } from "../utils/transcript";
import { buildSuggestionPayload } from "../services/promptBuilder";
import { generateSuggestions, transcribeChunk } from "../services/apiClient";
import {
  analyzeSemanticChange,
  applySuggestionNoveltyGuard,
  buildSuggestionPolicyContext,
  buildRollingMeetingMemory,
  chooseSuggestionTypeTargets,
  getLatestQuestionContext,
  transcriptWordCount
} from "../services/suggestionIntelligence";
import { debugError, debugLog, debugWarn } from "../utils/debug";

function transcriptCharCount(chunks) {
  return (chunks || []).reduce((sum, chunk) => sum + String(chunk?.text || "").length, 0);
}

function hasTimelinessCue(transcriptChunks) {
  const latest = String(transcriptChunks?.[transcriptChunks.length - 1]?.text || "");
  if (!latest) {
    return false;
  }
  if (latest.includes("?")) {
    return true;
  }
  return /\b(decide|decision|next step|risk|blocker|timeline|owner|budget|cost|latency|priority|tradeoff|should we|can we)\b/i.test(latest);
}

function latestCueSignature(transcriptChunks) {
  const latestQuestion = getLatestQuestionContext(transcriptChunks);
  if (latestQuestion) {
    return `q:${latestQuestion.toLowerCase()}`;
  }
  const latest = String(transcriptChunks?.[transcriptChunks.length - 1]?.text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!latest) {
    return "";
  }
  return `s:${latest.slice(0, 140)}`;
}

export function useMeetingPipeline() {
  const [settings, setSettings] = useState({
    ...DEFAULT_SETTINGS,
    apiKey: ""
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [transcriptChunks, setTranscriptChunks] = useState([]);
  const [suggestionBatches, setSuggestionBatches] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pipelineError, setPipelineError] = useState("");
  const [refreshCountdown, setRefreshCountdown] = useState(DEFAULT_SETTINGS.suggestionIntervalMaxSec);
  const [suggestionDeadlineMs, setSuggestionDeadlineMs] = useState(null);

  const settingsRef = useRef(settings);
  const transcriptRef = useRef(transcriptChunks);
  const batchesRef = useRef(suggestionBatches);

  const transcribeCounterRef = useRef(0);
  const refreshingRef = useRef(false);
  const suggestionTimerRef = useRef(null);
  const lastSuggestionSignatureRef = useRef([]);
  const lastSuggestedTranscriptCountRef = useRef(0);
  const lastSuggestedTranscriptCharCountRef = useRef(0);
  const lastSuggestionAtMsRef = useRef(0);
  const lastSuggestionRequestAtMsRef = useRef(0);
  const lastRealtimeCueSignatureRef = useRef("");
  const suggestionCooldownUntilRef = useRef(0);

  settingsRef.current = settings;
  transcriptRef.current = transcriptChunks;
  batchesRef.current = suggestionBatches;

  const nextSuggestionDelaySec = useCallback((settingsInput = settingsRef.current) => {
    const min = Math.max(10, Number(settingsInput.suggestionIntervalMinSec) || 15);
    const max = Math.max(min, Number(settingsInput.suggestionIntervalMaxSec) || 30);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }, []);

  function normalizeSettings(input) {
    const transcriptIntervalSec = Number(input.transcriptIntervalSec);
    const suggestionIntervalMinSec = Number(input.suggestionIntervalMinSec);
    const suggestionIntervalMaxSec = Number(input.suggestionIntervalMaxSec);
    const realtimeRefreshMinGapSec = Number(input.realtimeRefreshMinGapSec);
    const suggestionContextMaxAgeSec = Number(input.suggestionContextMaxAgeSec);
    const suggestionContextChunks = Number(input.suggestionContextChunks);
    const detailContextChunks = Number(input.detailContextChunks);
    const chatContextMessages = Number(input.chatContextMessages);
    const memoryContextChunks = Number(input.memoryContextChunks);
    const minimumSuggestionWords = Number(input.minimumSuggestionWords);
    const semanticWindowChunks = Number(input.semanticWindowChunks);
    const semanticChangeThreshold = Number(input.semanticChangeThreshold);
    const noveltyHistoryBatches = Number(input.noveltyHistoryBatches);
    const suggestionTemperature = Number(input.suggestionTemperature);
    const chatTemperature = Number(input.chatTemperature);

    const normalizedTranscriptSec = Number.isFinite(transcriptIntervalSec)
      ? Math.min(20, Math.max(3, transcriptIntervalSec))
      : DEFAULT_SETTINGS.transcriptIntervalSec;

    const minSecBase = Number.isFinite(suggestionIntervalMinSec)
      ? Math.min(45, Math.max(10, suggestionIntervalMinSec))
      : DEFAULT_SETTINGS.suggestionIntervalMinSec;
    const maxSecBase = Number.isFinite(suggestionIntervalMaxSec)
      ? Math.min(60, Math.max(10, suggestionIntervalMaxSec))
      : DEFAULT_SETTINGS.suggestionIntervalMaxSec;

    const normalizedMinSec = Math.min(minSecBase, maxSecBase);
    const normalizedMaxSec = Math.max(minSecBase, maxSecBase);
    const normalizedRealtimeRefreshMinGapSec = Number.isFinite(realtimeRefreshMinGapSec)
      ? Math.min(30, Math.max(6, realtimeRefreshMinGapSec))
      : DEFAULT_SETTINGS.realtimeRefreshMinGapSec;
    const normalizedSuggestionContextMaxAgeSec = Number.isFinite(suggestionContextMaxAgeSec)
      ? Math.min(600, Math.max(60, suggestionContextMaxAgeSec))
      : DEFAULT_SETTINGS.suggestionContextMaxAgeSec;
    const normalizedMemoryContextChunks = Number.isFinite(memoryContextChunks)
      ? Math.min(120, Math.max(12, memoryContextChunks))
      : DEFAULT_SETTINGS.memoryContextChunks;
    const normalizedSemanticWindowChunks = Number.isFinite(semanticWindowChunks)
      ? Math.min(40, Math.max(6, semanticWindowChunks))
      : DEFAULT_SETTINGS.semanticWindowChunks;
    const normalizedMinimumSuggestionWords = Number.isFinite(minimumSuggestionWords)
      ? Math.min(80, Math.max(8, minimumSuggestionWords))
      : DEFAULT_SETTINGS.minimumSuggestionWords;
    const normalizedSemanticChangeThreshold = Number.isFinite(semanticChangeThreshold)
      ? Math.min(0.6, Math.max(0.05, semanticChangeThreshold))
      : DEFAULT_SETTINGS.semanticChangeThreshold;
    const normalizedNoveltyHistoryBatches = Number.isFinite(noveltyHistoryBatches)
      ? Math.min(12, Math.max(2, noveltyHistoryBatches))
      : DEFAULT_SETTINGS.noveltyHistoryBatches;
    const normalizedSuggestionContextChunks = Number.isFinite(suggestionContextChunks)
      ? Math.min(24, Math.max(1, suggestionContextChunks))
      : DEFAULT_SETTINGS.suggestionContextChunks;
    const normalizedDetailContextChunks = Number.isFinite(detailContextChunks)
      ? Math.min(40, Math.max(1, detailContextChunks))
      : DEFAULT_SETTINGS.detailContextChunks;
    const normalizedChatContextMessages = Number.isFinite(chatContextMessages)
      ? Math.min(20, Math.max(1, chatContextMessages))
      : DEFAULT_SETTINGS.chatContextMessages;
    const normalizedSuggestionTemperature = Number.isFinite(suggestionTemperature)
      ? Math.min(1, Math.max(0, suggestionTemperature))
      : DEFAULT_SETTINGS.suggestionTemperature;
    const normalizedChatTemperature = Number.isFinite(chatTemperature)
      ? Math.min(1, Math.max(0, chatTemperature))
      : DEFAULT_SETTINGS.chatTemperature;
    const promptInput = input?.prompts || {};
    const normalizedPrompts = {
      suggestions: String(promptInput.suggestions || "").trim() || DEFAULT_SETTINGS.prompts.suggestions,
      detailedAnswer: String(promptInput.detailedAnswer || "").trim() || DEFAULT_SETTINGS.prompts.detailedAnswer,
      chat: String(promptInput.chat || "").trim() || DEFAULT_SETTINGS.prompts.chat
    };

    return {
      ...DEFAULT_SETTINGS,
      ...input,
      prompts: normalizedPrompts,
      transcriptIntervalSec: normalizedTranscriptSec,
      suggestionIntervalMinSec: normalizedMinSec,
      suggestionIntervalMaxSec: normalizedMaxSec,
      realtimeRefreshMinGapSec: normalizedRealtimeRefreshMinGapSec,
      suggestionContextMaxAgeSec: normalizedSuggestionContextMaxAgeSec,
      suggestionContextChunks: normalizedSuggestionContextChunks,
      detailContextChunks: normalizedDetailContextChunks,
      chatContextMessages: normalizedChatContextMessages,
      minimumSuggestionWords: normalizedMinimumSuggestionWords,
      memoryContextChunks: normalizedMemoryContextChunks,
      semanticWindowChunks: normalizedSemanticWindowChunks,
      semanticChangeThreshold: normalizedSemanticChangeThreshold,
      noveltyHistoryBatches: normalizedNoveltyHistoryBatches,
      suggestionTemperature: normalizedSuggestionTemperature,
      chatTemperature: normalizedChatTemperature
    };
  }

  const clearSuggestionTimer = useCallback(() => {
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
    setSuggestionDeadlineMs(null);
  }, []);

  const refreshSuggestions = useCallback(async ({
    transcriptInput = transcriptRef.current,
    force = false,
    bypassMinGap = false
  } = {}) => {
    if (!settingsRef.current.apiKey) {
      setPipelineError("Add your Groq API key in Settings.");
      return;
    }
    if (!transcriptInput.length || refreshingRef.current) {
      debugWarn("pipeline", "Suggestion refresh skipped", {
        hasTranscript: Boolean(transcriptInput.length),
        refreshing: refreshingRef.current
      });
      return;
    }

    // When Groq returns 429, pause suggestion calls until the advised retry window.
    const cooldownRemainingMs = Math.max(
      0,
      suggestionCooldownUntilRef.current - Date.now()
    );
    if (cooldownRemainingMs > 0) {
      const cooldownSec = Math.ceil(cooldownRemainingMs / 1000);
      const message = `Suggestions paused by rate limit. Retry in ~${cooldownSec}s.`;
      debugWarn("pipeline", "Suggestion refresh skipped (cooldown)", {
        cooldownSec,
        force
      });
      setPipelineError(message);
      return;
    }

    const minGapSec = Math.max(
      6,
      Number(settingsRef.current.realtimeRefreshMinGapSec) || DEFAULT_SETTINGS.realtimeRefreshMinGapSec
    );
    const sinceLastSuggestionMs = lastSuggestionAtMsRef.current
      ? Date.now() - lastSuggestionAtMsRef.current
      : Number.POSITIVE_INFINITY;
    if (!bypassMinGap && sinceLastSuggestionMs < minGapSec * 1000 && batchesRef.current.length) {
      debugLog("pipeline", "Suggestion refresh skipped (min gap guard)", {
        sinceLastSuggestionMs,
        minGapSec,
        force
      });
      return;
    }

    const semanticWindowChunks = Math.max(
      6,
      Number(settingsRef.current.semanticWindowChunks) || DEFAULT_SETTINGS.semanticWindowChunks
    );
    const minimumSuggestionWords = Math.max(
      8,
      Number(settingsRef.current.minimumSuggestionWords) || DEFAULT_SETTINGS.minimumSuggestionWords
    );
    const recentWordCount = transcriptWordCount(
      transcriptInput,
      settingsRef.current.suggestionContextChunks || DEFAULT_SETTINGS.suggestionContextChunks
    );
    if (!force && recentWordCount < minimumSuggestionWords) {
      debugLog("pipeline", "Suggestion refresh skipped (low context words)", {
        recentWordCount,
        minimumSuggestionWords
      });
      return;
    }

    const semanticThreshold =
      Number(settingsRef.current.semanticChangeThreshold) || DEFAULT_SETTINGS.semanticChangeThreshold;
    const semantic = analyzeSemanticChange({
      transcriptChunks: transcriptInput,
      previousSignature: lastSuggestionSignatureRef.current,
      windowChunks: semanticWindowChunks,
      threshold: semanticThreshold
    });
    const transcriptChars = transcriptCharCount(transcriptInput);
    const transcriptCharDelta = transcriptChars - lastSuggestedTranscriptCharCountRef.current;
    const hasNewTranscript =
      transcriptInput.length > lastSuggestedTranscriptCountRef.current
      || transcriptCharDelta >= 48;
    const nowMs = Date.now();
    const msSinceLastSuggestion = lastSuggestionAtMsRef.current
      ? nowMs - lastSuggestionAtMsRef.current
      : Number.POSITIVE_INFINITY;
    const maxIntervalSec = Number(settingsRef.current.suggestionIntervalMaxSec)
      || DEFAULT_SETTINGS.suggestionIntervalMaxSec;
    const stalenessMs = Math.min(60, Math.max(30, maxIntervalSec + 10)) * 1000;
    const forceTimelyRefresh = hasNewTranscript
      && (msSinceLastSuggestion >= stalenessMs || hasTimelinessCue(transcriptInput));

    if (
      !force
      && batchesRef.current.length
      && (
        !hasNewTranscript
        || (!semantic.isMaterialChange && !forceTimelyRefresh)
      )
    ) {
      debugLog("pipeline", "Suggestion refresh skipped (low semantic delta)", {
        hasNewTranscript,
        transcriptChars,
        msSinceLastSuggestion,
        forceTimelyRefresh,
        semanticDelta: Number(semantic.delta.toFixed(3)),
        threshold: semanticThreshold
      });
      return;
    }

    refreshingRef.current = true;
    lastSuggestionRequestAtMsRef.current = Date.now();
    setIsRefreshing(true);
    setPipelineError("");

    try {
      const meetingMemorySummary = buildRollingMeetingMemory({
        transcriptChunks: transcriptInput,
        maxChunks: Math.max(
          12,
          Number(settingsRef.current.memoryContextChunks) || DEFAULT_SETTINGS.memoryContextChunks
        )
      });
      debugLog("pipeline", "Refreshing suggestions", {
        transcriptLines: transcriptInput.length,
        semanticDelta: Number(semantic.delta.toFixed(3)),
        semanticMaterial: semantic.isMaterialChange
      });
      const payload = buildSuggestionPayload({
        apiKey: settingsRef.current.apiKey,
        settings: settingsRef.current,
        transcriptChunks: transcriptInput,
        suggestionBatches: batchesRef.current,
        meetingMemorySummary,
        meetingPolicyContext: buildSuggestionPolicyContext({
          transcriptChunks: transcriptInput,
          suggestionBatches: batchesRef.current,
          semanticDelta: semantic.delta
        })
      });
      const { suggestions } = await generateSuggestions(payload);
      const targetTypes = chooseSuggestionTypeTargets({
        transcriptChunks: transcriptInput,
        suggestionBatches: batchesRef.current
      });
      const latestQuestionText = getLatestQuestionContext(transcriptInput);
      const filteredSuggestions = applySuggestionNoveltyGuard({
        suggestions,
        previousBatches: batchesRef.current,
        transcriptChunks: transcriptInput,
        latestQuestionText,
        targetTypes,
        allowRepeats: semantic.isMaterialChange,
        historyBatches: Math.max(
          2,
          Number(settingsRef.current.noveltyHistoryBatches) || DEFAULT_SETTINGS.noveltyHistoryBatches
        )
      });

      const timestamp = nowIso();
      const batch = {
        id: createId("batch"),
        timestamp,
        time: formatTime(timestamp),
        suggestions: filteredSuggestions.map((item) => ({
          id: createId("suggestion"),
          type: item.type,
          preview: item.preview,
          why: item.why
        }))
      };

      batchesRef.current = [batch, ...batchesRef.current];
      lastSuggestionSignatureRef.current = semantic.signature;
      lastSuggestedTranscriptCountRef.current = transcriptInput.length;
      lastSuggestedTranscriptCharCountRef.current = transcriptCharCount(transcriptInput);
      lastSuggestionAtMsRef.current = Date.now();
      startTransition(() => {
        setSuggestionBatches((prev) => [batch, ...prev]);
      });
      debugLog("pipeline", "Suggestion batch added", {
        suggestionCount: batch.suggestions.length,
        totalBatches: batchesRef.current.length
      });
    } catch (error) {
      if (error?.status === 429) {
        const retryAfterMs = Math.max(1_000, Number(error.retryAfterMs) || 30_000);
        suggestionCooldownUntilRef.current = Date.now() + retryAfterMs;
        const cooldownSec = Math.ceil(retryAfterMs / 1000);
        setPipelineError(`Suggestion model rate-limited. Auto retry in ~${cooldownSec}s.`);
        debugWarn("pipeline", "Suggestion rate-limited", {
          retryAfterMs
        });
      }
      debugError("pipeline", "Suggestion refresh failed", { error: error.message });
      if (error?.status !== 429) {
        setPipelineError(error.message || "Could not refresh suggestions.");
      }
    } finally {
      refreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  // Audio chunk pipeline: transcribe -> append transcript -> optional auto refresh.
  const handleRecorderChunk = useCallback(
    async (audioBlob, { reason, windowStartIso, windowEndIso }) => {
      if (!settingsRef.current.apiKey) {
        setPipelineError("Add your Groq API key in Settings before recording.");
        return;
      }

      transcribeCounterRef.current += 1;
      setIsTranscribing(true);
      setPipelineError("");

      try {
        debugLog("pipeline", "Received recorder chunk", {
          reason,
          size: audioBlob.size,
          mimeType: audioBlob.type,
          windowStartIso,
          windowEndIso
        });
        const text = await transcribeChunk({
          apiKey: settingsRef.current.apiKey,
          model: settingsRef.current.transcriptionModel,
          audioBlob
        });

        let transcriptForSuggestions = transcriptRef.current;
        if (text.trim()) {
          const previousChunks = transcriptRef.current;
          transcriptForSuggestions = appendTranscriptChunk({
            existingChunks: previousChunks,
            text,
            windowStartIso,
            windowEndIso
          });
          if (transcriptForSuggestions === previousChunks) {
            debugWarn("pipeline", "Ignored low-signal transcription chunk", {
              rawTextLength: text.length
            });
            return;
          }
          transcriptRef.current = transcriptForSuggestions;
          startTransition(() => {
            setTranscriptChunks(transcriptForSuggestions);
          });
          const appendedLines = Math.max(0, transcriptForSuggestions.length - previousChunks.length);
          const mergedIntoPrevious =
            Boolean(previousChunks.length) && transcriptForSuggestions.length === previousChunks.length;
          debugLog("pipeline", "Transcript entries appended", {
            rawTextLength: text.length,
            newEntries: appendedLines,
            mergedIntoPrevious,
            totalEntries: transcriptForSuggestions.length
          });
        } else {
          debugWarn("pipeline", "Empty transcription text for chunk", {
            reason
          });
        }

        // Produce the first suggestion batch as soon as we have transcript context.
        if (!batchesRef.current.length && transcriptForSuggestions.length) {
          await refreshSuggestions({
            transcriptInput: transcriptForSuggestions
          });
        } else if (batchesRef.current.length) {
          const minGapSec = Math.max(
            6,
            Number(settingsRef.current.realtimeRefreshMinGapSec) || DEFAULT_SETTINGS.realtimeRefreshMinGapSec
          );
          const msSinceLastRequest = Date.now() - lastSuggestionRequestAtMsRef.current;
          const cueSignature = latestCueSignature(transcriptForSuggestions);
          const shouldRealtimeRefresh =
            hasTimelinessCue(transcriptForSuggestions)
            && msSinceLastRequest >= minGapSec * 1000
            && cueSignature
            && cueSignature !== lastRealtimeCueSignatureRef.current;
          if (shouldRealtimeRefresh) {
            debugLog("pipeline", "Realtime cue detected; forcing suggestion refresh", {
              msSinceLastRequest,
              minGapSec,
              cueSignature
            });
            lastRealtimeCueSignatureRef.current = cueSignature;
            await refreshSuggestions({
              transcriptInput: transcriptForSuggestions,
              force: true
            });
          }
        }
      } catch (error) {
        debugError("pipeline", "Transcription failed", { error: error.message });
        setPipelineError(error.message || "Transcription failed.");
      } finally {
        transcribeCounterRef.current -= 1;
        if (transcribeCounterRef.current <= 0) {
          setIsTranscribing(false);
        }
      }
    },
    [refreshSuggestions]
  );

  const recorder = useRecorder({
    chunkMs: settings.transcriptIntervalSec * 1000,
    firstChunkMs: Math.min(4_000, settings.transcriptIntervalSec * 1000),
    onChunk: handleRecorderChunk
  });

  const scheduleNextSuggestionRefresh = useCallback(
    (delaySec) => {
      clearSuggestionTimer();
      if (!recorder.isRecording) {
        return;
      }

      const baseDelay = delaySec ?? nextSuggestionDelaySec();
      const cooldownSec = Math.ceil(
        Math.max(0, suggestionCooldownUntilRef.current - Date.now()) / 1000
      );
      const delay = Math.max(baseDelay, cooldownSec);
      setRefreshCountdown(delay);
      const deadline = Date.now() + delay * 1000;
      setSuggestionDeadlineMs(deadline);
      debugLog("pipeline", "Scheduled suggestion refresh", { delaySec: delay });

      suggestionTimerRef.current = setTimeout(async () => {
        await refreshSuggestions();
        scheduleNextSuggestionRefresh();
      }, delay * 1000);
    },
    [clearSuggestionTimer, nextSuggestionDelaySec, recorder.isRecording, refreshSuggestions]
  );

  useEffect(() => {
    if (!recorder.isRecording || !suggestionDeadlineMs) {
      return undefined;
    }

    const updateCountdown = () => {
      const remainingSec = Math.max(
        0,
        Math.ceil((suggestionDeadlineMs - Date.now()) / 1000)
      );
      setRefreshCountdown(remainingSec);
    };

    updateCountdown();
    const id = setInterval(updateCountdown, 1000);

    return () => clearInterval(id);
  }, [
    recorder.isRecording,
    suggestionDeadlineMs
  ]);

  useEffect(() => {
    if (!recorder.isRecording) {
      clearSuggestionTimer();
      setRefreshCountdown(nextSuggestionDelaySec(settings));
      debugLog("pipeline", "Recorder stopped; cleared suggestion timer");
      return undefined;
    }

    scheduleNextSuggestionRefresh();
    return clearSuggestionTimer;
  }, [
    clearSuggestionTimer,
    nextSuggestionDelaySec,
    recorder.isRecording,
    scheduleNextSuggestionRefresh,
    settings.suggestionIntervalMaxSec,
    settings.suggestionIntervalMinSec
  ]);

  const toggleRecording = useCallback(async () => {
    if (!settingsRef.current.apiKey) {
      setPipelineError("Add your Groq API key in Settings before recording.");
      setIsSettingsOpen(true);
      return;
    }

    if (recorder.isRecording) {
      await recorder.stop();
      return;
    }

    await recorder.start();
  }, [recorder]);

  const manualRefresh = useCallback(async () => {
    if (!settingsRef.current.apiKey || isRefreshing) {
      return;
    }

    if (recorder.isRecording) {
      await recorder.flushChunk("manual");
    }
    await refreshSuggestions({ force: true, bypassMinGap: true });
    // Explicitly restart countdown from a fresh delay after manual refresh.
    const nextDelaySec = nextSuggestionDelaySec();
    scheduleNextSuggestionRefresh(nextDelaySec);
    debugLog("pipeline", "Manual refresh complete");
  }, [
    isRefreshing,
    nextSuggestionDelaySec,
    recorder,
    refreshSuggestions,
    scheduleNextSuggestionRefresh,
    settingsRef
  ]);

  const saveSettings = useCallback((nextSettings) => {
    const normalized = normalizeSettings(nextSettings);
    setSettings(normalized);
    setIsSettingsOpen(false);
    setRefreshCountdown(nextSuggestionDelaySec(normalized));
  }, [nextSuggestionDelaySec]);

  return {
    settings,
    settingsRef,
    isSettingsOpen,
    setIsSettingsOpen,
    saveSettings,
    transcriptChunks,
    transcriptRef,
    suggestionBatches,
    recorder,
    isTranscribing,
    isRefreshing,
    pipelineError,
    refreshCountdown,
    toggleRecording,
    manualRefresh
  };
}

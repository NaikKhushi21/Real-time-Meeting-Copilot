import { formatTime, nowIso } from "../utils/time";

function sanitizeSettingsForExport(settings) {
  const snapshot = {
    ...(settings || {})
  };
  const apiKey = String(snapshot.apiKey || "").trim();
  if (apiKey) {
    const suffix = apiKey.slice(-4);
    snapshot.apiKey = `redacted_${suffix}`;
  } else {
    snapshot.apiKey = "";
  }
  return snapshot;
}

function normalizeTimestamp(value) {
  const parsed = new Date(value || "");
  if (Number.isNaN(parsed.getTime())) {
    return nowIso();
  }
  return parsed.toISOString();
}

function normalizeTranscript(transcriptChunks) {
  return (transcriptChunks || []).map((chunk, index) => {
    const timestamp = normalizeTimestamp(chunk?.timestamp);
    return {
      id: chunk?.id || `transcript_${index + 1}`,
      timestamp,
      time: formatTime(timestamp),
      text: String(chunk?.text || "").trim()
    };
  });
}

function normalizeSuggestionBatches(suggestionBatches) {
  return (suggestionBatches || []).map((batch, batchIndex) => {
    const batchTimestamp = normalizeTimestamp(batch?.timestamp);
    return {
      id: batch?.id || `batch_${batchIndex + 1}`,
      timestamp: batchTimestamp,
      time: formatTime(batchTimestamp),
      suggestions: (batch?.suggestions || []).map((suggestion, suggestionIndex) => ({
        id: suggestion?.id || `suggestion_${batchIndex + 1}_${suggestionIndex + 1}`,
        timestamp: normalizeTimestamp(suggestion?.timestamp || batchTimestamp),
        time: formatTime(suggestion?.timestamp || batchTimestamp),
        type: String(suggestion?.type || "clarification"),
        preview: String(suggestion?.preview || "").trim(),
        why: String(suggestion?.why || "").trim()
      }))
    };
  });
}

function normalizeChat(chatMessages) {
  return (chatMessages || []).map((message, index) => {
    const timestamp = normalizeTimestamp(message?.timestamp);
    return {
      id: message?.id || `chat_${index + 1}`,
      role: message?.role || "assistant",
      label: message?.label || "",
      timestamp,
      time: formatTime(timestamp),
      content: String(message?.content || "").trim()
    };
  });
}

export function downloadSessionExport({
  transcriptChunks,
  suggestionBatches,
  chatMessages,
  settings
}) {
  const payload = {
    exportedAt: new Date().toISOString(),
    settingsSnapshot: sanitizeSettingsForExport(settings),
    transcript: normalizeTranscript(transcriptChunks),
    suggestionBatches: normalizeSuggestionBatches(suggestionBatches),
    chat: normalizeChat(chatMessages)
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `twinmind-session-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

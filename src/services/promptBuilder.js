function clipText(value, maxChars = 220) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function clipBlock(value, maxChars = 2200) {
  const clean = String(value || "").trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function toMs(dateLike) {
  const ms = new Date(dateLike || "").getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function isLowSignalTranscriptLine(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return true;
  }
  if (!/[a-z0-9]/i.test(raw)) {
    return true;
  }
  const normalized = raw.toLowerCase();
  if (
    /^thank you[.!]*$/i.test(raw)
    || /^hello[.!]*$/i.test(raw)
    || normalized.includes("welcome to my channel")
  ) {
    return true;
  }
  if (/\b(\w+)(?:\s+\1){3,}\b/i.test(normalized)) {
    return true;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  const unique = new Set(words);
  if (words.length >= 6 && unique.size / words.length < 0.4) {
    return true;
  }
  if (words.length < 3 && !raw.includes("?")) {
    return true;
  }
  return false;
}

function selectRecentTranscriptLines(chunks, { maxChunks = 6, maxAgeSec = 150 } = {}) {
  const list = (chunks || []).filter((chunk) => !isLowSignalTranscriptLine(chunk?.text));
  if (!list.length) {
    return [];
  }
  const latestMs = toMs(list[list.length - 1]?.timestamp || Date.now());
  const cutoffMs = latestMs - Math.max(60, maxAgeSec) * 1000;
  const ageFiltered = list.filter((chunk) => toMs(chunk?.timestamp) >= cutoffMs);
  const source = ageFiltered.length ? ageFiltered : list;
  return source.slice(-Math.max(1, maxChunks));
}

export function getRecentTranscriptText(chunks, maxChunks, lineCharLimit = 220, maxAgeSec = 150) {
  return selectRecentTranscriptLines(chunks, { maxChunks, maxAgeSec })
    .map((chunk) => `[${chunk.time}] ${clipText(chunk.text, lineCharLimit)}`)
    .join("\n");
}

export function getRecentSuggestionHistory(batches, maxBatches = 3) {
  return (batches || []).slice(0, maxBatches).map((batch) => ({
    time: batch.time,
    suggestions: (batch.suggestions || []).slice(0, 3).map((item) => ({
      type: item.type,
      preview: clipText(item.preview, 120)
    }))
  }));
}

export function buildSuggestionPayload({
  apiKey,
  settings,
  transcriptChunks,
  suggestionBatches,
  meetingMemorySummary = "",
  meetingPolicyContext = ""
}) {
  // Cap each section so suggestion calls stay under tight token budgets.
  const contextMaxAgeSec = Number(settings.suggestionContextMaxAgeSec) || 150;
  const recentTranscript = getRecentTranscriptText(
    transcriptChunks,
    settings.suggestionContextChunks,
    200,
    contextMaxAgeSec
  );
  const immediateExchange = getRecentTranscriptText(
    transcriptChunks,
    2,
    200,
    90
  );
  const transcriptWindow = [
    "Meeting guidance:",
    clipBlock(meetingPolicyContext || "No phase guidance yet.", 1500),
    "",
    "Immediate latest exchange (highest priority):",
    clipBlock(immediateExchange || "No immediate exchange captured yet.", 900),
    "",
    "Rolling meeting memory:",
    clipBlock(meetingMemorySummary || "No stable meeting memory yet.", 2200),
    "",
    "Most recent transcript window:",
    clipBlock(recentTranscript || "No transcript yet.", 1800)
  ].join("\n");

  return {
    apiKey,
    model: settings.suggestionModel,
    temperature: settings.suggestionTemperature,
    prompt: settings.prompts.suggestions,
    transcriptWindow,
    previousBatches: getRecentSuggestionHistory(suggestionBatches)
  };
}

function recentMessages(messages, maxMessages) {
  return messages
    .slice(-maxMessages)
    .map((message) => ({ role: message.role, content: message.content }));
}

export function buildDetailMessages({
  settings,
  transcriptChunks,
  chatMessages,
  selectedSuggestion
}) {
  return [
    { role: "system", content: settings.prompts.detailedAnswer },
    {
      role: "user",
      content: "Formatting rule: respond in plain text only. Do not use markdown symbols, headings, tables, or bullet markers."
    },
    {
      role: "user",
      content: `Clicked suggestion:\n${selectedSuggestion.type}: ${selectedSuggestion.preview}`
    },
    {
      role: "user",
      content: `Recent transcript:\n${getRecentTranscriptText(
        transcriptChunks,
        settings.detailContextChunks,
        220,
        240
      )}`
    },
    ...recentMessages(chatMessages, settings.chatContextMessages)
  ];
}

export function buildChatMessages({
  settings,
  transcriptChunks,
  chatMessages,
  userText
}) {
  return [
    { role: "system", content: settings.prompts.chat },
    {
      role: "user",
      content: "Formatting rule: plain text only. Do not use markdown syntax."
    },
    {
      role: "user",
      content: `Recent transcript:\n${getRecentTranscriptText(
        transcriptChunks,
        settings.detailContextChunks,
        220,
        240
      )}`
    },
    ...recentMessages(chatMessages, settings.chatContextMessages),
    { role: "user", content: userText }
  ];
}

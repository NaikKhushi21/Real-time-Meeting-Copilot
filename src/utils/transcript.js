import { createId } from "./ids";
import { formatTime, nowIso } from "./time";

const CONTINUATION_PREFIXES = [
  "and ",
  "or ",
  "but ",
  "so ",
  "because ",
  "which ",
  "that ",
  "with ",
  "for ",
  "to ",
  "of ",
  "like ",
  "then ",
  "also "
];

function normalizeTranscriptText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTimestamp(windowStartIso, windowEndIso) {
  const fallbackNow = nowIso();
  const endMs = new Date(windowEndIso || fallbackNow).getTime();
  const startMs = new Date(windowStartIso || fallbackNow).getTime();
  const timestampMs = Number.isFinite(endMs) && endMs > 0 ? endMs : startMs;
  return new Date(timestampMs).toISOString();
}

function hasMeaningfulContent(text) {
  return /[a-z0-9]/i.test(text);
}

function isSentenceTerminated(text) {
  return /[.!?]["')\]]?\s*$/u.test(String(text || ""));
}

function startsLikeContinuation(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return false;
  }
  if (/^[,;:)\]\-]/.test(trimmed)) {
    return true;
  }
  if (/^[a-z]/.test(trimmed)) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  return CONTINUATION_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function buildEntry({ text, windowStartIso, windowEndIso }) {
  const timestamp = buildTimestamp(windowStartIso, windowEndIso);
  return {
    id: createId("chunk"),
    timestamp,
    time: formatTime(timestamp),
    text
  };
}

// Build transcript UI rows from chunk text while stitching chunk-boundary fragments.
export function appendTranscriptChunk({
  existingChunks,
  text,
  windowStartIso,
  windowEndIso
}) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized || !hasMeaningfulContent(normalized)) {
    return Array.isArray(existingChunks) ? existingChunks : [];
  }

  const previous = Array.isArray(existingChunks) ? existingChunks : [];
  const currentEntry = buildEntry({
    text: normalized,
    windowStartIso,
    windowEndIso
  });

  if (!previous.length) {
    return [currentEntry];
  }

  const last = previous[previous.length - 1];
  const shouldMergeWithPrevious =
    !isSentenceTerminated(last.text) || startsLikeContinuation(normalized);

  if (!shouldMergeWithPrevious) {
    return [...previous, currentEntry];
  }

  const mergedText = normalizeTranscriptText(`${last.text} ${normalized}`);
  const mergedEntry = {
    ...last,
    timestamp: currentEntry.timestamp,
    time: currentEntry.time,
    text: mergedText
  };

  return [...previous.slice(0, -1), mergedEntry];
}

import { debugError, debugLog } from "../utils/debug";
import { normalizeAudioForTranscription } from "../utils/audio";

function parseRetryAfterMs(value) {
  const text = String(value || "");
  const minSecMatch = text.match(/(\d+)\s*m(?:in)?\s*(\d+(?:\.\d+)?)?\s*s/i);
  if (minSecMatch) {
    const minutes = Number(minSecMatch[1]) || 0;
    const seconds = Number(minSecMatch[2]) || 0;
    return Math.max(0, Math.round((minutes * 60 + seconds) * 1000));
  }
  const msMatch = text.match(/(\d+(?:\.\d+)?)\s*ms/i);
  if (msMatch) {
    return Math.max(0, Math.round(Number(msMatch[1])));
  }
  const secMatch = text.match(/(\d+(?:\.\d+)?)\s*s/i);
  if (secMatch) {
    return Math.max(0, Math.round(Number(secMatch[1]) * 1000));
  }
  return 0;
}

async function parseJsonOrThrow(response) {
  const json = await response.json();
  if (!response.ok) {
    const message = json.error || "Request failed.";
    debugError("api", "Request failed", {
      status: response.status,
      error: message
    });
    const error = new Error(message);
    error.status = response.status;
    error.code = json.code || json.type || null;
    error.retryAfterMs = Number(json.retryAfterMs) || parseRetryAfterMs(message) || 0;
    error.raw = json;
    throw error;
  }
  return json;
}

function extensionForMime(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4")) return "mp4";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  if (type.includes("m4a")) return "m4a";
  return "webm";
}

export async function fetchHealth() {
  const response = await fetch("/api/health");
  return parseJsonOrThrow(response);
}

export async function transcribeChunk({ apiKey, model, audioBlob }) {
  const normalized = await normalizeAudioForTranscription(audioBlob);
  const uploadBlob = normalized.blob || audioBlob;
  const uploadType = uploadBlob?.type || audioBlob?.type || "audio/webm";

  const formData = new FormData();
  formData.append("apiKey", apiKey);
  formData.append("model", model);
  formData.append("audioMime", uploadType);
  const ext = extensionForMime(uploadType);
  formData.append("audio", uploadBlob, `chunk.${ext}`);

  debugLog("transcribe", "Sending chunk", {
    model,
    mimeType: uploadType,
    size: uploadBlob?.size,
    convertedToWav: Boolean(normalized.converted),
    durationSec: normalized.durationSec
  });
  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData
  });

  const json = await parseJsonOrThrow(response);
  debugLog("transcribe", "Chunk response", {
    textLength: (json.text || "").length
  });
  return json.text || "";
}

export async function generateSuggestions(payload) {
  debugLog("suggestions", "Refreshing suggestions", {
    transcriptChars: (payload.transcriptWindow || "").length,
    prevBatchCount: (payload.previousBatches || []).length
  });
  const response = await fetch("/api/suggestions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await parseJsonOrThrow(response);
  debugLog("suggestions", "Refresh complete", {
    count: json?.suggestions?.length || 0,
    meta: json?.meta
  });
  return json;
}

export async function streamChatCompletion({
  apiKey,
  model,
  temperature,
  messages,
  onToken,
  onDone
}) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      model,
      temperature,
      messages
    })
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    debugError("chat", "Stream request failed", {
      status: response.status,
      bodySample: text?.slice?.(0, 280)
    });
    throw new Error(text || "Streaming request failed.");
  }
  debugLog("chat", "Stream opened", { model });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let tokenCount = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const rawEvent of events) {
      const lines = rawEvent.split("\n");
      const eventType = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const dataLine = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
      if (!eventType || !dataLine) {
        continue;
      }

      if (eventType === "token") {
        const data = JSON.parse(dataLine);
        tokenCount += 1;
        onToken(data.token || "");
      }

      if (eventType === "done") {
        debugLog("chat", "Stream done", { tokenCount });
        onDone?.();
        return;
      }

      if (eventType === "error") {
        const data = JSON.parse(dataLine);
        debugError("chat", "Stream emitted error event", {
          error: data.error
        });
        throw new Error(data.error || "Stream failed.");
      }
    }
  }

  debugLog("chat", "Stream closed by server", { tokenCount });
  onDone?.();
}

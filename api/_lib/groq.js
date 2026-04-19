const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`
  };
}

async function parseJsonResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Groq request failed (${response.status}): ${text}`);
    error.status = response.status;
    error.body = text;
    throw error;
  }
  return response.json();
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

export function parseRetryAfterMs(value) {
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

export async function transcribeAudio({
  apiKey,
  model,
  file,
  mimeType
}) {
  const safeMime = String(mimeType || file?.type || "audio/webm").trim();
  const fallbackFileName = `chunk.${extensionForMime(safeMime)}`;
  const uploadFile = new File([file], file?.name || fallbackFileName, { type: safeMime });

  const formData = new FormData();
  formData.append("file", uploadFile);
  formData.append("model", model);

  const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: formData
  });

  const json = await parseJsonResponse(response);
  return json.text || "";
}

export async function createChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.2,
  stream = false,
  responseFormat
}) {
  const payload = {
    model,
    messages,
    temperature,
    stream
  };
  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      ...buildHeaders(apiKey),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (stream) {
    if (!response.ok) {
      const text = await response.text();
      const error = new Error(`Groq stream failed (${response.status}): ${text}`);
      error.status = response.status;
      error.body = text;
      throw error;
    }
    return response.body;
  }

  return parseJsonResponse(response);
}

export function extractTextFromCompletion(json) {
  return json?.choices?.[0]?.message?.content?.trim() || "";
}


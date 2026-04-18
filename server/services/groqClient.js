const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`
  };
}

async function parseJsonResponse(response) {
  if (!response.ok) {
    const text = await response.text();
    console.error("[TwinMind][groq] request failed", {
      status: response.status,
      bodySample: text.slice(0, 280)
    });
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

export async function transcribeAudio({
  apiKey,
  model,
  audioBuffer,
  mimeType = "audio/webm",
  fileName
}) {
  const safeMime = String(mimeType || "audio/webm").trim();
  const fallbackFileName = `chunk.${extensionForMime(safeMime)}`;
  const file = new File([audioBuffer], fileName || fallbackFileName, { type: safeMime });

  console.log("[TwinMind][groq] transcribe request", {
    model,
    mimeType: safeMime,
    bytes: audioBuffer?.length || 0,
    fileType: file.type,
    fileName: file.name
  });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", model);

  const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: formData
  });

  const json = await parseJsonResponse(response);
  console.log("[TwinMind][groq] transcribe response", {
    textLength: String(json.text || "").length
  });
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
  console.log("[TwinMind][groq] chat completion request", {
    model,
    temperature,
    stream,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    responseFormat: responseFormat?.type || null
  });

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
      console.error("[TwinMind][groq] stream failed", {
        status: response.status,
        bodySample: text.slice(0, 280)
      });
      const error = new Error(`Groq stream failed (${response.status}): ${text}`);
      error.status = response.status;
      error.body = text;
      throw error;
    }
    console.log("[TwinMind][groq] stream opened");
    return response.body;
  }

  const json = await parseJsonResponse(response);
  console.log("[TwinMind][groq] chat completion response", {
    contentLength: String(json?.choices?.[0]?.message?.content || "").length
  });
  return json;
}

export function extractTextFromCompletion(json) {
  return json?.choices?.[0]?.message?.content?.trim() || "";
}

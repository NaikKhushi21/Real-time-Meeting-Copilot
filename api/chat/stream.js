import { createChatCompletion } from "../_lib/groq.js";
import { readJsonBody, sendJson, sendMethodNotAllowed } from "../_lib/http.js";

function parseSseDataLines(rawChunk) {
  return rawChunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const body = await readJsonBody(req);
    const { apiKey, model, temperature, messages } = body;

    if (!apiKey) {
      return sendJson(res, 400, { error: "Missing apiKey." });
    }

    console.log("[TwinMind][chat] stream request", {
      model,
      temperature,
      messageCount: Array.isArray(messages) ? messages.length : 0
    });

    const stream = await createChatCompletion({
      apiKey,
      model,
      temperature,
      messages,
      stream: true
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let tokenCount = 0;
    let charCount = 0;

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n");
      buffer = chunks.pop() || "";

      // Forward only model token deltas and ignore keep-alive/noise lines.
      const payloads = parseSseDataLines(chunks.join("\n"));
      for (const payload of payloads) {
        if (payload === "[DONE]") {
          res.write("event: done\ndata: done\n\n");
          res.end();
          return;
        }

        try {
          const parsed = JSON.parse(payload);
          const token = parsed?.choices?.[0]?.delta?.content;
          if (token) {
            tokenCount += 1;
            charCount += token.length;
            res.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
          }
        } catch (_error) {
          // Ignore malformed chunks and keep stream alive.
        }
      }
    }

    console.log("[TwinMind][chat] stream complete", {
      tokenCount,
      charCount
    });

    res.write("event: done\ndata: done\n\n");
    res.end();
  } catch (error) {
    console.error("[TwinMind][chat] stream error", {
      error: error?.message || "Unknown error"
    });

    if (!res.headersSent) {
      return sendJson(res, error?.status || 500, {
        error: error?.message || "Chat stream failed."
      });
    }

    res.write(`event: error\ndata: ${JSON.stringify({ error: error?.message || "Chat stream failed." })}\n\n`);
    res.end();
  }
}

import express from "express";
import { createChatCompletion } from "../services/groqClient.js";

const router = express.Router();

router.post("/stream", async (req, res) => {
  try {
    const { apiKey, model, temperature, messages } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: "Missing apiKey." });
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

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

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
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      const dataLines = lines
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data: "));

      for (const line of dataLines) {
        const payload = line.slice(6);
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
      error: error.message
    });
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

export default router;

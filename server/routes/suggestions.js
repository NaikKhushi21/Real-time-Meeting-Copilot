import express from "express";
import {
  createChatCompletion,
  extractTextFromCompletion
} from "../services/groqClient.js";

const router = express.Router();
const VALID_TYPES = new Set([
  "question_to_ask",
  "talking_point",
  "answer",
  "fact_check",
  "clarification"
]);

function sample(text, max = 220) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

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

function normalizeType(rawType) {
  const type = String(rawType || "").trim().toLowerCase();
  if (VALID_TYPES.has(type)) {
    return type;
  }
  if (type.includes("question")) return "question_to_ask";
  if (type.includes("talk")) return "talking_point";
  if (type.includes("fact")) return "fact_check";
  if (type.includes("answer")) return "answer";
  return "clarification";
}

function normalizeSuggestions(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .slice(0, 3)
    .map((item, index) => ({
      id: `suggestion_${index + 1}`,
      type: normalizeType(item?.type),
      preview: String(item?.preview || "").replace(/\s+/g, " ").trim(),
      why: String(item?.why || "").replace(/\s+/g, " ").trim()
    }))
    .filter((item) => item.preview);
}

function extractJsonCandidate(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return [];
  }

  const stripped = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const candidates = [text, stripped];
  const starts = ["{", "["];
  for (const start of starts) {
    const first = stripped.indexOf(start);
    if (first < 0) {
      continue;
    }
    const tail = stripped.slice(first);
    candidates.push(tail);
  }

  return [...new Set(candidates)];
}

function parseSuggestionJson(rawText) {
  const candidates = extractJsonCandidate(rawText);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        const cleaned = normalizeSuggestions(parsed);
        if (cleaned.length) {
          return cleaned;
        }
      }
      if (Array.isArray(parsed?.suggestions)) {
        const cleaned = normalizeSuggestions(parsed.suggestions);
        if (cleaned.length) {
          return cleaned;
        }
      }
      if (Array.isArray(parsed?.items)) {
        const cleaned = normalizeSuggestions(parsed.items);
        if (cleaned.length) {
          return cleaned;
        }
      }
    } catch (_error) {
      // Try next candidate.
    }
  }
  return [];
}

function buildMessages({ prompt, transcriptWindow, previousBatches }) {
  return [
    { role: "system", content: prompt },
    {
      // Keep schema instructions separate from the dynamic transcript payload.
      role: "user",
      content: [
        "Output contract:",
        "Return valid JSON object exactly in this shape:",
        "{\"suggestions\":[{\"type\":\"question_to_ask|talking_point|answer|fact_check|clarification\",\"preview\":\"...\",\"why\":\"...\"}]}",
        "Rules:",
        "- Exactly 3 suggestions.",
        "- Keep preview <= 140 chars.",
        "- Never repeat prior previews unless transcript meaning materially changed.",
        "- Use fact_check only when transcript includes a concrete claim that needs verification."
      ].join("\n")
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          transcriptWindow,
          previousBatches
        },
        null,
        2
      )
    }
  ];
}

async function requestSuggestions({
  apiKey,
  model,
  temperature,
  prompt,
  transcriptWindow,
  previousBatches
}) {
  const completion = await createChatCompletion({
    apiKey,
    model,
    temperature,
    responseFormat: { type: "json_object" },
    messages: buildMessages({ prompt, transcriptWindow, previousBatches })
  });
  return extractTextFromCompletion(completion);
}

router.post("/", async (req, res) => {
  try {
    const {
      apiKey,
      model,
      temperature,
      prompt,
      transcriptWindow,
      previousBatches
    } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: "Missing apiKey." });
    }
    console.log("[TwinMind][suggestions] request received", {
      model,
      temperature,
      hasPrompt: Boolean(prompt),
      transcriptChars: String(transcriptWindow || "").length,
      previousBatchCount: Array.isArray(previousBatches) ? previousBatches.length : 0
    });

    const firstRawText = await requestSuggestions({
      apiKey,
      model,
      temperature,
      prompt,
      transcriptWindow,
      previousBatches
    });
    console.log("[TwinMind][suggestions] first response", {
      chars: firstRawText.length,
      sample: sample(firstRawText)
    });
    const parsedSuggestions = parseSuggestionJson(firstRawText);
    console.log("[TwinMind][suggestions] first parse result", {
      ok: Boolean(parsedSuggestions.length),
      parsedCount: parsedSuggestions.length
    });

    if (parsedSuggestions.length !== 3) {
      console.error("[TwinMind][suggestions] parse failed (single-call mode)", {
        parsedCount: parsedSuggestions.length,
        sample: sample(firstRawText)
      });
      return res.status(422).json({
        error: "Model response could not be parsed into exactly 3 suggestions.",
        rawText: firstRawText
      });
    }
    const suggestions = parsedSuggestions;

    console.log("[TwinMind][suggestions] success", {
      suggestionTypes: suggestions.map((item) => item.type)
    });
    return res.json({ suggestions });
  } catch (error) {
    console.error("[TwinMind][suggestions] route error", {
      error: error.message
    });
    if (error?.status === 429) {
      const retryAfterMs = parseRetryAfterMs(error?.body || error?.message);
      return res.status(429).json({
        error: error.message || "Suggestion model is rate-limited.",
        code: "rate_limit_exceeded",
        retryAfterMs
      });
    }
    return res.status(500).json({ error: error.message || "Suggestion generation failed." });
  }
});

export default router;

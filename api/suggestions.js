import {
  createChatCompletion,
  extractTextFromCompletion,
  parseRetryAfterMs
} from "./_lib/groq.js";
import { readJsonBody, sendJson, sendMethodNotAllowed } from "./_lib/http.js";

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
  // Also try parsing from first JSON token when model prepends narration.
  const starts = ["{", "["];
  for (const start of starts) {
    const first = stripped.indexOf(start);
    if (first < 0) {
      continue;
    }
    candidates.push(stripped.slice(first));
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
      // Continue trying next parse candidate.
    }
  }
  return [];
}

function buildMessages({ prompt, transcriptWindow, previousBatches }) {
  return [
    { role: "system", content: prompt },
    {
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendMethodNotAllowed(res, ["POST"]);
  }

  try {
    const body = await readJsonBody(req);
    const {
      apiKey,
      model,
      temperature,
      prompt,
      transcriptWindow,
      previousBatches
    } = body;

    if (!apiKey) {
      return sendJson(res, 400, { error: "Missing apiKey." });
    }

    console.log("[TwinMind][suggestions] request received", {
      model,
      temperature,
      hasPrompt: Boolean(prompt),
      transcriptChars: String(transcriptWindow || "").length,
      previousBatchCount: Array.isArray(previousBatches) ? previousBatches.length : 0
    });

    const rawText = await requestSuggestions({
      apiKey,
      model,
      temperature,
      prompt,
      transcriptWindow,
      previousBatches
    });

    console.log("[TwinMind][suggestions] first response", {
      chars: rawText.length,
      sample: sample(rawText)
    });

    const suggestions = parseSuggestionJson(rawText);
    console.log("[TwinMind][suggestions] first parse result", {
      ok: suggestions.length === 3,
      parsedCount: suggestions.length
    });

    if (suggestions.length !== 3) {
      // Enforce assignment rule strictly: every refresh must yield exactly 3.
      console.error("[TwinMind][suggestions] parse failed (single-call mode)", {
        parsedCount: suggestions.length,
        sample: sample(rawText)
      });
      return sendJson(res, 422, {
        error: "Model response could not be parsed into exactly 3 suggestions.",
        rawText
      });
    }

    console.log("[TwinMind][suggestions] success", {
      suggestionTypes: suggestions.map((item) => item.type)
    });
    return sendJson(res, 200, { suggestions });
  } catch (error) {
    console.error("[TwinMind][suggestions] route error", {
      error: error?.message || "Unknown error"
    });

    if (error?.status === 429) {
      const retryAfterMs = parseRetryAfterMs(error?.body || error?.message);
      return sendJson(res, 429, {
        error: error?.message || "Suggestion model is rate-limited.",
        code: "rate_limit_exceeded",
        retryAfterMs
      });
    }

    return sendJson(res, 500, {
      error: error?.message || "Suggestion generation failed."
    });
  }
}

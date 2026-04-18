const STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have", "were", "your",
  "about", "into", "will", "would", "could", "should", "there", "their", "them",
  "they", "then", "than", "what", "when", "where", "which", "while", "been",
  "also", "just", "very", "more", "most", "much", "many", "only", "over", "some",
  "such", "each", "because", "after", "before", "through", "under", "between",
  "across", "around", "today", "tomorrow", "yesterday", "into", "onto", "from",
  "that", "those", "these", "ours", "ourselves", "ours", "it's", "we", "our", "you"
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return 0;
  }
  return normalized.split(" ").filter(Boolean).length;
}

function transcriptText(chunks, maxChunks = 12) {
  return (chunks || [])
    .slice(-maxChunks)
    .map((chunk) => String(chunk?.text || ""))
    .join(" ");
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function topTokens(tokens, maxTokens = 24) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTokens)
    .map(([token]) => token);
}

function jaccardSimilarity(aTokens, bTokens) {
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  if (!aSet.size && !bSet.size) {
    return 1;
  }

  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) {
      intersection += 1;
    }
  }

  const union = aSet.size + bSet.size - intersection;
  return union ? intersection / union : 0;
}

function appendUnique(list, rawValue, maxItems = 3) {
  if (!rawValue || list.length >= maxItems) {
    return;
  }
  const normalized = normalizeText(rawValue);
  if (!normalized) {
    return;
  }
  const signature = normalized.split(" ").slice(0, 10).join(" ");
  const exists = list.some((entry) => entry.signature === signature);
  if (exists) {
    return;
  }
  list.push({ signature, text: rawValue.trim() });
}

function trimPreview(preview, max = 140) {
  const clean = String(preview || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3).trim()}...`;
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function extractQuestionCandidates(text) {
  const raw = String(text || "");
  if (!raw.includes("?")) {
    return [];
  }
  return raw
    .split("?")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${part}?`);
}

function clipLine(value, maxChars = 180) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

export function deriveMeetingPhase({ transcriptChunks, suggestionBatches }) {
  // Lightweight phase classifier to nudge the model toward better suggestion mix.
  const recentText = normalizeText(transcriptText(transcriptChunks, 8));
  const totalWords = transcriptWordCount(transcriptChunks || [], 8);
  const batchCount = Array.isArray(suggestionBatches) ? suggestionBatches.length : 0;

  if (totalWords < 55 || batchCount < 2) {
    return {
      phase: "opening",
      mix: "1 clarification, 1 talking_point, 1 question_to_ask",
      focus: "Establish scope, goals, and audience context."
    };
  }

  const closingTerms = [
    "next step", "next steps", "action item", "owner", "deadline", "wrap up", "summary",
    "to close", "finalize", "ship", "rollout", "timeline"
  ];
  if (includesAny(recentText, closingTerms)) {
    return {
      phase: "closing",
      mix: "1 answer, 1 talking_point, 1 clarification",
      focus: "Convert discussion into concrete decisions and owners."
    };
  }

  const decisionTerms = [
    "decide", "decision", "approved", "choose", "go with", "final", "tradeoff", "option"
  ];
  if (includesAny(recentText, decisionTerms)) {
    return {
      phase: "decision",
      mix: "1 question_to_ask, 1 answer, 1 fact_check or clarification",
      focus: "Stress decision quality, assumptions, and risk."
    };
  }

  return {
    phase: "exploration",
    mix: "1 question_to_ask, 1 talking_point, 1 answer or clarification",
    focus: "Drive concrete use-cases and unblock uncertainty."
  };
}

export function extractVerifiableClaims({ transcriptChunks, maxClaims = 4 }) {
  // Pull candidate claims so fact_check appears only when transcript provides one.
  const recent = (transcriptChunks || []).slice(-10);
  const claims = [];
  const claimPattern = /(\d+[%kmb]?|\$[\d,.]+|last year|this year|today|yesterday|market|users|latency|cost|revenue|outage|sla|uptime|benchmark|study)/i;

  for (const chunk of recent) {
    const raw = String(chunk?.text || "").trim();
    if (!raw || raw.length < 16) {
      continue;
    }
    const lines = raw
      .split(/[.!?]\s+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (claimPattern.test(line)) {
        appendUnique(claims, clipLine(line, 170), maxClaims);
      }
      if (claims.length >= maxClaims) {
        return claims.map((entry) => entry.text);
      }
    }
  }

  return claims.map((entry) => entry.text);
}

export function buildSuggestionPolicyContext({
  transcriptChunks,
  suggestionBatches,
  semanticDelta
}) {
  const phase = deriveMeetingPhase({ transcriptChunks, suggestionBatches });
  const claims = extractVerifiableClaims({ transcriptChunks, maxClaims: 4 });
  const latestBatch = Array.isArray(suggestionBatches) && suggestionBatches.length
    ? suggestionBatches[0]
    : null;
  const recentPreviews = latestBatch
    ? (latestBatch.suggestions || []).map((item) => clipLine(item.preview, 120))
    : [];

  return [
    `Meeting phase: ${phase.phase}`,
    `Phase focus: ${phase.focus}`,
    `Preferred suggestion mix: ${phase.mix}`,
    `Semantic delta from last batch: ${Number(semanticDelta || 0).toFixed(3)}`,
    "Fact-check policy: only output fact_check when a concrete claim from transcript can be verified quickly; otherwise use clarification.",
    `Candidate claims:\n${claims.length ? claims.map((item) => `- ${item}`).join("\n") : "- none identified yet"}`,
    `Most recent batch previews (avoid rephrasing unless context shifted):\n${recentPreviews.length ? recentPreviews.map((item) => `- ${item}`).join("\n") : "- none"}`
  ].join("\n\n");
}

export function getLatestQuestionContext(transcriptChunks) {
  const recent = (transcriptChunks || []).slice(-6);
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const text = String(recent[i]?.text || "").trim();
    if (!text) {
      continue;
    }
    const candidates = extractQuestionCandidates(text);
    if (!candidates.length) {
      continue;
    }
    const best = candidates[candidates.length - 1];
    return clipLine(best, 180);
  }
  return "";
}

function hasQuestionInRecentTranscript(transcriptChunks) {
  const recent = (transcriptChunks || []).slice(-6);
  return recent.some((chunk) => String(chunk?.text || "").includes("?"));
}

export function chooseSuggestionTypeTargets({
  transcriptChunks,
  suggestionBatches
}) {
  const phase = deriveMeetingPhase({ transcriptChunks, suggestionBatches }).phase;
  const claimCount = extractVerifiableClaims({ transcriptChunks, maxClaims: 3 }).length;
  const hasQuestion = hasQuestionInRecentTranscript(transcriptChunks);

  const targets = [];
  if (hasQuestion) {
    targets.push("answer");
  }
  if (claimCount > 0) {
    targets.push("fact_check");
  } else {
    targets.push("clarification");
  }

  if (phase === "opening") {
    targets.push("question_to_ask");
    targets.push("talking_point");
  } else if (phase === "decision") {
    targets.push("question_to_ask");
    targets.push("talking_point");
  } else if (phase === "closing") {
    targets.push("answer");
    targets.push("talking_point");
  } else {
    targets.push("question_to_ask");
    targets.push("talking_point");
  }

  const unique = [];
  for (const type of targets) {
    if (!unique.includes(type)) {
      unique.push(type);
    }
    if (unique.length === 3) {
      break;
    }
  }

  const fallbackOrder = ["question_to_ask", "talking_point", "answer", "clarification", "fact_check"];
  for (const type of fallbackOrder) {
    if (unique.length === 3) {
      break;
    }
    if (!unique.includes(type)) {
      unique.push(type);
    }
  }
  return unique.slice(0, 3);
}

export function buildRollingMeetingMemory({ transcriptChunks, maxChunks = 36 }) {
  const recent = (transcriptChunks || []).slice(-maxChunks);
  const goals = [];
  const decisions = [];
  const openQuestions = [];
  const risks = [];

  for (const chunk of recent) {
    const raw = String(chunk?.text || "").trim();
    if (!raw) {
      continue;
    }
    if (wordCount(raw) < 6) {
      continue;
    }
    const normalized = normalizeText(raw);
    const isQuestion = raw.includes("?")
      || normalized.startsWith("should ")
      || normalized.startsWith("can ")
      || normalized.startsWith("what ")
      || normalized.startsWith("how ")
      || normalized.startsWith("are we ");

    if (isQuestion) {
      appendUnique(openQuestions, raw, 4);
    }
    if (
      normalized.includes("goal")
      || normalized.includes("objective")
      || normalized.includes("we need")
      || normalized.includes("we want")
      || normalized.includes("aim")
      || normalized.includes("success criteria")
    ) {
      appendUnique(goals, raw, 3);
    }
    if (
      normalized.includes("we decided")
      || normalized.includes("decision is")
      || normalized.includes("final decision")
      || normalized.includes("let s go with")
      || normalized.includes("we will")
      || normalized.includes("we ll")
      || normalized.includes("plan is")
    ) {
      appendUnique(decisions, raw, 3);
    }
    if (
      normalized.includes("decid")
      || normalized.includes("agreed")
      || normalized.includes("final")
    ) {
      // Keep weaker decision cues from being over-represented.
      appendUnique(decisions, raw, 2);
    }
    if (
      normalized.includes("risk")
      || normalized.includes("concern")
      || normalized.includes("issue")
      || normalized.includes("blocker")
      || normalized.includes("bottleneck")
      || normalized.includes("failure")
      || normalized.includes("cost")
      || normalized.includes("latency")
    ) {
      appendUnique(risks, raw, 3);
    }
  }

  const render = (label, items) => {
    if (!items.length) {
      return `${label}: none captured yet`;
    }
    const lines = items.map((item) => `- ${item.text}`);
    return `${label}:\n${lines.join("\n")}`;
  };

  return [
    render("Goals", goals),
    render("Decisions", decisions),
    render("Open questions", openQuestions),
    render("Risks", risks)
  ].join("\n\n");
}

export function buildSemanticSignature({ transcriptChunks, windowChunks = 14 }) {
  const text = (transcriptChunks || [])
    .slice(-windowChunks)
    .map((chunk) => chunk.text)
    .join(" ");
  const tokens = tokenize(text);
  return topTokens(tokens, 24);
}

export function analyzeSemanticChange({
  transcriptChunks,
  previousSignature,
  windowChunks = 14,
  threshold = 0.22
}) {
  const signature = buildSemanticSignature({ transcriptChunks, windowChunks });
  if (!previousSignature || !previousSignature.length) {
    return {
      signature,
      delta: 1,
      isMaterialChange: true
    };
  }

  const similarity = jaccardSimilarity(previousSignature, signature);
  const delta = 1 - similarity;
  return {
    signature,
    delta,
    isMaterialChange: delta >= threshold
  };
}

export function transcriptWordCount(chunks, windowChunks = 8) {
  return wordCount(transcriptText(chunks, windowChunks));
}

export function applySuggestionNoveltyGuard({
  suggestions,
  previousBatches,
  transcriptChunks,
  latestQuestionText = "",
  targetTypes = [],
  allowRepeats = false,
  historyBatches = 6
}) {
  const incoming = Array.isArray(suggestions) ? suggestions : [];
  if (!incoming.length) {
    return [];
  }
  const transcriptTokens = tokenize(transcriptText(transcriptChunks, 10));
  const transcriptSet = new Set(transcriptTokens);
  const recentTokens = tokenize(transcriptText(transcriptChunks, 3));
  const recentSet = new Set(recentTokens);
  const latestQuestionTokens = tokenize(latestQuestionText);
  const questionTokenSet = new Set(latestQuestionTokens);
  const scoreSuggestion = (preview) => {
    const tokens = tokenize(preview);
    if (!tokens.length || (!transcriptSet.size && !recentSet.size)) {
      return 0;
    }
    let overlapAll = 0;
    let overlapRecent = 0;
    for (const token of tokens) {
      if (transcriptSet.has(token)) {
        overlapAll += 1;
      }
      if (recentSet.has(token)) {
        overlapRecent += 1;
      }
    }
    const allScore = overlapAll / Math.max(tokens.length, 1);
    const recentScore = overlapRecent / Math.max(tokens.length, 1);
    return allScore * 0.45 + recentScore * 0.55;
  };

  const rankedIncoming = incoming
    .map((item) => ({
      ...item,
      _score: scoreSuggestion(item.preview),
      _targetBoost: targetTypes.includes(String(item.type || "")) ? 0.25 : 0,
      _questionBoost: (() => {
        const type = String(item.type || "");
        if (type !== "answer" || !questionTokenSet.size) {
          return 0;
        }
        const previewTokens = tokenize(item.preview);
        if (!previewTokens.length) {
          return 0;
        }
        let overlap = 0;
        for (const token of previewTokens) {
          if (questionTokenSet.has(token)) {
            overlap += 1;
          }
        }
        const overlapScore = overlap / Math.max(previewTokens.length, 1);
        return overlapScore * 0.4;
      })()
    }))
    .sort((a, b) => (b._score + b._targetBoost + b._questionBoost) - (a._score + a._targetBoost + a._questionBoost));

  const recentHistory = (previousBatches || []).slice(0, historyBatches);
  const historyPreviews = recentHistory
    .flatMap((batch) => batch.suggestions || [])
    .map((item) => item.preview);

  const selected = [];
  const selectedPreviews = [];
  const selectedTypes = [];
  const deferred = [];

  const pushSelection = (item, preview) => {
    selected.push({
      type: String(item.type || "clarification"),
      preview: trimPreview(preview),
      why: String(item.why || "").trim()
    });
    selectedPreviews.push(preview);
    selectedTypes.push(String(item.type || "clarification"));
  };

  for (const item of rankedIncoming) {
    const preview = String(item.preview || "").trim();
    if (!preview) {
      continue;
    }
    if (item._score < 0.12 && !allowRepeats) {
      deferred.push(item);
      continue;
    }

    const isDuplicateInBatch = selectedPreviews.some((existing) => {
      const similarity = jaccardSimilarity(tokenize(existing), tokenize(preview));
      return similarity >= 0.85;
    });
    if (isDuplicateInBatch) {
      deferred.push(item);
      continue;
    }

    let duplicateInHistory = false;
    if (!allowRepeats) {
      duplicateInHistory = historyPreviews.some((existing) => {
        const similarity = jaccardSimilarity(tokenize(existing), tokenize(preview));
        return similarity >= 0.85;
      });
    }

    if (duplicateInHistory) {
      deferred.push(item);
      continue;
    }

    const type = String(item.type || "clarification");
    const hasTypeAlready = selectedTypes.includes(type);
    const needsTypeDiversity = selected.length < 2;
    if (needsTypeDiversity && hasTypeAlready) {
      deferred.push(item);
      continue;
    }

    pushSelection(item, preview);
    if (selected.length === 3) {
      return selected;
    }
  }

  // Soft-fill from lower quality items instead of generating synthetic fallback suggestions.
  for (const item of deferred) {
    const preview = String(item.preview || "").trim();
    if (!preview) {
      continue;
    }
    const duplicate = selectedPreviews.some((existing) => {
      const similarity = jaccardSimilarity(tokenize(existing), tokenize(preview));
      return similarity >= 0.92;
    });
    if (duplicate) {
      continue;
    }
    pushSelection(item, preview);
    if (selected.length === 3) {
      break;
    }
  }

  if (latestQuestionText && !selectedTypes.includes("answer")) {
    const candidate = rankedIncoming.find((item) => {
      if (String(item.type || "") !== "answer") {
        return false;
      }
      const preview = String(item.preview || "").trim();
      if (!preview) {
        return false;
      }
      return !selectedPreviews.some((existing) => {
        const similarity = jaccardSimilarity(tokenize(existing), tokenize(preview));
        return similarity >= 0.9;
      });
    });
    if (candidate && selected.length) {
      const preview = String(candidate.preview || "").trim();
      selected[selected.length - 1] = {
        type: "answer",
        preview: trimPreview(preview),
        why: String(candidate.why || "").trim()
      };
    }
  }

  return selected.slice(0, Math.min(3, incoming.length));
}

// aiTagger.ts — AI-powered auto-tagging (v2.12.0).
//
// v2.11.0 added heuristic auto-tagging (anatomical dictionary).
// v2.12.0 adds LLM-powered tagging that complements the heuristic.
// When an LLM is available (Ollama/OpenRouter configured), the
// heuristic runs first; if it returns < 2 tags, the LLM is asked
// to suggest up to 5 tags based on the flashcard front/back content.
//
// LLM prompt is small and bounded to keep latency low (~200 tokens).
// Falls back gracefully when LLM is unavailable (MOCK_OLLAMA=1, no
// API key, network error).

import { extractTags as extractHeuristic } from "./autoTagger.js";
import { LLMService, type ChatRequest } from "./llm.js";

let _llm: LLMService | null = null;
function getLLM(): LLMService | null {
  if (_llm) return _llm;
  try {
    _llm = new LLMService();
    return _llm;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You are a medical study assistant. Given a flashcard's question (front) and answer (back), suggest 2-5 concise tags from this list ONLY:
- Anatomy structures (e.g. "trocánter", "fémur", "acetábulo")
- Body regions (e.g. "extremidad-superior", "tórax")
- Topics (e.g. "anatomía", "fisiología", "farmacología")
- Clinical (e.g. "fractura", "nervio-radial")
Output JSON array only, no explanation. Examples:
["trocánter-mayor", "manguito-rotador"]
["fármaco", "cardiovascular"]
Return [] if no good tag fits.`;

function parseTagsFromLLM(raw) {
  try {
    // Find JSON array in the response (LLM may add prose)
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t) => typeof t === "string" && t.length > 0 && t.length < 40)
      .slice(0, 5)
      .map((t) => t.toLowerCase().trim());
  } catch {
    return [];
  }
}

/**
 * LLM-powered auto-tagging with heuristic fallback.
 * Returns a merged array: existing → heuristic → LLM (deduped, capped at 6).
 */
export async function aiTagsForFlashcard(
  front,
  back,
  existingTags = [],
  opts: { llmTimeoutMs?: number; maxLlmTags?: number } = {},
) {
  const llmTimeoutMs = opts.llmTimeoutMs ?? 4000;
  const maxLlmTags = opts.maxLlmTags ?? 3;

  // 1. Heuristic first (cheap, deterministic)
  const heuristic = extractHeuristic(`${front} ${back}`, 5);

  // 2. If heuristic gave us enough, skip LLM
  if (heuristic.length >= 2) {
    return mergeTags(existingTags, heuristic, [], 6);
  }

  // 3. Try LLM for richer tags
  let llmTags = [];
  const llm = getLLM();
  // Skip LLM in test/mock environments (MOCK_OLLAMA=1)
  const isMocked = process.env.MOCK_OLLAMA === "1" || process.env.MOCK_OPENROUTER === "1" || process.env.MOCK_LLM === "1";
  if (llm && !isMocked) {
    try {
      const userPrompt = `Front: "${front}"\nBack: "${back}"\nTags:`;
      const req: ChatRequest = {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.2,
      };
      const resp = await Promise.race([
        llm.chat(req),
        new Promise((_, rej) => setTimeout(() => rej(new Error("llm-timeout")), llmTimeoutMs)),
      ]);
      llmTags = parseTagsFromLLM(resp?.content || "").slice(0, maxLlmTags);
    } catch (e) {
      // LLM unavailable / timeout — fall through with heuristic only
    }
  }

  return mergeTags(existingTags, heuristic, llmTags, 6);
}

function mergeTags(existing, heuristic, llm, cap) {
  const seen = new Set();
  const out = [];
  for (const list of [existing, heuristic, llm]) {
    for (const t of list) {
      const norm = String(t).toLowerCase().trim();
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push(norm);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

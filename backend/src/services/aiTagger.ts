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
import { getAIConfig, generateCompletion } from "./aiProviders.js";

const SYSTEM_PROMPT = `You are a medical study assistant. Given a flashcard's question (front) and answer (back), suggest 2-5 concise tags from this list ONLY:
- Anatomy structures (e.g. "trocánter", "fémur", "acetábulo")
- Body regions (e.g. "extremidad-superior", "tórax")
- Topics (e.g. "anatomía", "fisiología", "farmacología")
- Clinical (e.g. "fractura", "nervio-radial")
Output JSON array only, no explanation. Examples:
["trocánter-mayor", "manguito-rotador"]
["fármaco", "cardiovascular"]
Return [] if no good tag fits.`;

function parseTagsFromLLM(raw: string): string[] {
  try {
    // Find JSON array in the response (LLM may add prose)
    const match = raw.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    const arr: unknown = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((t): t is string => typeof t === "string" && t.length > 0 && t.length < 40)
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
  front: string,
  back: string,
  existingTags: string[] = [],
  opts: { llmTimeoutMs?: number; maxLlmTags?: number } = {},
): Promise<string[]> {
  const llmTimeoutMs = opts.llmTimeoutMs ?? 4000;
  const maxLlmTags = opts.maxLlmTags ?? 3;

  // 1. Heuristic first (cheap, deterministic)
  const heuristic = extractHeuristic(`${front} ${back}`, 5);

  // 2. If heuristic gave us enough, skip LLM
  if (heuristic.length >= 2) {
    return mergeTags(existingTags, heuristic, [], 6);
  }

  // 3. Try LLM for richer tags via configured provider (v2.15.0).
  //    Replaces direct LLMService with generateCompletion() so any provider
  //    set in data/ai-config.json (Ollama / OpenRouter / OpenAI) is used.
  let llmTags: string[] = [];
  try {
    const cfg = await getAIConfig();
    if (cfg.provider !== "mock") {
      const userPrompt = `Front: "${front}"\nBack: "${back}"\nTags:`;
      const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
      const resp = await Promise.race([
        generateCompletion(fullPrompt, {
          temperature: 0.2,
          maxTokens: 200,
        }),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error("llm-timeout")), llmTimeoutMs)),
      ]);
      llmTags = parseTagsFromLLM(resp || "").slice(0, maxLlmTags);
    }
  } catch (e) {
    // LLM unavailable / timeout / mock / no provider — fall through
  }

  return mergeTags(existingTags, heuristic, llmTags, 6);
}

function mergeTags(existing: string[], heuristic: string[], llm: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
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

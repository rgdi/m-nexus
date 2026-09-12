// routes/ai_v2.ts — minimal AI endpoints (FASE 4 prep)
// Endpoint style matches the minimal stable server (server.ts v0.62.8):
//   no auth, no DB, no plugins — direct fetch to Ollama + simple JSON parsing.
// Designed to be safe under Node 20.19.4 + tsx (no top-level await, no sqlite).
//
// Endpoints:
//   POST /api/v1/ai/chat          — generic chat with optional RAG snippets
//   POST /api/v1/ai/embeddings    — embeddings via nomic-embed-text (cached)
//   POST /api/v1/ai/rag-search    — semantic search over a client-supplied vault

import { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";

// ── Minimal in-memory embedding cache ─────────────────────────────────────
// LRU-by-insertion with a hard cap to avoid unbounded growth under tsx.
// Keys are SHA256 of the text. Values are { vec, dim }.

interface CachedEmbedding {
  vec: number[];
  dim: number;
  model: string;
}

const EMBED_CACHE_MAX = 1024;
const embedCache = new Map<string, CachedEmbedding>();

function cacheKey(text: string, model: string): string {
  return createHash("sha256").update(`${model}::${text}`).digest("hex");
}

function cacheGet(text: string, model: string): CachedEmbedding | null {
  const k = cacheKey(text, model);
  const v = embedCache.get(k);
  if (!v) return null;
  // touch (LRU-by-insertion isn't true LRU but is good enough for burst dedup)
  embedCache.delete(k);
  embedCache.set(k, v);
  return v;
}

function cachePut(text: string, model: string, value: CachedEmbedding): void {
  const k = cacheKey(text, model);
  if (embedCache.has(k)) embedCache.delete(k);
  embedCache.set(k, value);
  if (embedCache.size > EMBED_CACHE_MAX) {
    // delete oldest
    const oldest = embedCache.keys().next().value;
    if (oldest) embedCache.delete(oldest);
  }
}

// ── Ollama helpers ─────────────────────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const DEFAULT_CHAT_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const DEFAULT_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text:latest";

async function ollamaGenerate(prompt: string, model: string, opts?: { temperature?: number; numPredict?: number; signal?: AbortSignal }): Promise<string> {
  const r = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: opts?.temperature ?? 0.3, num_predict: opts?.numPredict ?? 400 },
    }),
    signal: opts?.signal,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`ollama generate ${r.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await r.json();
  return String(data.response ?? "");
}

async function ollamaEmbed(text: string, model: string, signal?: AbortSignal): Promise<number[]> {
  const r = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`ollama embeddings ${r.status}: ${text.slice(0, 200)}`);
  }
  const data: any = await r.json();
  if (!Array.isArray(data?.embedding)) {
    throw new Error("ollama embeddings: missing 'embedding' field");
  }
  return data.embedding as number[];
}

// ── Cosine similarity for RAG ──────────────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Route registration ─────────────────────────────────────────────────────

export async function aiV2Routes(app: FastifyInstance): Promise<void> {
  // ── POST /api/v1/ai/chat ────────────────────────────────────────────────
  // Body: { question: string, snippets?: string[], model?: string,
  //         temperature?: number, system?: string }
  app.post("/api/v1/ai/chat", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as {
        question?: string;
        snippets?: string[];
        model?: string;
        temperature?: number;
        system?: string;
      };
      const question = (body.question || "").toString().trim();
      if (!question) {
        return reply.status(400).send({ error: "question required" });
      }
      const snippets = Array.isArray(body.snippets)
        ? body.snippets.filter((s): s is string => typeof s === "string").slice(0, 8)
        : [];
      const model = body.model || DEFAULT_CHAT_MODEL;
      const temperature = typeof body.temperature === "number" ? body.temperature : 0.3;

      const context = snippets.map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
      const system = body.system || "Eres un tutor conciso. Responde en español.";
      const prompt = context
        ? `${system}\n\nNotas del vault:\n${context}\n\nPregunta: ${question}\n\nRespuesta concisa (máx 200 palabras). Cita las notas con [n].`
        : `${system}\n\nPregunta: ${question}\n\nRespuesta concisa (máx 150 palabras).`;

      const answer = await ollamaGenerate(prompt, model, { temperature, numPredict: 400 });
      return reply.send({
        answer,
        model,
        sources: snippets,
        cached: false,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || String(err) });
    }
  });

  // ── POST /api/v1/ai/embeddings ──────────────────────────────────────────
  // Body: { text: string | string[], model?: string }
  app.post("/api/v1/ai/embeddings", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { text?: string | string[]; model?: string };
      const model = body.model || DEFAULT_EMBED_MODEL;
      const rawTexts: string[] = [];
      if (typeof body.text === "string") rawTexts.push(body.text);
      else if (Array.isArray(body.text)) {
        for (const t of body.text) if (typeof t === "string") rawTexts.push(t);
      }
      if (rawTexts.length === 0) {
        return reply.status(400).send({ error: "text required (string or string[])" });
      }
      // Cap each text to avoid huge payloads hitting ollama
      const MAX_CHARS = 8000;
      const truncated = rawTexts.map((t) => (t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t));

      const out: number[][] = [];
      const dim: number | null = null;
      let hits = 0;
      let misses = 0;

      for (const t of truncated) {
        const cached = cacheGet(t, model);
        if (cached) {
          out.push(cached.vec);
          hits++;
          continue;
        }
        const vec = await ollamaEmbed(t, model);
        cachePut(t, model, { vec, dim: vec.length, model });
        out.push(vec);
        misses++;
      }

      return reply.send({
        embeddings: out,
        model,
        dim: out[0]?.length ?? 0,
        count: out.length,
        cacheStats: { hits, misses, cached: hits },
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || String(err) });
    }
  });

  // ── POST /api/v1/ai/rag-search ──────────────────────────────────────────
  // Body: { q: string, snippets: { id?, text: string }[], topK?: number, model?: string }
  // Returns snippets ranked by cosine similarity to the query embedding.
  app.post("/api/v1/ai/rag-search", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as {
        q?: string;
        snippets?: Array<{ id?: string; text?: string }>;
        topK?: number;
        model?: string;
      };
      const q = (body.q || "").toString().trim();
      const snippets = Array.isArray(body.snippets) ? body.snippets : [];
      if (!q) return reply.status(400).send({ error: "q required" });
      if (snippets.length === 0) {
        return reply.status(400).send({ error: "snippets required (non-empty array)" });
      }
      const topK = Math.min(Math.max(body.topK ?? 5, 1), 50);
      const model = body.model || DEFAULT_EMBED_MODEL;

      // Embed query (with cache)
      let qVec: number[];
      const cachedQ = cacheGet(q, model);
      if (cachedQ) {
        qVec = cachedQ.vec;
      } else {
        qVec = await ollamaEmbed(q, model);
        cachePut(q, model, { vec: qVec, dim: qVec.length, model });
      }

      // Embed each snippet text (cached)
      type Scored = { id: string; text: string; score: number };
      const scored: Scored[] = [];
      for (let i = 0; i < snippets.length; i++) {
        const s = snippets[i];
        const text = (s?.text ?? "").toString();
        if (!text) continue;
        const capped = text.length > 8000 ? text.slice(0, 8000) : text;
        let vec: number[];
        const c = cacheGet(capped, model);
        if (c) {
          vec = c.vec;
        } else {
          vec = await ollamaEmbed(capped, model);
          cachePut(capped, model, { vec, dim: vec.length, model });
        }
        scored.push({
          id: (s?.id ?? `s-${i}`).toString(),
          text: capped,
          score: cosine(qVec, vec),
        });
      }

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, topK);

      return reply.send({
        query: q,
        model,
        dim: qVec.length,
        results: top,
        total: scored.length,
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || String(err) });
    }
  });

  // ── GET /api/v1/ai/cache-stats (diagnostic) ─────────────────────────────
  app.get("/api/v1/ai/cache-stats", async (_req, reply) => {
    return reply.send({ size: embedCache.size, max: EMBED_CACHE_MAX });
  });
}

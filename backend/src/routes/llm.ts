// Rutas LLM: chat y embeddings.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { LLMService } from "../services/llm.js";
import { EmbeddingsService } from "../services/embeddings.js";
import { getMetrics } from "../utils/metrics.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";

interface ChatBody {
  messages?: { role: string; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

interface EmbedBody {
  texts?: string[];
  model?: string;
}

interface CacheClearBody {
  model?: string;
}

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  const llm = new LLMService();
  const emb = new EmbeddingsService();

  // POST /api/v1/llm/chat
  app.post("/api/v1/llm/chat", async (req, reply) => {
    const body = (req.body ?? {}) as ChatBody;
    const r = await safeCallAsync({
      component: "llm",
      code: "EC-LLM-010",
      message: "chat endpoint failed",
      context: { model: body.model, messageCount: body.messages?.length ?? 0 },
      op: async () => {
        if (!body.messages || body.messages.length === 0) {
          throw E.val("EC-LLM-011", "messages requerido", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { messages: [{role, content}, ...] }",
          });
        }
        const t0 = Date.now();
        const result = await llm.chat({
          messages: body.messages.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          })),
          model: body.model,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          responseFormat: body.responseFormat,
        });
        const dur = (Date.now() - t0) / 1000;
        const m = getMetrics();
        m.incCounter("mnexus_llm_chat_total", { model: result.model ?? "unknown" });
        m.observeHistogram("mnexus_llm_chat_duration_seconds", { model: result.model ?? "unknown" }, dur);
        logOp("llm", "chat", true, { model: result.model, dur: dur.toFixed(2), contentLen: result.content.length });
        return result;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/llm/embed
  app.post("/api/v1/llm/embed", async (req, reply) => {
    const body = (req.body ?? {}) as EmbedBody;
    const r = await safeCallAsync({
      component: "emb",
      code: "EC-EMB-010",
      message: "embed endpoint failed",
      context: { textCount: body.texts?.length ?? 0, model: body.model },
      op: async () => {
        if (!body.texts || body.texts.length === 0) {
          throw E.val("EC-EMB-011", "texts requerido", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { texts: ['...', '...'] }",
          });
        }
        if (!(await emb.isAvailable())) {
          throw E.emb("EC-EMB-012", "Embeddings service not available", {
            context: { model: body.model },
            hint: "Check Ollama is running and model is available",
            statusCode: 503,
          });
        }
        const result = await emb.embed(body.texts, body.model);
        if (result.cacheStats) {
          const m = getMetrics();
          m.incCounter("mnexus_embeddings_cache_hits_total", {}, result.cacheStats.hits);
          m.incCounter("mnexus_embeddings_cache_misses_total", {}, result.cacheStats.misses);
          m.incCounter("mnexus_embeddings_computed_total", {}, result.cacheStats.misses);
        }
        logOp("emb", "embed", true, { count: body.texts.length, cacheStats: result.cacheStats });
        return result;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // GET /api/v1/llm/embed/cache — admin del cache
  app.get("/api/v1/llm/embed/cache", async () => {
    return { stats: emb.getCacheStats() };
  });

  // POST /api/v1/llm/embed/cache/clear
  app.post("/api/v1/llm/embed/cache/clear", async (req, reply) => {
    const body = (req.body ?? {}) as CacheClearBody;
    const r = await safeCallAsync({
      component: "emb",
      code: "EC-EMB-013",
      message: "cache clear failed",
      context: { model: body.model, deviceId: req.auth?.sub },
      op: async () => {
        const deviceId = req.auth?.sub ?? "(unknown)";
        const removed = emb.invalidateCache(body.model);
        logOp("emb", "cache cleared", true, { deviceId, model: body.model, removed });
        return { ok: true, removed };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}

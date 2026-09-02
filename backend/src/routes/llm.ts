// Rutas LLM: chat y embeddings.

import { FastifyInstance } from "fastify";
import { LLMService } from "../services/llm.js";
import { EmbeddingsService } from "../services/embeddings.js";
import { getMetrics } from "../utils/metrics.js";
import { logger } from "../utils/log.js";

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  const llm = new LLMService();
  const emb = new EmbeddingsService();

  app.post("/api/v1/llm/chat", async (req, reply) => {
    const body = req.body as {
      messages?: { role: string; content: string }[];
      model?: string;
      temperature?: number;
      maxTokens?: number;
      responseFormat?: "text" | "json";
    };
    if (!body?.messages || body.messages.length === 0) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "messages requerido" });
      return;
    }
    try {
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
      return result;
    } catch (e) {
      reply.code(502).send({ code: "LLM_ERROR", message: (e as Error).message });
    }
  });

  app.post("/api/v1/llm/embed", async (req, reply) => {
    const body = req.body as { texts?: string[]; model?: string };
    if (!body?.texts || body.texts.length === 0) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "texts requerido" });
      return;
    }
    if (!(await emb.isAvailable())) {
      reply.code(503).send({ code: "EMBEDDINGS_UNAVAILABLE", message: "Ollama no disponible" });
      return;
    }
    try {
      const result = await emb.embed(body.texts, body.model);
      if (result.cacheStats) {
        const m = getMetrics();
        m.incCounter("mnexus_embeddings_cache_hits_total", {}, result.cacheStats.hits);
        m.incCounter("mnexus_embeddings_cache_misses_total", {}, result.cacheStats.misses);
        m.incCounter("mnexus_embeddings_computed_total", {}, result.cacheStats.misses);
      }
      return result;
    } catch (e) {
      reply.code(502).send({ code: "EMBED_ERROR", message: (e as Error).message });
    }
  });

  // v0.13: admin del cache de embeddings
  app.get("/api/v1/llm/embed/cache", async () => {
    return { stats: emb.getCacheStats() };
  });

  app.post("/api/v1/llm/embed/cache/clear", async (req, reply) => {
    const body = req.body as { model?: string };
    const deviceId = req.auth?.sub ?? "(unknown)";
    const removed = emb.invalidateCache(body?.model);
    logger.info({ deviceId, model: body?.model, removed }, "Embedding cache invalidado");
    return { ok: true, removed };
  });
}

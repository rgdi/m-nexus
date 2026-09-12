// M-NEXUS Backend — minimal stable version (v0.62.8)
// Workaround for SIGSEGV under Node 20.19.4 + tsx with full server.ts
// Re-enable features gradually as the underlying issue is diagnosed.

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { logger, logOp } from "./utils/log.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { flashcardsRoutes } from "./routes/flashcards.js";
import { aiV2Routes } from "./routes/ai_v2.js";

export async function buildServer(): Promise<any> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  // CORS
  const { corsOriginCallback, getAllowedOrigins } = await import("./utils/corsPolicy.js");
  await app.register(cors, {
    origin: corsOriginCallback,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
  logOp("http", "cors.initialized", true, { allowedOrigins: getAllowedOrigins() });

  // WebSocket (stable under Node 20 + tsx)
  await app.register(websocket);

  // Static (use absolute path so __dirname resolves correctly under tsx)
  await app.register(staticPlugin, {
    root: join(process.cwd(), "public"),
    prefix: "/",
  });

  // Routes — basic monitoring + flashcards generation
  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(flashcardsRoutes);
  // FASE 4 prep: minimal AI v2 endpoints (chat, embeddings, rag-search).
  // No auth — same posture as /api/v1/ai/tutor below. Designed to be safe
  // under Node 20.19.4 + tsx (no better-sqlite3, no plugin imports).
  await app.register(aiV2Routes);

  // v0.62.8: minimal AI tutor endpoint that uses Ollama
  app.post("/api/v1/ai/tutor", async (req, reply) => {
    try {
      const body = req.body as any;
      const question = body?.question || body?.message || "";
      const vaultSnippets: string[] = body?.snippets || [];
      if (!question) {
        return reply.status(400).send({ error: "question required" });
      }
      // Build prompt with RAG context
      const context = vaultSnippets.slice(0, 5).map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
      const prompt = context
        ? `Eres un tutor médico. Basándote SOLO en estas notas del vault:\n\n${context}\n\nPregunta: ${question}\n\nRespuesta concisa en español (máx 200 palabras). Cita las notas con [n].`
        : `Eres un tutor médico. Responde conciso en español (máx 150 palabras): ${question}`;

      const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
      const model = process.env.OLLAMA_MODEL || "llama3.2:3b";
      // v0.62.9: timeout 45s para evitar cuelgue de UI cuando Ollama CPU es lento
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      const ollamaResp = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 120 },
        }),
        signal: ctrl.signal,
      }).catch((e) => {
        clearTimeout(t);
        throw e;
      });
      clearTimeout(t);
      if (!ollamaResp.ok) {
        return reply.status(502).send({ error: `ollama returned ${ollamaResp.status}` });
      }
      const data = await ollamaResp.json() as any;
      return reply.send({
        answer: data.response || "(sin respuesta)",
        model,
        sources: vaultSnippets.slice(0, 5),
      });
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? 'timeout: Ollama CPU muy lento (>45s)' : (err.message || String(err));
      return reply.status(504).send({ error: msg, hint: 'Reduce num_predict o usa GPU' });
    }
  });
  console.log("DEBUG: tutor route registered");

  return app;
}

export async function start(): Promise<void> {
  try {
    logOp("lifecycle", "server.starting", true, { port: config.port, host: config.host });
    const app = await buildServer();
    await app.listen({ port: config.port, host: config.host });
    logOp("lifecycle", "server.listening", true, { url: `http://${config.host}:${config.port}` });
  } catch (err) {
    logger.error({
      code: "EC-LIFECYCLE-001",
      category: "LIFECYCLE",
      message: "Failed to start server",
      cause: err instanceof Error ? err.message : String(err),
      hint: "Check port availability, env vars, and database connections",
    });
    process.exit(1);
  }
}

const isMain = process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js");
if (isMain) {
  start();
}

import { VERSION } from "./version.js";
export { VERSION };

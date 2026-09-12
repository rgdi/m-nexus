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

  // Routes — basic monitoring endpoints
  await app.register(healthRoutes);
  await app.register(metricsRoutes);

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
      const ollamaResp = await fetch(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 400 },
        }),
      });
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
      return reply.status(500).send({ error: err.message || String(err) });
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

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
import { aiRoutes } from "./routes/ai.js";
import { syncRoutes } from "./routes/sync.js";
import { subjectsRoutes } from "./routes/subjects.js";
import { notesRoutes } from "./routes/notes.js";
import { eventsRoutes } from "./routes/events.js";
import { tasksRoutes } from "./routes/tasks.js";
import { recordingsRoutes } from "./routes/recordings.js";
import { crossVerifyRoutes } from "./routes/cross_verify.js";
import { syncV2Routes, syncV2RestRoutes } from "./routes/sync_v2.js";
import { authRoutes } from "./routes/auth.js";
import { backupRoutes } from "./routes/backup.js";
import { updateRoutes } from "./routes/update.js";
import { wsRoutes } from "./routes/ws.js";
import { audioRoutes } from "./routes/audio.js";
import { llmRoutes } from "./routes/llm.js";
import { ocrRoutes } from "./routes/ocr.js";
import { authMiddleware } from "./middleware/auth.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { pdfRoutes } from "./routes/pdf.js";

export async function buildServer(): Promise<any> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  // v2.1.4: allow application/zip and application/octet-stream content types
  // for backup upload route (and any other binary routes). Fastify default
  // only accepts JSON, so we register a permissive parser for binaries.
  app.addContentTypeParser(
    "application/zip",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body)
  );

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
  // FASE 4 prep: minimal AI v2 endpoints (chat, embeddings, rag-search).
  // No auth — same posture as /api/v1/ai/tutor below. Designed to be safe
  // under Node 20.19.4 + tsx (no better-sqlite3, no plugin imports).
  await app.register(aiV2Routes);
  await app.register(aiRoutes, { prefix: "/api/v1/ai" });
  await app.register(syncRoutes);
  // v1.1.0: frontend Education Service endpoints
  await app.register(subjectsRoutes, { prefix: "/api/v1" });
  await app.register(notesRoutes, { prefix: "/api/v1" });
  await app.register(eventsRoutes, { prefix: "/api/v1" });
  await app.register(tasksRoutes, { prefix: "/api/v1" });
  // v1.5.1: flashcards CRUD + extracción automática desde notas
  await app.register(flashcardsRoutes, { prefix: "/api/v1" });
  // v1.5.4: audio recordings
  await app.register(recordingsRoutes, { prefix: "/api/v1" });
  // v1.5.6: cross-verify (notas vs grabaciones)
  await app.register(crossVerifyRoutes, { prefix: "/api/v1" });
  // v2.0.6: E2E sync via WebSocket (WS at /ws/sync) + REST under /api/v1/sync
  await syncV2Routes(app);
  await app.register(syncV2RestRoutes, { prefix: "/api/v1" });

  // v2.1.4: register auth middleware globally so all routes get checked
  app.addHook("preHandler", authMiddleware);

  // v2.1.4: custom error handler — map AppError to structured JSON
  // (Fastify's default returns {statusCode, error: "Bad Request", message};
  // we want {error: <AppError.message>, code, category, hint})
  app.setErrorHandler((err, _req, reply) => {
    const statusCode = (err as any).statusCode ?? 500;
    if ((err as any).code && (err as any).category) {
      // AppError path
      reply.status(statusCode).send({
        error: err.message,
        code: (err as any).code,
        category: (err as any).category,
        context: (err as any).context,
        hint: (err as any).hint,
      });
      return;
    }
    // Generic error
    reply.status(statusCode).send({
      error: err.message || "Internal error",
      code: "EC-INT-001",
      category: "INT",
    });
  });

  // v2.1.4: missing routes that tests expect
  // authRoutes declares paths with /api/v1 prefix already, so register
  // without prefix to avoid /api/v1/api/v1 duplication.
  await app.register(authRoutes);
  await app.register(backupRoutes, { prefix: "/api/v1/backup" });
  await app.register(updateRoutes);
  await app.register(wsRoutes);
  await app.register(audioRoutes);
  await app.register(llmRoutes);
  await app.register(ocrRoutes);
  await app.register(dashboardRoutes);
  await app.register(pdfRoutes);

  // v0.62.8: /api/v1/ai/tutor is registered by aiRoutes (./routes/ai.ts).
  // Removed the inline handler to avoid duplicate-route registration error.
  console.log("DEBUG: tutor route registered via aiRoutes");

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
// Alias for tests that import `buildApp` (kept for backwards compat)
export { buildServer as buildApp };

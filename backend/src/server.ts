// M-NEXUS Backend — servidor central que procesa Whisper/OCR/LLM/Embeddings
// para los plugins de los dispositivos (thin client).
//
// v0.13: caché de embeddings (LRU + hash), métricas Prometheus, compresión WS.
// v0.45: error handler centralizado con códigos EC-XXX-NNN.

import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import compression from "@fastify/compress";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { logger, logLifecycle, logError, logOp } from "./utils/log.js";
import { AppError, ErrorCategory } from "./utils/errorCodes.js";
import { getMetrics } from "./utils/metrics.js";
import { healthRoutes } from "./routes/health.js";
import { audioRoutes } from "./routes/audio.js";
import { llmRoutes } from "./routes/llm.js";
import { ocrRoutes } from "./routes/ocr.js";
import { flashcardsRoutes } from "./routes/flashcards.js";
import { pdfRoutes } from "./routes/pdf.js";
import { wsRoutes } from "./routes/ws.js";
import { authRoutes } from "./routes/auth.js";
import { metricsRoutes } from "./routes/metrics.js";
import { authMiddleware } from "./middleware/auth.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { pushRoutes } from "./routes/push.js";
import { aiRoutes } from "./routes/ai.js";
import { backupRoutes } from "./routes/backup.js";
import { rollbackRoutes } from "./routes/rollback.js";
import { structuredRoutes } from "./routes/structured.js";
import { secretsRoutes } from "./routes/secrets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger as any,
    disableRequestLogging: true, // lo manejamos nosotros
    genReqId: () => `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bodyLimit: 100 * 1024 * 1024, // 100MB para uploads
  });

  // ── Plugins ──────────────────────────────────────
  await app.register(cors, { origin: true, credentials: true });
  await app.register(compression);
  await app.register(rateLimit, { 
    max: 300, 
    timeWindow: "1 minute",
    errorResponseBuilder: (req, ctx) => ({
      code: "EC-RATE-001",
      category: "RATE",
      message: "Rate limit exceeded",
      context: { limit: ctx.max, after: ctx.after },
      hint: "Reduce request frequency",
      statusCode: 429,
    }),
  });
  await app.register(websocket);
  await app.register(staticPlugin, {
    root: join(__dirname, "../public"),
    prefix: "/",
  });

  // ── Request logging middleware ─────────────────
  app.addHook("onRequest", async (req) => {
    (req as any).startTime = Date.now();
    logger.debug({
      component: "http",
      requestId: req.id,
      method: req.method,
      url: req.url,
    }, `→ ${req.method} ${req.url}`);
  });

  app.addHook("onResponse", async (req, reply) => {
    const durationMs = Date.now() - ((req as any).startTime ?? Date.now());
    logger.info({
      component: "http",
      requestId: req.id,
      method: req.method,
      url: req.url,
      statusCode: reply.statusCode,
      durationMs,
    }, `← ${req.method} ${req.url} ${reply.statusCode} (${durationMs}ms)`);
  });

  // ── Error handler centralizado ─────────────────
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const startTime = (req as any).startTime ?? Date.now();
    const durationMs = Date.now() - startTime;
    
    // AppError: error estructurado
    if (err instanceof AppError) {
      logError(err.category.toLowerCase(), {
        code: err.code,
        category: err.category,
        message: err.message,
        cause: err.cause?.message,
        context: { ...err.context, requestId: req.id, url: req.url, method: req.method },
        hint: err.hint,
        durationMs,
        stack: err.stack,
      });
      reply.status(err.statusCode).send({
        error: err.message,
        code: err.code,
        category: err.category,
        hint: err.hint,
        requestId: req.id,
      });
      return;
    }

    // Fastify validation errors
    if (err.validation) {
      const appErr = new AppError({
        category: ErrorCategory.VAL,
        code: "EC-VAL-001",
        message: "Validation failed",
        cause: err,
        context: {
          requestId: req.id,
          url: req.url,
          method: req.method,
          errors: err.validation,
        },
        hint: "Check request body/query against the schema",
        statusCode: 400,
      });
      logError("val", {
        code: appErr.code, category: appErr.category, message: appErr.message,
        context: appErr.context, hint: appErr.hint, durationMs,
      });
      reply.status(400).send({
        error: appErr.message,
        code: appErr.code,
        category: appErr.category,
        details: err.validation,
        requestId: req.id,
      });
      return;
    }

    // Rate limit error (catches de @fastify/rate-limit)
    if (err.statusCode === 429) {
      const appErr = new AppError({
        category: ErrorCategory.RATE,
        code: "EC-RATE-002",
        message: err.message || "Too many requests",
        cause: err,
        context: { requestId: req.id, url: req.url },
        statusCode: 429,
      });
      logError("rate", {
        code: appErr.code, category: appErr.category, message: appErr.message,
        context: appErr.context, durationMs,
      });
      reply.status(429).send({
        error: appErr.message,
        code: appErr.code,
        requestId: req.id,
      });
      return;
    }

    // 404
    if (err.statusCode === 404) {
      logger.warn({
        component: "http",
        requestId: req.id,
        url: req.url,
        method: req.method,
        durationMs,
      }, `404 ${req.method} ${req.url}`);
      reply.status(404).send({
        error: "Not found",
        code: "EC-INTERNAL-001",
        requestId: req.id,
      });
      return;
    }

    // Error genérico no manejado
    const appErr = new AppError({
      category: ErrorCategory.INTERNAL,
      code: "EC-INTERNAL-002",
      message: err.message || "Internal server error",
      cause: err,
      context: {
        requestId: req.id,
        url: req.url,
        method: req.method,
        statusCode: err.statusCode,
      },
      hint: "This is an unhandled error. Please report it with the requestId.",
      statusCode: err.statusCode ?? 500,
    });
    logError("internal", {
      code: appErr.code, category: appErr.category, message: appErr.message,
      cause: err.message, context: appErr.context, durationMs, stack: err.stack,
    });
    reply.status(appErr.statusCode).send({
      error: "Internal server error",
      code: appErr.code,
      requestId: req.id,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    logger.warn({
      component: "http",
      requestId: req.id,
      url: req.url,
      method: req.method,
    }, `404 ${req.method} ${req.url}`);
    reply.status(404).send({
      error: "Not found",
      code: "EC-INTERNAL-001",
      requestId: req.id,
      url: req.url,
    });
  });

  // ── Auth middleware (excepto /health y /metrics) ─
  app.addHook("preHandler", async (req, reply) => {
    if (req.url.startsWith("/health") || req.url.startsWith("/metrics") || req.url === "/") {
      return;
    }
    await authMiddleware(req, reply);
  });

  // ── Routes ──────────────────────────────────────
  await app.register(healthRoutes);
  await app.register(metricsRoutes);
  await app.register(audioRoutes, { prefix: "/api/v1/audio" });
  await app.register(llmRoutes, { prefix: "/api/v1/llm" });
  await app.register(ocrRoutes, { prefix: "/api/v1/ocr" });
  await app.register(flashcardsRoutes, { prefix: "/api/v1/flashcards" });
  await app.register(pdfRoutes, { prefix: "/api/v1/pdf" });
  await app.register(wsRoutes, { prefix: "/ws" });
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(dashboardRoutes, { prefix: "/api/v1/dashboard" });
  await app.register(pushRoutes, { prefix: "/api/v1/push" });
  await app.register(aiRoutes, { prefix: "/api/v1/ai" });
  await app.register(backupRoutes, { prefix: "/api/v1/backup" });
  await app.register(rollbackRoutes, { prefix: "/api/v1/rollback" });
  await app.register(structuredRoutes, { prefix: "/api/v1/structured" });
  await app.register(secretsRoutes, { prefix: "/api/v1/secrets" });

  logLifecycle("server", "routes registered", {
    routes: [
      "health", "metrics", "audio", "llm", "ocr", "flashcards", "pdf",
      "ws", "auth", "dashboard", "push", "ai", "backup", "rollback",
      "structured", "secrets",
    ].length,
  });

  return app;
}

export async function start(): Promise<void> {
  try {
    logLifecycle("server", "starting", { port: config.port, host: config.host });
    const app = await buildServer();
    await app.listen({ port: config.port, host: config.host });
    logLifecycle("server", "listening", { url: `http://${config.host}:${config.port}` });
  } catch (err) {
    logError("lifecycle", {
      code: "EC-LIFECYCLE-001",
      category: "LIFECYCLE",
      message: "Failed to start server",
      cause: err instanceof Error ? err.message : String(err),
      hint: "Check port availability, env vars, and database connections",
    });
    process.exit(1);
  }
}

const isMain = process.argv[1] === __filename;
if (isMain) {
  start();
}
import { VERSION } from "./version.js";
export { VERSION };

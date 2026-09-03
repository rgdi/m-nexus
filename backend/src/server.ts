// M-NEXUS Backend — servidor central que procesa Whisper/OCR/LLM/Embeddings
// para los plugins de los dispositivos (thin client).
//
// v0.13: caché de embeddings (LRU + hash), métricas Prometheus, compresión WS.

import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import compression from "@fastify/compress";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { logger } from "./utils/log.js";
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
import { backupRoutes } from "./routes/backup.js"; // v0.28: backups ultrarrápidos (ZIP binario)
import { updateRoutes } from "./routes/update.js"; // v0.30: auto-update del backend
import { audit } from "./auth/audit.js";
import { VERSION } from "./version.js";
export { VERSION };

/** Crea la app Fastify (sin listen). Usado tanto por main como por tests. */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 100 * 1024 * 1024,
    trustProxy: true,
  });

  // CORS estricto: solo orígenes permitidos
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "app://obsidian.md,capacitor://localhost,http://localhost").split(",");
  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / herramientas locales
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  });
  // v0.28: aceptar application/zip y application/octet-stream sin parsear.
  // Por defecto Fastify solo parsea application/json.
  app.addContentTypeParser(
    ["application/zip", "application/octet-stream", "application/x-zip-compressed"],
    { parseAs: "buffer" },
    (_req, body: Buffer, done) => done(null, body)
  );
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: "1 minute",
    keyGenerator: (req) => (req as { auth?: { sub?: string } }).auth?.sub ?? req.ip,
  });
  await app.register(websocket);
  // v0.13: compresión gzip/deflate/br para HTTP (selectiva: solo para >1KB y si el cliente lo acepta)
  await app.register(compression, {
    global: false, // solo lo aplicamos en rutas grandes explícitamente
    threshold: 1024,
    encodings: ["gzip", "deflate", "br"],
  });

  // Headers de seguridad
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    // CSP para el dashboard
    if (_req.url === "/" || _req.url.endsWith(".html")) {
      reply.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'");
    }
  });

  // Servir dashboard estático (después de /metrics para que no intercepte)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  await app.register(staticPlugin, {
    root: join(__dirname, "..", "public"),
    prefix: "/",
  });

  // Audit log de cada request
  app.addHook("onResponse", async (req, reply) => {
    if (req.url.startsWith("/api/v1/") && req.method !== "GET") {
      const deviceId = (req as { auth?: { sub?: string } }).auth?.sub ?? "(unknown)";
      audit({
        deviceId,
        action: req.url.includes("auth") ? ("auth.refresh" as never) : ("sync.push" as never),
        allowed: reply.statusCode < 400,
        meta: { method: req.method, url: req.url, status: reply.statusCode },
      });
    }
    // v0.13: métricas Prometheus
    const m = getMetrics();
    const path = req.routeOptions?.url ?? req.url.split("?")[0];
    const labels = { path, method: req.method };
    m.incCounter("mnexus_http_requests_total", { ...labels, status: String(reply.statusCode) });
    const startTime = (req as unknown as { startTime?: number }).startTime;
    if (startTime) {
      const duration = (Date.now() - startTime) / 1000;
      m.observeHistogram("mnexus_http_request_duration_seconds", labels, duration);
    }
  });

  // Capturar timestamp de inicio para el histograma
  app.addHook("onRequest", async (req) => {
    (req as unknown as { startTime?: number }).startTime = Date.now();
  });

  app.addHook("onRequest", async (req, reply) => {
    await authMiddleware(req, reply);
  });

  // Rutas
  await app.register(healthRoutes);
  await app.register(metricsRoutes); // v0.13: antes de static
  await app.register(authRoutes);
  await app.register(audioRoutes);
  await app.register(llmRoutes);
  await app.register(ocrRoutes);
  await app.register(flashcardsRoutes);
  await app.register(pdfRoutes);
  await app.register(wsRoutes);
  await app.register(dashboardRoutes);
  await app.register(pushRoutes); // v0.21: push notifications
  await app.register(aiRoutes); // v0.28: AI routes (vault eval, proposals, knowledge, quiz, cross-relevance, fsrs)
  await app.register(backupRoutes); // v0.28: backup ultrarrápido (ZIP binario, SQLite index)
  await app.register(updateRoutes); // v0.30: auto-update del backend (info, check, apply)

  app.setErrorHandler((err, _req, reply) => {
    logger.error({ err: { msg: err.message, code: err.code } }, "Request error");
    reply.code(err.statusCode ?? 500).send({
      code: err.code ?? "INTERNAL",
      message: err.message,
    });
  });

  return app;
}

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: config.host });
    logger.info(`M-NEXUS Backend v${VERSION} escuchando en http://${config.host}:${config.port}`);

    // v0.28: chequea updates en background (no bloquea el arranque)
    if (process.env.MNEXUS_SKIP_UPDATE_CHECK !== "1") {
      const { checkForUpdatesOnStartup } = await import("./utils/updateChecker.js");
      checkForUpdatesOnStartup().catch(() => undefined);
    }
  } catch (err) {
    logger.error({ err }, "No se pudo iniciar el servidor");
    process.exit(1);
  }
}

// Solo arrancar si se ejecuta directamente (no en tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

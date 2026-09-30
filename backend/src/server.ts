// M-NEXUS Backend (v2.2.0) — full server with all routes registered.
// v0.62.8 workaround (SIGSEGV under Node 20.19.4 + tsx) is no longer needed;
// we're on Node 22 + Fastify 5 + tsx 4.16, and tests pass with full routing.

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import multipartPlugin from "@fastify/multipart";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "./config.js";
import { logger, logOp } from "./utils/log.js";
import { healthRoutes } from "./routes/health.js";
import { metricsRoutes } from "./routes/metrics.js";
import { flashcardsRoutes } from "./routes/flashcards.js";
import { aiV2Routes } from "./routes/ai_v2.js";
import { aiRoutes } from "./routes/ai.js";
import { glbModelsRoutes } from "./routes/glbModels.js";
import { syncRoutes } from "./routes/sync.js";
import { subjectsRoutes } from "./routes/subjects.js";
import { notesRoutes } from "./routes/notes.js";
import { journalRoutes } from "./routes/journal.js";
import { ankiRoutes } from "./routes/anki.js";
import { eventsRoutes } from "./routes/events.js";
import { tasksRoutes } from "./routes/tasks.js";
import { recordingsRoutes } from "./routes/recordings.js";
import { crossVerifyRoutes } from "./routes/cross_verify.js";
import { syncV2Routes, syncV2RestRoutes } from "./routes/sync_v2.js";
import { syncReplayRoutes } from "./routes/syncReplay.js";
import { notificationsRoutes } from "./routes/notifications.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { studyPlannerRoutes } from "./routes/studyPlanner.js";
import { occlusionRoutes } from "./routes/occlusion.js";
import { backupRoutes } from "./routes/backup.js";
import { updateRoutes } from "./routes/update.js";
import { wsRoutes } from "./routes/ws.js";
import { audioRoutes } from "./routes/audio.js";
import { llmRoutes } from "./routes/llm.js";
import { authMiddleware } from "./middleware/auth.js";
import { runWithSubject, subjectFor } from "./services/userStore.js";
import { cloudflareAccessMiddleware, isCloudflareAccessEnabled } from "./middleware/cloudflareAccess.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { deviceRoutes } from "./routes/devices.js";
import { pdfRoutes } from "./routes/pdf.js";
import { themesRoutes } from "./routes/themes.js";
import { crdtRoutes } from "./routes/crdt.js";
import { pushRoutes } from "./routes/push.js";
import { autoBackupRoutes } from "./routes/autoBackup.js";
import { Cluster } from "./services/cluster.js";
import { clusterRoutes } from "./routes/cluster.js";

// v2.23.3: tell TypeScript about the cluster instance Fastify decorator.
declare module "fastify" {
  interface FastifyInstance {
    cluster: Cluster;
  }
}
import { fsrsQueueRoutes } from "./routes/fsrsQueue.js";
import { keyExchangeRoutes } from "./routes/keyExchange.js";
import { handwritingRoutes } from "./routes/handwriting.js";
import { marketplaceRealRoutes } from "./routes/marketplaceReal.js";
import { marketplaceSqliteRoutes } from "./routes/marketplaceSqlite.js";
import { pdfAnnotationRoutes } from "./routes/pdfAnnotation.js";
import { pdfOcclusionRoutes } from "./routes/pdfOcclusion.js";
import { pdfSyncRoutes } from "./routes/pdfSync.js";
import { fsrsPredictiveRoutes } from "./routes/fsrsPredictive.js";
import { kgRoutes } from "./routes/kg.js";
import { ocrRoutes } from "./routes/ocr.js";
import { smartNotificationsRoutes } from "./routes/smartNotifications.js";
import { ocrHtrRoutes } from "./routes/ocrHtr.js";
import { multiBoardRoutes } from "./routes/multiBoard.js";
import { rollbackRoutes } from "./routes/rollback.js";
import { stemmerRoutes } from "./routes/stemmer.js";
import { clipRoutes } from "./routes/clip.js";
import { secretsRoutes } from "./routes/secrets.js";

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

  // v2.38.1 — run each route handler inside the caller's subject scope,
  // so the data services can tell users apart without every handler
  // threading a parameter through. Registered before any route plugin
  // below, because onRoute only sees routes added after it.
  //
  // Wrapping the handler rather than setting the scope from a
  // preHandler: `enterWith()` inside a hook does not survive to the
  // handler (the hook body runs in its own async context), and a
  // module-level "current user" would be the exact race this feature
  // exists to prevent. Here we have the request at call time, so each
  // call gets its own `run()` child scope.
  app.addHook("onRoute", (routeOptions) => {
    const inner = routeOptions.handler;
    if (typeof inner !== "function") return;
    (routeOptions as any).handler = function (this: any, request: any, reply: any) {
      return runWithSubject(subjectFor(request?.auth), () => inner.call(this, request, reply));
    };
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

  // v2.16.0: multipart for .glb model upload (user's own anatomy models).
  await app.register(multipartPlugin, {
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB cap
    attachFieldsToBody: false,
  });

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
  // v2.26.0: premium daily journal
  await app.register(journalRoutes, { prefix: "/api/v1" });
  await app.register(eventsRoutes, { prefix: "/api/v1" });
  // v2.27.0: Anki .apkg import/export
  await app.register(ankiRoutes, { prefix: "/api/v1" });
  await app.register(tasksRoutes, { prefix: "/api/v1" });
  // v1.5.1: flashcards CRUD + extracción automática desde notas
  await app.register(flashcardsRoutes, { prefix: "/api/v1" });
  // v2.16.0: user-uploaded .glb anatomical models
  await glbModelsRoutes(app);
  // v1.5.4: audio recordings
  await app.register(recordingsRoutes, { prefix: "/api/v1" });
  // v1.5.6: cross-verify (notas vs grabaciones)
  await app.register(crossVerifyRoutes, { prefix: "/api/v1" });
  // v2.0.6: E2E sync via WebSocket (WS at /ws/sync) + REST under /api/v1/sync
  await syncV2Routes(app);
  await app.register(syncV2RestRoutes, { prefix: "/api/v1" });
  // v2.19.0: offline queue replay endpoint (batch sync).
  await app.register(syncReplayRoutes, { prefix: "/api/v1" });
  // v2.21.0: notification capture ingest + list.
  await app.register(notificationsRoutes, { prefix: "/api/v1" });

  // v2.1.4: register auth middleware globally so all routes get checked
  app.addHook("preHandler", authMiddleware);

  // v2.38.1 — run each route handler inside the caller's subject scope,
  // so the data services can tell users apart without every handler
  // threading a parameter through.
  //
  // Wrapping the handler rather than setting the scope from a hook:
  // `als.enterWith()` inside a preHandler does not survive to the
  // handler — the hook body runs in its own async context — and a
  // module-level "current user" would be the exact race this feature
  // exists to prevent. `onRoute` is the one place that sees both the
  // route and, at call time, the request, so the wrapper reads the
  // subject from the request and `run()`s a fresh child scope per call.
  app.addHook("onRoute", (routeOptions) => {
    const inner = routeOptions.handler;
    if (typeof inner !== "function") return;
    (routeOptions as any).handler = function (this: any, request: any, reply: any) {
      return runWithSubject(subjectFor(request?.auth), () => inner.call(this, request, reply));
    };
  });

  // v2.11.0: Cloudflare Access middleware — if header present, verify JWT
  // (with 5-min in-memory cache). No-op when header absent (local dev).
  if (isCloudflareAccessEnabled()) {
    app.addHook("preHandler", cloudflareAccessMiddleware);
    console.log("[cf-access] middleware enabled — verifying Cf-Access-Jwt-Assertion headers");
  }

  // v2.1.4: custom error handler — map AppError to structured JSON
  // (Fastify's default returns {statusCode, error: "Bad Request", message};
  // we want {error: <AppError.message>, code, category, hint})
  app.setErrorHandler((err: any, _req, reply) => {
    const statusCode = err.statusCode ?? 500;
    if (err.code && err.category) {
      // AppError path
      reply.status(statusCode).send({
        error: err.message,
        code: err.code,
        category: err.category,
        context: err.context,
        hint: err.hint,
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
  await app.register(dashboardRoutes);
  // v2.38.0: registered WITHOUT a prefix, so the real paths were
  // /devices/register, /devices/:id/… while the frontend calls
  // /api/v1/devices/register (services/device_id.js) — a 404 on every
  // boot, and every multi-device feature downstream with it.
  await app.register(deviceRoutes, { prefix: "/api/v1" });
  await app.register(pdfRoutes);
  // v2.2.0 W1: re-enable orphan routes that were disabled since v0.62.8 SIGSEGV workaround.
  // Node 22 + Fastify 5 don't have the original SIGSEGV, safe to register.
  await app.register(themesRoutes);
  await app.register(crdtRoutes);
  await app.register(pushRoutes);
  await app.register(autoBackupRoutes);
  await app.register(fsrsQueueRoutes);
  await app.register(keyExchangeRoutes);
  await app.register(handwritingRoutes);
  await app.register(marketplaceRealRoutes);
  await app.register(marketplaceSqliteRoutes);
  await app.register(pdfAnnotationRoutes);
await app.register(pdfOcclusionRoutes);
await app.register(pdfSyncRoutes);
await app.register(fsrsPredictiveRoutes);
await app.register(kgRoutes);
await app.register(ocrRoutes);
await app.register(smartNotificationsRoutes);
await app.register(ocrHtrRoutes);
await app.register(multiBoardRoutes);
  await app.register(rollbackRoutes);
  await app.register(stemmerRoutes);
  await app.register(clipRoutes);
  await app.register(secretsRoutes);

  // v2.6.0: admin routes (AI config + backup trigger)
  await app.register(adminRoutes, { prefix: "/api/v1" });

  // v2.8.0: study planner + image occlusion
  await app.register(studyPlannerRoutes, { prefix: "/api/v1" });
  await app.register(occlusionRoutes, { prefix: "/api/v1" });

  // v2.35.0: progress analytics (GitHub heatmap + charts for mobile)
  const { registerProgressRoutes } = await import("./routes/progress.js");
  registerProgressRoutes(app);

  // v2.36.0: answer grading (typed answers with LLM, multiple choice)
  const { registerGradingRoutes } = await import("./routes/grading.js");
  registerGradingRoutes(app);

  // v2.38.0 — folder-scoped RAG with citations.
  const { registerFolderRagRoutes } = await import("./routes/folderRag.js");
  registerFolderRagRoutes(app);

  // v2.38.1 — study material generated from a folder.
  const { registerResourceRoutes } = await import("./routes/resources.js");
  registerResourceRoutes(app);

  // v2.38.5 — "¿qué sabes ya?": medicion de conocimiento previo con
  // excavacion progresiva y FSRS acoplado.
  const { diagnosticRoutes } = await import("./routes/diagnostic.js");
  diagnosticRoutes(app);

  // v2.38.9 — cruzar una clase con el material del profesor: lo que se
  // dijo y no está en el PDF/PPT/DOCX, y lo que está y nadie ha
  // comentado. Con la página exacta de cada cosa.
  const { coverageRoutes } = await import("./routes/coverage.js");
  coverageRoutes(app);

  // v2.38.10 — el índice único de recursos y el estudio exclusivo. Es
  // la pieza que permite "estudiar solo este PDF" y "esta tarjeta salió
  // de esta nota", que hasta ahora no se podían preguntar.
  const { graphRoutes } = await import("./routes/graph.js");
  graphRoutes(app);

  // v2.38.10 — el tutor socratico. Preguntas extraidas de la nota del
  // propio usuario, con comparacion determinista de terminos y sin
  // gastar modelo mas que en la capa que de verdad lo necesita.
  const { socraticRoutes } = await import("./routes/socratic.js");
  socraticRoutes(app);

  // v2.38.11 — tinta vectorial con presión y su sincronización entre
  // dispositivos. Trazos, no pixeles: por eso se ven igual en la tablet
  // y en el portatil.
  const { inkRoutes } = await import("./routes/ink.js");
  inkRoutes(app);

  // v0.62.8: /api/v1/ai/tutor is registered by aiRoutes (./routes/ai.ts).
  // Removed the inline handler to avoid duplicate-route registration error.
  console.log("DEBUG: tutor route registered via aiRoutes");

  // v2.23.3: cluster routes (single-node default, multi-node when CLUSTER_REDIS=1).
  // The cluster instance is shared across request handlers via app.decorate.
  const cluster = new Cluster({
    ttl: parseInt(process.env.PEER_TTL || "60", 10),
    tick: parseInt(process.env.PEER_TICK || "15", 10),
    port: config.port,
    region: process.env.NODE_REGION || "local",
    version: (await import("../package.json", { with: { type: "json" } }).catch(() => ({ default: { version: "dev" } }))).default?.version || "dev",
    publicUrl: process.env.PUBLIC_URL,
    capabilities: ["http", "ws", "ocr", "llm"],
    redis: null, // start with single-node default; socket/client upgrade path kept for future
    dataDir: process.cwd(),
  });
  await cluster.start();
  app.decorate("cluster", cluster);
  await clusterRoutes(app, cluster);

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

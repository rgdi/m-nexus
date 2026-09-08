// Upload routes: chunked upload de archivos grandes (audio).
//
// v0.33: las grabaciones de voz pueden pesar 50+ MB. Subirlas en
// un solo POST falla si la red se corta a mitad. Chunked upload
// divide el archivo en pedazos, sube cada uno, y el server los
// ensambla al final. Si un chunk falla, el cliente lo reintenta.

import { FastifyInstance } from "fastify";
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { logger, logOp } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";

function uploadDir() { return process.env.UPLOAD_DIR ?? "/var/lib/mnexus/uploads"; }
const CHUNK_SIZE_DEFAULT = 1024 * 1024; // 1 MB

// In-memory session state (en producción: Redis o SQLite)
interface UploadSession {
  uploadId: string;
  filename: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  deviceId: string;
  createdAt: number;
  /** Checksum esperado (opcional, SHA-256 del archivo completo). */
  expectedSha256?: string;
  /** Metadata del archivo (para guardar como flashcard, etc). */
  metadata?: Record<string, unknown>;
  /** Carpeta destino en /voice_notes/. */
  targetSubdir?: string;
}

const sessions = new Map<string, UploadSession>();

// Limpiar sesiones viejas (más de 24h) cada hora
setInterval(() => {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (now - s.createdAt > maxAge) {
      sessions.delete(id);
      // Borrar chunks parciales
      const dir = join(uploadDir(), id);
      if (existsSync(dir)) {
        try { unlinkSync(dir); } catch { /* ignore */ }
      }
    }
  }
}, 60 * 60 * 1000);

function chunksDir(uploadId: string): string {
  return join(uploadDir(), uploadId);
}

// v0.47.22: validar IDs de upload antes de usarlos en paths.
// Antes: req.params.id y body.targetSubdir/filename se concatenaban
// directamente a paths de filesystem sin validación → path traversal.
// Un atacante podía enviar filename="../../../etc/passwd" y escribir
// fuera del directorio de uploads.
const SAFE_ID_RE = /^[a-z0-9_\-]{1,128}$/i;
function isSafeId(s: string): boolean {
  return SAFE_ID_RE.test(s);
}

// v0.47.22: validar que un path resuelto está dentro de [root].
// Defensa en profundidad por si isSafeId() se olvida en algún callsite.
function isPathInside(child: string, parent: string): boolean {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  // Usar separador final para evitar prefix attacks (/foo vs /foobar)
  return resolvedChild.startsWith(resolvedParent + "/") || resolvedChild === resolvedParent;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/upload/init — inicia sesión de upload
  app.post<{
    Body: {
      filename: string;
      totalSize: number;
      chunkSize?: number;
      deviceId: string;
      expectedSha256?: string;
      metadata?: Record<string, unknown>;
      targetSubdir?: string;
    };
  }>("/api/v1/upload/init", async (req, reply) => {
    const body = req.body;
    if (!body?.filename || !body?.totalSize || !body?.deviceId) {
      return reply.code(400).send({ code: "INVALID", message: "filename, totalSize, deviceId required" });
    }
    if (body.totalSize > 500 * 1024 * 1024) {
      return reply.code(413).send({ code: "TOO_LARGE", message: "max 500 MB per upload" });
    }
    if (body.totalSize <= 0) {
      return reply.code(400).send({ code: "INVALID", message: "totalSize must be > 0" });
    }
    const uploadId = createHash("sha256")
      .update(`${body.deviceId}:${body.filename}:${Date.now()}:${Math.random()}`)
      .digest("hex")
      .slice(0, 32);
    const chunkSize = body.chunkSize ?? CHUNK_SIZE_DEFAULT;
    const totalChunks = Math.ceil(body.totalSize / chunkSize);
    const session: UploadSession = {
      uploadId,
      filename: body.filename,
      totalSize: body.totalSize,
      chunkSize,
      totalChunks,
      receivedChunks: new Set(),
      deviceId: body.deviceId,
      createdAt: Date.now(),
      expectedSha256: body.expectedSha256,
      metadata: body.metadata,
      // v0.47.22: sanitizar targetSubdir antes de almacenar. Reemplazar
      // cualquier secuencia peligrosa por '_' para prevenir path traversal.
      targetSubdir: body.targetSubdir?.replace(/[\\\/]/g, "_").replace(/\.\./g, "_") ?? undefined,
    };
    sessions.set(uploadId, session);
    mkdirSync(chunksDir(uploadId), { recursive: true });
    logger.info({ uploadId, totalSize: body.totalSize, totalChunks }, "Upload initialized");
    return reply.send({
      uploadId,
      chunkSize,
      totalChunks,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
  });

  // PUT /api/v1/upload/:id/chunk/:n — sube chunk N
  app.put<{ Params: { id: string; n: string } }>(
    "/api/v1/upload/:id/chunk/:n",
    async (req, reply) => {
      // v0.47.22: validar id antes de usar en paths.
      if (!isSafeId(req.params.id)) {
        return reply.code(400).send({ code: "BAD_ID", message: "Invalid upload id" });
      }
      const session = sessions.get(req.params.id);
      if (!session) return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
      const n = parseInt(req.params.n, 10);
      if (Number.isNaN(n) || n < 0 || n >= session.totalChunks) {
        return reply.code(400).send({ code: "BAD_CHUNK_INDEX" });
      }
      if (session.receivedChunks.has(n)) {
        // Idempotente: el cliente puede reintentar el mismo chunk
        return reply.send({ ok: true, chunk: n, duplicate: true });
      }
      // El body es raw bytes
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return reply.code(400).send({ code: "EMPTY_CHUNK" });
      }
      // Validar tamaño esperado (excepto el último)
      const expectedSize = n === session.totalChunks - 1
        ? session.totalSize - (session.totalChunks - 1) * session.chunkSize
        : session.chunkSize;
      if (body.length !== expectedSize) {
        return reply.code(400).send({
          code: "BAD_CHUNK_SIZE",
          expected: expectedSize,
          got: body.length,
        });
      }
      const chunkPath = join(chunksDir(req.params.id), `chunk-${n.toString().padStart(6, "0")}`);
      try {
        const stream = createWriteStream(chunkPath);
        await new Promise<void>((resolve, reject) => {
          stream.write(body);
          stream.end((err?: Error | null) => err ? reject(err) : resolve());
        });
        session.receivedChunks.add(n);
        return reply.send({
          ok: true,
          chunk: n,
          received: session.receivedChunks.size,
          total: session.totalChunks,
        });
      } catch (err) {
        logger.error({ err, uploadId: req.params.id, chunk: n }, "Chunk write failed");
        return reply.code(500).send({ code: "WRITE_FAILED" });
      }
    }
  );

  // GET /api/v1/upload/:id/status — ver qué chunks se recibieron
  app.get<{ Params: { id: string } }>("/api/v1/upload/:id/status", async (req, reply) => {
    if (!isSafeId(req.params.id)) {
      return reply.code(400).send({ code: "BAD_ID", message: "Invalid upload id" });
    }
    const session = sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
    const missing: number[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.receivedChunks.has(i)) missing.push(i);
    }
    return reply.send({
      uploadId: session.uploadId,
      received: session.receivedChunks.size,
      total: session.totalChunks,
      missing,
      complete: session.receivedChunks.size === session.totalChunks,
    });
  });

  // POST /api/v1/upload/:id/complete — ensambla y guarda el archivo
  app.post<{ Params: { id: string }; Body: { expectedSha256?: string } }>(
    "/api/v1/upload/:id/complete",
    async (req, reply) => {
      if (!isSafeId(req.params.id)) {
        return reply.code(400).send({ code: "BAD_ID", message: "Invalid upload id" });
      }
      const session = sessions.get(req.params.id);
      if (!session) return reply.code(404).send({ code: "SESSION_NOT_FOUND" });
      // Si el cliente envía expectedSha256 en el complete, lo aceptamos
      // (alternativa: podría estar en el init)
      const expectedSha256 = (req.body?.expectedSha256 ?? session.expectedSha256) || undefined;
      if (session.receivedChunks.size !== session.totalChunks) {
        return reply.code(400).send({
          code: "INCOMPLETE",
          received: session.receivedChunks.size,
          total: session.totalChunks,
          missing: Array.from({ length: session.totalChunks }, (_, i) => i)
            .filter((i) => !session.receivedChunks.has(i)),
        });
      }
      // Ensamblar chunks en orden
      // v0.47.22: defensa en profundidad — validar que targetPath resuelto
      // está dentro de uploadDir. Aunque targetSubdir/filename ya están
      // sanitizados en init, validamos el path final.
      const targetDir = join(uploadDir(), "final", session.targetSubdir ?? "");
      const targetPath = resolve(join(targetDir, session.filename));
      const allowedRoot = resolve(uploadDir(), "final");
      if (!isPathInside(targetPath, allowedRoot)) {
        return reply.code(400).send({
          code: "BAD_PATH",
          message: "Resolved target path is outside upload directory",
        });
      }
      mkdirSync(targetDir, { recursive: true });
      try {
        const hash = createHash("sha256");
        const out = createWriteStream(targetPath);
        for (let i = 0; i < session.totalChunks; i++) {
          const chunkPath = join(chunksDir(req.params.id), `chunk-${i.toString().padStart(6, "0")}`);
          const data = await import("node:fs").then((m) => m.readFileSync(chunkPath));
          hash.update(data);
          await new Promise<void>((resolve, reject) => {
            out.write(data, (err) => err ? reject(err) : resolve());
          });
        }
        await new Promise<void>((resolve) => out.end(() => resolve()));
        const actualSha256 = hash.digest("hex");
        if (expectedSha256 && expectedSha256 !== actualSha256) {
          unlinkSync(targetPath);
          return reply.code(400).send({
            code: "CHECKSUM_MISMATCH",
            expected: session.expectedSha256,
            actual: actualSha256,
          });
        }
        // Limpiar chunks
        for (let i = 0; i < session.totalChunks; i++) {
          try { unlinkSync(join(chunksDir(req.params.id), `chunk-${i.toString().padStart(6, "0")}`)); } catch { /* */ }
        }
        try { unlinkSync(chunksDir(req.params.id)); } catch { /* */ }
        sessions.delete(req.params.id);
        const stat = statSync(targetPath);
        logger.info({ uploadId: req.params.id, size: stat.size, sha256: actualSha256 }, "Upload completed");
        return reply.send({
          ok: true,
          path: targetPath,
          size: stat.size,
          sha256: actualSha256,
        });
      } catch (err) {
        logger.error({ err, uploadId: req.params.id }, "Assembly failed");
        return reply.code(500).send({ code: "ASSEMBLY_FAILED", message: (err as Error).message });
      }
    }
  );

  // DELETE /api/v1/upload/:id — cancela upload
  app.delete<{ Params: { id: string } }>("/api/v1/upload/:id", async (req, reply) => {
    if (!isSafeId(req.params.id)) {
      return reply.code(400).send({ code: "BAD_ID", message: "Invalid upload id" });
    }
    const session = sessions.get(req.params.id);
    if (session) {
      try {
        const dir = chunksDir(req.params.id);
        if (existsSync(dir)) {
          const { rmSync } = await import("node:fs");
          rmSync(dir, { recursive: true });
        }
      } catch { /* ignore */ }
      sessions.delete(req.params.id);
    }
    return reply.send({ ok: true });
  });
}

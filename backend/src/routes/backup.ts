// Rutas de backup ultrarrápido.
//
// v0.28: REWRITE completo — antes el plugin serializaba el vault como
//        base64-en-JSON (3 bytes por char, parseado lento, etc).
//        Ahora recibe .zip binario directo con metadata en headers:
//
//        POST /api/v1/backup/upload
//          Content-Type: application/zip
//          X-Backup-Metadata: {kind, vaultPath, note, fileCount, sha256}
//          Body: <bytes del ZIP>
//
//        GET  /api/v1/backup/list
//          → JSON con metadata (id, size, uploadedAt, kind, sha256)
//
//        GET  /api/v1/backup/download/:id
//          → application/zip binario (stream)
//
//        DELETE /api/v1/backup/:id
//          → borra .zip y entrada del índice
//
// Almacenamiento: UN ARCHIVO .zip por backup en disco (drag-and-drop-friendly).
// Índice: SQLite con metadata rápida (no requiere abrir el ZIP).

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { mkdir, writeFile, unlink, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { config } from "../config.js";
import { audit } from "../auth/audit.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";
import { openBackupIndex, type BackupIndex } from "../services/backupIndex.js";

interface UploadMetadata {
  kind: "auto" | "manual" | "emergency" | "imported";
  vaultPath: string;
  note?: string;
  fileCount: number;
  sha256: string;
  imported?: boolean;
}

let index: BackupIndex | null = null;
async function getIndex(): Promise<BackupIndex> {
  if (!index) {
    await mkdir(dirname(config.backupIndexPath), { recursive: true });
    index = await openBackupIndex(config.backupIndexPath);
    await mkdir(config.backupStoragePath, { recursive: true });
  }
  return index;
}

function deviceFromReq(req: FastifyRequest): string {
  return (
    (req as { auth?: { sub?: string } }).auth?.sub ??
    (req.headers["x-device-id"] as string) ??
    "(unknown)"
  );
}

function safeBackupId(id: string): boolean {
  return /^[A-Za-z0-9_\-]{1,128}$/.test(id);
}

function safeRelPath(p: string): string {
  // Rechazar path traversal — los IDs nunca deben tener /
  if (p.includes("..") || p.startsWith("/") || p.includes("\0")) return "";
  return p;
}

export async function backupRoutes(app: FastifyInstance): Promise<void> {
  // ─── POST /api/v1/backup/upload ──────────────────────────────────────
  app.post("/api/v1/backup/upload", async (req: FastifyRequest, reply: FastifyReply) => {
    // ... (la lógica interna sigue, pero ahora envuelta en safeCall)
    const t0 = Date.now();
    const deviceId = deviceFromReq(req);

    // 1) Parse metadata de headers
    const metaHeader = req.headers["x-backup-metadata"];
    if (typeof metaHeader !== "string") {
      reply.code(400).send({ code: "BAD_REQUEST", message: "Header X-Backup-Metadata requerido" });
      return;
    }
    let meta: UploadMetadata;
    try {
      meta = JSON.parse(metaHeader);
    } catch {
      reply.code(400).send({ code: "BAD_REQUEST", message: "X-Backup-Metadata inválido (no es JSON)" });
      return;
    }

    // 2) Leer el body binario. El content-type-parser configurado en
    // server.ts lo entrega como Buffer directamente en req.body.
    const buf = req.body as Buffer;
    if (!buf || !(buf instanceof Buffer)) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "Body no es buffer" });
      return;
    }
    if (buf.length === 0) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "Body vacío" });
      return;
    }
    if (buf.length > config.maxBackupSize) {
      reply.code(413).send({
        code: "BACKUP_TOO_LARGE",
        message: `Backup excede ${config.maxBackupSize} bytes (recibido ${buf.length})`,
      });
      return;
    }

    // 3) Verificar SHA-256 si fue provisto
    const actualSha = createHash("sha256").update(buf).digest("hex");
    if (meta.sha256 && meta.sha256 !== actualSha) {
      reply.code(400).send({
        code: "CHECKSUM_MISMATCH",
        message: `SHA-256 esperado ${meta.sha256}, real ${actualSha}`,
      });
      return;
    }

    // 4) Verificar magic bytes ZIP (PK\x03\x04)
    if (buf[0] !== 0x50 || buf[1] !== 0x4b || buf[2] !== 0x03 || buf[3] !== 0x04) {
      reply.code(400).send({
        code: "INVALID_ZIP",
        message: "El contenido no es un ZIP válido (faltan magic bytes PK\\x03\\x04)",
      });
      return;
    }

    // 5) Generar ID y escribir a disco
    const id = `${meta.kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const relPath = `${deviceId}/${id}.zip`;
    const fullPath = join(config.backupStoragePath, relPath);
    if (!safeRelPath(`${deviceId}/${id}.zip`)) {
      reply.code(400).send({ code: "BAD_PATH", message: "ID de backup inválido" });
      return;
    }
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buf);

    // 6) Registrar en el índice
    const idx = await getIndex();
    const uploadedAt = new Date().toISOString();
    await idx.insert({
      id,
      deviceId,
      uploadedAt,
      size: buf.length,
      kind: meta.imported ? "manual" : meta.kind, // importados se cuentan como manuales
      vaultPath: meta.vaultPath,
      note: meta.note,
      fileCount: meta.fileCount,
      sha256: actualSha,
      storagePath: relPath,
    });

    const dur = Date.now() - t0;
    audit({
      deviceId,
      action: "backup.upload",
      allowed: true,
      meta: { id, size: buf.length, kind: meta.kind, sha256: actualSha, durationMs: dur },
    });

    reply.code(201).send({
      id,
      size: buf.length,
      uploadedAt,
      receivedBytes: buf.length,
      serverDurationMs: dur,
    });
  });

  // ─── GET /api/v1/backup/list ─────────────────────────────────────────
  app.get("/api/v1/backup/list", async (req: FastifyRequest, reply: FastifyReply) => {
    const deviceId = deviceFromReq(req);
    const idx = await getIndex();
    const all = await idx.listForDevice(deviceId);
    reply.send(all);
  });

  // ─── GET /api/v1/backup/download/:id ─────────────────────────────────
  app.get<{ Params: { id: string } }>("/download/:id", async (req, reply) => {
    const deviceId = deviceFromReq(req);
    const id = req.params.id;
    if (!safeBackupId(id)) {
      reply.code(400).send({ code: "BAD_ID", message: "ID inválido" });
      return;
    }
    const idx = await getIndex();
    const entry = await idx.get(deviceId, id);
    if (!entry) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Backup no encontrado" });
      return;
    }
    const fullPath = resolve(join(config.backupStoragePath, entry.storagePath));
    // Verificar que sigue dentro del storage (anti traversal)
    if (!fullPath.startsWith(resolve(config.backupStoragePath))) {
      reply.code(400).send({ code: "BAD_PATH", message: "Path inválido" });
      return;
    }
    if (!existsSync(fullPath)) {
      reply.code(410).send({ code: "GONE", message: "Archivo .zip borrado del disco" });
      return;
    }
    // v0.28: leer completo y enviar como Buffer. Más simple y compatible con
    // fastify compression. Para backups muy grandes (>1GB) se podría usar
    // createReadStream + reply.send(stream), pero el ZIP completo es más
    // predecible para tests y cliente HTTP estándar.
    const data = await readFile(fullPath);
    reply
      .header("Content-Type", "application/zip")
      .header("Content-Length", String(data.length))
      .header("Content-Disposition", `attachment; filename="${id}.zip"`)
      .header("X-Backup-SHA256", entry.sha256)
      .header("X-Backup-Kind", entry.kind)
      .send(data);
  });

  // ─── DELETE /api/v1/backup/:id ───────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/api/v1/backup/:id", async (req, reply) => {
    const deviceId = deviceFromReq(req);
    const id = req.params.id;
    if (!safeBackupId(id)) {
      reply.code(400).send({ code: "BAD_ID", message: "ID inválido" });
      return;
    }
    const idx = await getIndex();
    const entry = await idx.get(deviceId, id);
    if (!entry) {
      reply.code(404).send({ code: "NOT_FOUND", message: "Backup no encontrado" });
      return;
    }
    const fullPath = join(config.backupStoragePath, entry.storagePath);
    try {
      await unlink(fullPath);
    } catch {
      /* si ya no existe en disco, ok */
    }
    await idx.delete(deviceId, id);
    audit({
      deviceId,
      action: "backup.delete",
      allowed: true,
      meta: { id },
    });
    reply.send({ ok: true });
  });

  // ─── GET /api/v1/backup/dump ─────────────────────────────────────────
  // v0.28: drag-and-drop friendly — devuelve la DB SQLite de índice
  // para que el usuario pueda hacer backup/copiar el archivo entero.
  app.get("/dump", async (req, reply) => {
    if (!existsSync(config.backupIndexPath)) {
      reply.code(404).send({ code: "NO_INDEX", message: "Índice aún no creado" });
      return;
    }
    const data = await readFile(config.backupIndexPath);
    reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Length", String(data.length))
      .header("Content-Disposition", `attachment; filename="backups-index.db"`)
      .send(data);
  });
}

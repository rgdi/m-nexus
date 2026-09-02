// v0.28: Tests del nuevo sistema de backups ultrarrápidos (ZIP binario).
//
// Cobertura:
//   - POST /api/v1/backup/upload: ZIP binario, metadata, SHA-256, magic bytes
//   - GET  /api/v1/backup/list: lista filtrada por device
//   - GET  /api/v1/backup/download/:id: devuelve application/zip
//   - DELETE /api/v1/backup/:id: borra archivo y entrada
//   - GET  /api/v1/backup/dump: descarga el .db (drag-and-drop)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server.js";
import type { FastifyInstance } from "fastify";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";

const TEST_DIR = join(tmpdir(), `mnexus-backup-test-${Date.now()}`);

// Setear env ANTES de importar nada
process.env.AUTH_REQUIRED = "true";
// tests/setup.ts setea JWT_SECRET = "test-secret". Lo respetamos.
process.env.BACKUP_STORAGE_PATH = join(TEST_DIR, "backups");
process.env.BACKUP_INDEX_PATH = join(TEST_DIR, "backups-index.db");
process.env.MAX_BACKUP_SIZE = String(10 * 1024 * 1024); // 10MB
mkdirSync(TEST_DIR, { recursive: true });

describe("Backup routes v0.28 (ZIP binario ultrarrápido)", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let deviceId: string;
  let authToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    if (typeof addr === "object" && addr) {
      baseUrl = `http://127.0.0.1:${addr.port}`;
    }

    // Registrar un device
    const reg = await fetch(`${baseUrl}/api/v1/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "test-device-1",
        deviceName: "Test Device",
        platform: "linux",
        pluginVersion: "0.28.0",
        protocolVersion: "1",
      }),
    });
    expect(reg.status).toBe(200);
    const regData = await reg.json() as { accessToken: string; deviceId?: string };
    authToken = regData.accessToken;
    deviceId = regData.deviceId ?? "test-device-1";
  });

  afterAll(async () => {
    await app.close();
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // Helper: crea un ZIP mínimo válido (solo EOCD, no entries)
  function makeMinimalZip(): Uint8Array {
    // ZIP con una sola entry vacía llamada "test.txt"
    const path = "test.txt";
    const pathBytes = new TextEncoder().encode(path);
    const data = new TextEncoder().encode("hola mundo desde m-nexus v0.28");
    const crc = 0x12345678; // CRC no se valida en este test
    const lhSize = 30 + pathBytes.length + data.length;
    const cdSize = 46 + pathBytes.length;
    const total = lhSize + cdSize + 22;
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    let o = 0;
    // Local file header
    dv.setUint32(o, 0x04034b50, true); o += 4;
    dv.setUint16(o, 20, true); o += 2;        // version
    dv.setUint16(o, 0x0800, true); o += 2;    // flags UTF-8
    dv.setUint16(o, 0, true); o += 2;         // method STORE
    dv.setUint16(o, 0, true); o += 2;         // time
    dv.setUint16(o, 0x2171, true); o += 2;    // date 2026-01-01
    dv.setUint32(o, crc, true); o += 4;
    dv.setUint32(o, data.length, true); o += 4; // compressed
    dv.setUint32(o, data.length, true); o += 4; // uncompressed
    dv.setUint16(o, pathBytes.length, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    buf.set(pathBytes, o); o += pathBytes.length;
    buf.set(data, o); o += data.length;
    // Central directory
    const cdStart = o;
    dv.setUint32(o, 0x02014b50, true); o += 4;
    dv.setUint16(o, 20, true); o += 2;
    dv.setUint16(o, 20, true); o += 2;
    dv.setUint16(o, 0x0800, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 0x2171, true); o += 2;
    dv.setUint32(o, crc, true); o += 4;
    dv.setUint32(o, data.length, true); o += 4;
    dv.setUint32(o, data.length, true); o += 4;
    dv.setUint16(o, pathBytes.length, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint32(o, 0, true); o += 4;
    dv.setUint32(o, 0, true); o += 4; // local header offset
    buf.set(pathBytes, o); o += pathBytes.length;
    // EOCD
    dv.setUint32(o, 0x06054b50, true); o += 4;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 0, true); o += 2;
    dv.setUint16(o, 1, true); o += 2;
    dv.setUint16(o, 1, true); o += 2;
    dv.setUint32(o, cdSize, true); o += 4;
    dv.setUint32(o, lhSize, true); o += 4;
    dv.setUint16(o, 0, true); o += 2;
    return buf;
  }

  describe("POST /api/v1/backup/upload", () => {
    it("rechaza sin X-Backup-Metadata header", async () => {
      const zip = makeMinimalZip();
      const res = await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
        },
        body: zip,
      });
      expect(res.status).toBe(400);
    });

    it("rechaza body vacío", async () => {
      const res = await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "manual", vaultPath: "x", fileCount: 0, sha256: ""
          }),
        },
        body: Buffer.alloc(0),
      });
      expect(res.status).toBe(400);
    });

    it("rechaza contenido que no es ZIP (faltan magic bytes)", async () => {
      const data = new TextEncoder().encode("esto no es un zip");
      const sha = createHash("sha256").update(data).digest("hex");
      const res = await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "manual", vaultPath: "x", fileCount: 0, sha256: sha
          }),
        },
        body: data,
      });
      expect(res.status).toBe(400);
      const err = await res.json() as { code: string };
      expect(err.code).toBe("INVALID_ZIP");
    });

    it("rechaza si SHA-256 no coincide", async () => {
      const zip = makeMinimalZip();
      const res = await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "manual", vaultPath: "x", fileCount: 0, sha256: "0000"
          }),
        },
        body: zip,
      });
      expect(res.status).toBe(400);
      const err = await res.json() as { code: string };
      expect(err.code).toBe("CHECKSUM_MISMATCH");
    });

    it("sube un ZIP válido y devuelve 201", async () => {
      const zip = makeMinimalZip();
      const sha = createHash("sha256").update(zip).digest("hex");
      const res = await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "manual", vaultPath: ".mnexus-backups/x.zip", fileCount: 1, sha256: sha, note: "test 1"
          }),
        },
        body: zip,
      });
      expect(res.status).toBe(201);
      const data = await res.json() as {
        id: string;
        size: number;
        receivedBytes: number;
        serverDurationMs: number;
        uploadedAt: string;
      };
      expect(data.id).toMatch(/^manual-\d+-[a-z0-9]{6}$/);
      expect(data.size).toBe(zip.length);
      expect(data.receivedBytes).toBe(zip.length);
      expect(data.serverDurationMs).toBeGreaterThanOrEqual(0);
      expect(data.uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("GET /api/v1/backup/list", () => {
    it("lista los backups del device", async () => {
      // Subir uno primero para tener datos
      const zip = makeMinimalZip();
      const sha = createHash("sha256").update(zip).digest("hex");
      await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "auto", vaultPath: "test", fileCount: 1, sha256: sha
          }),
        },
        body: zip,
      });

      const res = await fetch(`${baseUrl}/api/v1/backup/list`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
        },
      });
      expect(res.status).toBe(200);
      const data = (await res.json()) as Array<{
        id: string; size: number; kind: string; sha256: string;
      }>;
      expect(data.length).toBeGreaterThan(0);
      for (const b of data) {
        expect(b.id).toBeTruthy();
        expect(b.sha256).toHaveLength(64);
      }
    });
  });

  describe("GET /api/v1/backup/download/:id", () => {
    it("descarga el ZIP binario", async () => {
      // Subir uno primero
      const zip = makeMinimalZip();
      const sha = createHash("sha256").update(zip).digest("hex");
      await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "manual", vaultPath: "test", fileCount: 1, sha256: sha
          }),
        },
        body: zip,
      });
      const list = await fetch(`${baseUrl}/api/v1/backup/list`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      const arr = (await list.json()) as Array<{ id: string }>;
      const id = arr[0].id;

      const res = await fetch(`${baseUrl}/api/v1/backup/download/${id}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("x-backup-sha256")).toHaveLength(64);
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(buf[0]).toBe(0x50);
      expect(buf[1]).toBe(0x4b);
    });

    it("404 si el id no existe", async () => {
      const res = await fetch(`${baseUrl}/api/v1/backup/download/does-not-exist`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      expect(res.status).toBe(404);
    });

    it("rechaza IDs con caracteres raros (path traversal)", async () => {
      const res = await fetch(`${baseUrl}/api/v1/backup/download/${encodeURIComponent("../../etc/passwd")}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/v1/backup/:id", () => {
    it("borra el backup del índice y del disco", async () => {
      // Subir uno nuevo
      const zip = makeMinimalZip();
      const sha = createHash("sha256").update(zip).digest("hex");
      const up = await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "manual", vaultPath: "x", fileCount: 1, sha256: sha
          }),
        },
        body: zip,
      });
      const upData = await up.json() as { id: string };

      // Borrar
      const del = await fetch(`${baseUrl}/api/v1/backup/${upData.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      expect(del.status).toBe(200);

      // Verificar que ya no aparece
      const dl = await fetch(`${baseUrl}/api/v1/backup/download/${upData.id}`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      expect(dl.status).toBe(404);
    });
  });

  describe("GET /api/v1/backup/dump (drag-and-drop)", () => {
    it("devuelve la base de datos SQLite de índice", async () => {
      // Subir al menos uno para que el índice exista
      const zip = makeMinimalZip();
      const sha = createHash("sha256").update(zip).digest("hex");
      await fetch(`${baseUrl}/api/v1/backup/upload`, {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          Authorization: `Bearer ${authToken}`,
          "X-Device-Id": deviceId,
          "X-Backup-Metadata": JSON.stringify({
            kind: "auto", vaultPath: "x", fileCount: 1, sha256: sha
          }),
        },
        body: zip,
      });
      const res = await fetch(`${baseUrl}/api/v1/backup/dump`, {
        headers: { Authorization: `Bearer ${authToken}`, "X-Device-Id": deviceId },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
      expect(res.headers.get("content-disposition")).toContain("backups-index.db");
      const buf = new Uint8Array(await res.arrayBuffer());
      // SQLite magic: "SQLite format 3\0"
      expect(new TextDecoder().decode(buf.subarray(0, 16))).toBe("SQLite format 3\u0000");
    });
  });
});

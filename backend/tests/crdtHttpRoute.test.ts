// crdtHttpRoute.test.ts: tests HTTP de las rutas CRDT (sin levantar el server).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";

describe("crdt HTTP route logic", () => {
  let tmpDir: string;
  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mnexus-crdt-route-"));
    process.env.CRDT_DIR = tmpDir;
    process.env.JWT_SECRET = "test-jwt-secret-32chars-min-please-ok";
    process.env.AUTH_REQUIRED = "false";
  });
  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("CRDT_DIR se aplica al service", async () => {
    const { getCrdtSyncService } = await import("../src/services/crdtSyncService.js");
    const s1 = getCrdtSyncService(tmpDir);
    expect((s1 as any).persistenceDir).toBe(tmpDir);
  });

  it("getState responde con bytes validos de Yjs", async () => {
    const { getCrdtSyncService } = await import("../src/services/crdtSyncService.js");
    const svc = getCrdtSyncService(tmpDir);
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "http test");
    await svc.applyUpdate("nota.md", Y.encodeStateAsUpdate(doc));
    const state = await svc.getState("nota.md");
    expect(Buffer.isBuffer(state) || state instanceof Uint8Array).toBe(true);
    expect(state.byteLength).toBeGreaterThan(2);
  });

  it("listRooms devuelve array de rooms", async () => {
    const { getCrdtSyncService } = await import("../src/services/crdtSyncService.js");
    const svc = getCrdtSyncService(tmpDir);
    await svc.getOrCreateRoom("test-room.md");
    const rooms = svc.listRooms();
    expect(Array.isArray(rooms)).toBe(true);
  });

  it("storageStats cuenta los rooms persistidos", async () => {
    const { getCrdtSyncService } = await import("../src/services/crdtSyncService.js");
    const svc = getCrdtSyncService(tmpDir);
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "stats test");
    await svc.applyUpdate("stats.md", Y.encodeStateAsUpdate(doc));
    const key = (svc as any).roomKey("stats.md");
    await svc.persistRoom(key);
    const stats = await svc.storageStats();
    expect(stats.rooms).toBeGreaterThan(0);
  });

  it("removeRoom elimina el room y la persistencia", async () => {
    const { getCrdtSyncService } = await import("../src/services/crdtSyncService.js");
    const svc = getCrdtSyncService(tmpDir);
    const doc = new Y.Doc();
    doc.getText("c").insert(0, "x");
    await svc.applyUpdate("remove-test.md", Y.encodeStateAsUpdate(doc));
    const key = (svc as any).roomKey("remove-test.md");
    await svc.persistRoom(key);
    const { existsSync } = await import("node:fs");
    expect(existsSync(`${tmpDir}/${key}.bin`)).toBe(true);
    await svc.removeRoom("remove-test.md");
    expect(existsSync(`${tmpDir}/${key}.bin`)).toBe(false);
  });
});

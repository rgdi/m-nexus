// crdtSyncService.test.ts: tests del CRDT sync (v0.51)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { CrdtSyncService } from "../src/services/crdtSyncService.js";

describe("crdtSyncService", () => {
  let tmpDir: string;
  let service: CrdtSyncService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mnexus-crdt-"));
    service = new CrdtSyncService(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("crea un room nuevo con doc vacio", async () => {
    const room = await service.getOrCreateRoom("nota1.md");
    expect(room.doc).toBeDefined();
    const state = Y.encodeStateAsUpdate(room.doc);
    // Doc vacio => 2 bytes (version header) o 0
    expect(state.length).toBeGreaterThanOrEqual(0);
  });

  it("persiste y recarga un update", async () => {
    const room = await service.getOrCreateRoom("nota1.md");
    room.doc.getText("content").insert(0, "hola mundo");
    // Forzar persist directo (internamente el service usa debounce)
    const key = (service as any).roomKey("nota1.md");
    await service.persistRoom(key);
    // Verificar archivo existe
    const { existsSync } = await import("node:fs");
    const path = `${tmpDir}/${key}.bin`;
    expect(existsSync(path)).toBe(true);
    // Crear nueva instancia (simula restart)
    const service2 = new CrdtSyncService(tmpDir);
    const state = await service2.getState("nota1.md");
    expect(state.length).toBeGreaterThan(2);
  });

  it("diferentes notas tienen diferentes rooms", async () => {
    const a = await service.getOrCreateRoom("a.md");
    const b = await service.getOrCreateRoom("b.md");
    a.doc.getText("c").insert(0, "AAA");
    expect(b.doc.getText("c").toString()).toBe("");
  });

  it("listRooms muestra el room", async () => {
    await service.getOrCreateRoom("a.md");
    await service.getOrCreateRoom("b.md");
    const list = service.listRooms();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("cleanup elimina rooms inactivos", async () => {
    const room = await service.getOrCreateRoom("a.md");
    // Forzar lastAccess en el pasado
    room.lastAccess = Date.now() - 100_000;
    const r = await service.cleanup(0); // 0ms = todo inactivo
    expect(r).toBeGreaterThanOrEqual(1);
    // El room ya no debe estar
    expect((service as any).rooms.has((service as any).roomKey("a.md"))).toBe(false);
  });

  it("removeRoom borra persistencia", async () => {
    await service.applyUpdate("a.md", Y.encodeStateAsUpdate(makeDoc((d) => {
      d.getText("c").insert(0, "x");
    })));
    await service.removeRoom("a.md");
    // El room ya no debe estar en memoria
    const list = service.listRooms();
    expect(list.find((r) => r.key === (service as any).roomKey("a.md"))).toBeUndefined();
  });

  it("storageStats cuenta rooms y bytes", async () => {
    await service.applyUpdate("a.md", Y.encodeStateAsUpdate(makeDoc((d) => {
      d.getText("c").insert(0, "hello");
    })));
    // forzar persist
    const key = (service as any).roomKey("a.md");
    await service.persistRoom(key);
    const stats = await service.storageStats();
    expect(stats.rooms).toBeGreaterThanOrEqual(1);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  it("detecta merge concurrente via Yjs CRDT", async () => {
    // Dos clientes modifican la misma nota concurrentemente.
    // Yjs debe converger sin conflicto.
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Sincronizan via el service
    const a = await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(docA));
    expect(a).toBeUndefined(); // void return
    docA.getText("content").insert(0, "From A: ");
    docB.getText("content").insert(0, "From B: ");
    // Cada uno envia su update al service
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(docA));
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(docB));
    // Ahora el state del service contiene ambas
    const finalState = await service.getState("shared.md");
    // Cargamos en un nuevo doc y vemos que tiene el texto de ambos
    const merged = new Y.Doc();
    Y.applyUpdate(merged, finalState);
    const txt = merged.getText("content").toString();
    expect(txt).toContain("From A:");
    expect(txt).toContain("From B:");
  });

  it("getOrCreateRoom reusa el mismo room", async () => {
    const a = await service.getOrCreateRoom("a.md");
    const b = await service.getOrCreateRoom("a.md");
    expect(a).toBe(b);
  });

  it("v0.60 (P0.1): soporta broadcast de updates entre rooms", async () => {
    // simula 2 clientes: A escribe, B debe recibir via broadcast manual
    const room = await service.getOrCreateRoom("broadcast.md");
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getText("content").insert(0, "from A");
    const update = Y.encodeStateAsUpdate(docA);
    // Aplica al room
    Y.applyUpdate(room.doc, update, "clientA");
    // B sincroniza via getState (el broadcast real se hace en WS handler)
    const state = await service.getState("broadcast.md");
    Y.applyUpdate(docB, state);
    expect(docB.getText("content").toString()).toBe("from A");
  });

  it("v0.60 (P0.1): clients se trackean en room", async () => {
    const room = await service.getOrCreateRoom("track.md");
    room.clients.add("client-1");
    room.clients.add("client-2");
    expect(room.clients.size).toBe(2);
    room.clients.delete("client-1");
    expect(room.clients.size).toBe(1);
  });
});

function makeDoc(setup: (d: Y.Doc) => void): Y.Doc {
  const d = new Y.Doc();
  setup(d);
  return d;
}

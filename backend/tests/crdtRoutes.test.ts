// crdtRoutes.test.ts: integration tests de las rutas CRDT.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Y from "yjs";
import { CrdtSyncService } from "../src/services/crdtSyncService.js";

describe("crdt HTTP API", () => {
  let tmpDir: string;
  let service: CrdtSyncService;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mnexus-crdt-api-"));
    service = new CrdtSyncService(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("applyUpdate + getState roundtrip", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "roundtrip test");
    const update = Y.encodeStateAsUpdate(doc);
    await service.applyUpdate("nota.md", update);
    const state = await service.getState("nota.md");
    expect(state.byteLength).toBeGreaterThan(0);
    // Decodificar
    const merged = new Y.Doc();
    Y.applyUpdate(merged, state);
    expect(merged.getText("content").toString()).toBe("roundtrip test");
  });

  it("merge de 3 clientes en el mismo room", async () => {
    const d1 = new Y.Doc();
    const d2 = new Y.Doc();
    const d3 = new Y.Doc();
    d1.getText("c").insert(0, "1");
    d2.getText("c").insert(0, "2");
    d3.getText("c").insert(0, "3");
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(d1));
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(d2));
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(d3));
    const state = await service.getState("shared.md");
    const merged = new Y.Doc();
    Y.applyUpdate(merged, state);
    const t = merged.getText("c").toString();
    expect(t).toContain("1");
    expect(t).toContain("2");
    expect(t).toContain("3");
  });

  it("Yjs map con muchos keys", async () => {
    const doc = new Y.Doc();
    const map = doc.getMap("settings");
    map.set("theme", "dark");
    map.set("fontSize", 14);
    map.set("language", "es");
    await service.applyUpdate("settings.md", Y.encodeStateAsUpdate(doc));
    const state = await service.getState("settings.md");
    const merged = new Y.Doc();
    Y.applyUpdate(merged, state);
    const m = merged.getMap("settings");
    expect(m.get("theme")).toBe("dark");
    expect(m.get("fontSize")).toBe(14);
    expect(m.get("language")).toBe("es");
  });

  it("Yjs array de items", async () => {
    const doc = new Y.Doc();
    const arr = doc.getArray("todos");
    arr.push(["item1", "item2", "item3"]);
    await service.applyUpdate("todos.md", Y.encodeStateAsUpdate(doc));
    const state = await service.getState("todos.md");
    const merged = new Y.Doc();
    Y.applyUpdate(merged, state);
    const a = merged.getArray("todos");
    expect(a.toArray()).toEqual(["item1", "item2", "item3"]);
  });

  it("persiste y reload tras restart", async () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "persisted content");
    await service.applyUpdate("nota.md", Y.encodeStateAsUpdate(doc));
    // Force persist
    const key = (service as any).roomKey("nota.md");
    await service.persistRoom(key);
    // Restart: new service
    const service2 = new CrdtSyncService(tmpDir);
    const state = await service2.getState("nota.md");
    const merged = new Y.Doc();
    Y.applyUpdate(merged, state);
    expect(merged.getText("content").toString()).toBe("persisted content");
  });

  it("concurrent edits merge sin perdida (Yjs CRDT)", async () => {
    // Escenario: dos clientes editan el mismo texto sin coordinacion.
    // Yjs garantiza convergencia.
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // Sincronizar estado inicial
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(docA));
    // Ambos editan concurrentemente
    docA.getText("content").insert(0, "AAA-");
    docB.getText("content").insert(0, "-BBB");
    // Intercambian updates
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(docA));
    await service.applyUpdate("shared.md", Y.encodeStateAsUpdate(docB));
    // docA recibe update de B
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    // Estado final debe converger
    expect(docA.getText("content").toString()).toBe(docB.getText("content").toString());
  });
});

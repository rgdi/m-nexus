// pdfV229.test.ts — v2.29.0 PDF image occlusion + cross-device sync tests.

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { pdfOcclusionStorage, type PdfOcclusion } from "../src/services/pdfOcclusionStorage.js";
import {
  shapeOcclusion,
  createAtomicCardFromOcclusion,
  batchFromOcclusions,
} from "../src/services/pdfOcclusionAtomic.js";
import { pdfCrdtSync, pdfCrdtReset } from "../src/services/pdfCrdtSync.js";
import * as Y from "yjs";

const DATA_DIR = join(process.cwd(), "data");
const OCCLUSIONS_FILE = join(DATA_DIR, "pdf-occlusions.json");
const FLASHCARDS_FILE = join(DATA_DIR, "flashcards.json");

async function resetFiles() {
  for (const f of [OCCLUSIONS_FILE, FLASHCARDS_FILE]) {
    try { await fs.unlink(f); } catch {}
  }
  await pdfOcclusionStorage._reset();
}

describe("v2.29.0 — pdfOcclusionStorage", () => {
  beforeEach(resetFiles);

  it("add + list preserves documentPath grouping", async () => {
    await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
    });
    await pdfOcclusionStorage.add({
      id: "o-2", documentPath: "y.pdf", page: 1, x: 0.5, y: 0.5, w: 0.1, h: 0.1,
    });
    expect((await pdfOcclusionStorage.list("x.pdf")).length).toBe(1);
    expect((await pdfOcclusionStorage.list("y.pdf")).length).toBe(1);
  });

  it("normaliza coordenadas al rango [0..1]", async () => {
    const o = await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: -0.5, y: 1.5, w: 1.5, h: 0.5,
    });
    expect(o.x).toBe(0);
    expect(o.w).toBeLessThanOrEqual(1);
  });

  it("update mantiene cardId", async () => {
    await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
    });
    const u = await pdfOcclusionStorage.update("o-1", "x.pdf", { cardId: "fc-1", state: "card-created" });
    expect(u?.cardId).toBe("fc-1");
    expect(u?.state).toBe("card-created");
  });

  it("listRaw solo devuelve oclusiones en estado raw", async () => {
    await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, state: "raw",
    });
    await pdfOcclusionStorage.add({
      id: "o-2", documentPath: "x.pdf", page: 1, x: 0.3, y: 0.3, w: 0.2, h: 0.2, state: "card-created", cardId: "fc-1",
    });
    const raws = await pdfOcclusionStorage.listRaw("x.pdf");
    expect(raws.length).toBe(1);
    expect(raws[0].id).toBe("o-1");
  });
});

describe("v2.29.0 — shapeOcclusion", () => {
  it("basic con label produce card tipo basic", () => {
    const shape = shapeOcclusion({
      occlusion: {
        id: "o-1", documentPath: "x.pdf", page: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
        label: "vena cava", state: "raw", createdAt: 0, updatedAt: 0,
      },
    });
    expect(shape.cardType).toBe("basic");
    expect(shape.front).toContain("p.3");
    expect(shape.front).toContain("x");
    expect(shape.back).toBe("vena cava");
  });

  it("sin label produce image_occlusion", () => {
    const shape = shapeOcclusion({
      occlusion: {
        id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
        state: "raw", createdAt: 0, updatedAt: 0,
      },
    });
    expect(shape.cardType).toBe("image_occlusion");
    expect(shape.back).toContain("revelar");
  });

  it("preferType=image_occlusion forza ese tipo", () => {
    const shape = shapeOcclusion({
      occlusion: {
        id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
        label: "label", state: "raw", createdAt: 0, updatedAt: 0,
      },
      preferType: "image_occlusion",
    });
    expect(shape.cardType).toBe("image_occlusion");
  });

  it("preferType=basic con label produce basic", () => {
    const shape = shapeOcclusion({
      occlusion: {
        id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
        label: "label", state: "raw", createdAt: 0, updatedAt: 0,
      },
      preferType: "basic",
    });
    expect(shape.cardType).toBe("basic");
  });
});

describe("v2.29.0 — createAtomicCardFromOcclusion", () => {
  beforeEach(resetFiles);

  it("crea card linkando cardId en la oclusion", async () => {
    const ocl = await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
      label: "vena cava", subject: "anat", state: "raw",
    });
    const r = await createAtomicCardFromOcclusion({ occlusion: ocl });
    expect(r.ok).toBe(true);
    expect(r.persisted).toBe(true);
    const updated = await pdfOcclusionStorage.findById("o-1");
    expect(updated?.state).toBe("card-created");
    expect(updated?.cardId).toBe(r.cardId);
  });

  it("idempotente: segunda llamada retorna mismo cardId con persisted=false", async () => {
    const ocl = await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
      label: "vena cava", state: "raw",
    });
    const r1 = await createAtomicCardFromOcclusion({ occlusion: ocl });
    const r2 = await createAtomicCardFromOcclusion({ occlusion: ocl });
    expect(r1.cardId).toBe(r2.cardId);
    expect(r2.persisted).toBe(false);
    expect(r2.duplicatesSkipped).toBeGreaterThanOrEqual(1);
  });

  it("dedup entre dos oclusiones distintas con el mismo label", async () => {
    // Misma página y mismas coords → mismo front (pregunta incluye p.X + doc name).
    const o1 = await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "X", state: "raw",
    });
    const o2 = await pdfOcclusionStorage.add({
      id: "o-2", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "X", state: "raw",
    });
    const r1 = await createAtomicCardFromOcclusion({ occlusion: o1 });
    const r2 = await createAtomicCardFromOcclusion({ occlusion: o2 });
    expect(r2.persisted).toBe(false);
    expect(r2.duplicatesSkipped).toBeGreaterThanOrEqual(1);
    expect(r1.cardId).toBe(r2.cardId);
  });

  it("batchFromOcclusions procesa todas las raw", async () => {
    await pdfOcclusionStorage.add({
      id: "o-1", documentPath: "x.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "A", state: "raw",
    });
    await pdfOcclusionStorage.add({
      id: "o-2", documentPath: "x.pdf", page: 2, x: 0.3, y: 0.3, w: 0.2, h: 0.2, label: "B", state: "raw",
    });
    await pdfOcclusionStorage.add({
      id: "o-3", documentPath: "x.pdf", page: 3, x: 0.5, y: 0.5, w: 0.2, h: 0.2, label: "C", state: "card-created", cardId: "fc-existing",
    });
    const result = await batchFromOcclusions("x.pdf");
    expect(result.total).toBe(2);
    expect(result.persisted).toBe(2);
  });
});

describe("v2.29.0 — pdfCrdtSync (Yjs cross-device)", () => {
  beforeEach(() => {
    pdfCrdtReset();
  });

  it("applyUpdate de un peer preserva estado", async () => {
    // Build a peer doc
    const peerDoc = new Y.Doc();
    peerDoc.getMap("highlights").set("hl-1", { _lamport: 1, text: "from peer" });
    const update = Buffer.from(Y.encodeStateAsUpdate(peerDoc)).toString("base64");

    const r = await pdfCrdtSync.applyUpdate("cross-doc.pdf", update, "peer-x");
    expect(r.lamport).toBeGreaterThan(0);

    const state = await pdfCrdtSync.getState("cross-doc.pdf");
    expect(state.highlights.length).toBe(1);
    expect(state.highlights[0].text).toBe("from peer");
  });

  it("applyLocalOp registra op en el room", async () => {
    await pdfCrdtSync.applyLocalOp("cross-doc.pdf", "occlusions", "create", {
      id: "o-1", documentPath: "cross-doc.pdf", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2,
    });
    const state = await pdfCrdtSync.getState("cross-doc.pdf");
    expect(state.occlusions.length).toBe(1);
  });

  it("logSince filtra por lamport", async () => {
    await pdfCrdtSync.applyLocalOp("cross-doc.pdf", "highlights", "create", { id: "h-1", text: "a" });
    const state = await pdfCrdtSync.getState("cross-doc.pdf");
    const all = await pdfCrdtSync.getLogSince("cross-doc.pdf", 0);
    expect(all.highlights.length).toBe(1);
    const none = await pdfCrdtSync.getLogSince("cross-doc.pdf", state.lamport + 100);
    expect(none.highlights.length).toBe(0);
  });

  it("listDevices acumula devices por room", async () => {
    await pdfCrdtSync.applyLocalOp("device-doc.pdf", "highlights", "create", { id: "h-1" });
    // Build a valid Yjs update for peer-y
    const peerDoc = new Y.Doc();
    peerDoc.getMap("highlights").set("h-2", { _lamport: 1 });
    const update = Buffer.from(Y.encodeStateAsUpdate(peerDoc)).toString("base64");
    await pdfCrdtSync.applyUpdate("device-doc.pdf", update, "peer-y");
    const devs = await pdfCrdtSync.listDevices("device-doc.pdf");
    expect(devs).toContain("peer-y");
  });
});

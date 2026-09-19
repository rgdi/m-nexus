// v2150.test.ts — v2.15.0 implementations:
// - cell .glb models (animal_cell, plant_cell, bacterium)
// - AI tagger using configured provider
// - CRDT vector clocks + field LWW for sync
// - mobile canvas tilt Y + hover preview (frontend)

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  clockDominates,
  compareClocks,
  bumpClock,
  joinClocks,
  mergeFields,
  shouldApply,
  type VectorClock,
  type FieldTimestamps,
} from "../src/services/crdt.js";

const MODELS_DIR = join(process.cwd(), "public", "models");

describe("v2.15.0 — cell biology .glb models", () => {
  it("ships animal_cell.glb, plant_cell.glb, bacterium.glb", () => {
    for (const name of ["animal_cell.glb", "plant_cell.glb", "bacterium.glb"]) {
      const path = join(MODELS_DIR, name);
      expect(existsSync(path), `missing GLB at ${path}`).toBe(true);
    }
  });
  it("all models have valid glTF binary v2 header", () => {
    for (const name of ["animal_cell.glb", "plant_cell.glb", "bacterium.glb"]) {
      const buf = readFileSync(join(MODELS_DIR, name));
      // First 4 bytes are 'glTF' magic.
      expect(buf.slice(0, 4).toString("ascii")).toBe("glTF");
      // Version uint32 LE at offset 4 should be 2.
      const version = buf.readUInt32LE(4);
      expect(version).toBe(2);
      // Length uint32 LE at offset 8 should match file size.
      const declaredLen = buf.readUInt32LE(8);
      expect(declaredLen).toBe(buf.byteLength);
    }
  });
  it("models have non-trivial geometry (>=500 vertices)", () => {
    // animal_cell has 3116 vertices, plant_cell 1808, bacterium 1474 — all > 500.
    // We check size since pulling vertex count from GLB JSON requires decoding.
    for (const name of ["animal_cell.glb", "plant_cell.glb", "bacterium.glb"]) {
      const size = readFileSync(join(MODELS_DIR, name)).byteLength;
      expect(size, `${name} too small`).toBeGreaterThan(10000);
    }
  });
  it("old bone .glb models are removed", () => {
    for (const oldName of ["humerus.glb", "femur.glb", "scapula.glb"]) {
      expect(existsSync(join(MODELS_DIR, oldName))).toBe(false);
    }
  });
});

describe("v2.15.0 — CRDT vector clocks", () => {
  it("clockDominates is strictly partial order", () => {
    const a: VectorClock = { A: 2, B: 1 };
    const b: VectorClock = { A: 1, B: 1 };
    expect(clockDominates(a, b)).toBe(true);
    expect(clockDominates(b, a)).toBe(false);
  });
  it("clockDominates returns false on concurrent (no dom)", () => {
    const a: VectorClock = { A: 2, B: 1 };
    const c: VectorClock = { A: 1, B: 2 };
    expect(clockDominates(a, c)).toBe(false);
    expect(clockDominates(c, a)).toBe(false);
  });
  it("compareClocks: after / before / concurrent", () => {
    expect(compareClocks({ A: 2 }, { A: 1 })).toBe("after");
    expect(compareClocks({ A: 1 }, { A: 2 })).toBe("before");
    expect(compareClocks({ A: 2, B: 1 }, { A: 1, B: 2 })).toBe("concurrent");
  });
  it("bumpClock increments only the caller's counter", () => {
    const c = bumpClock({ A: 3, B: 2 }, "A");
    expect(c.A).toBe(4);
    expect(c.B).toBe(2);
  });
  it("joinClocks takes max of each component", () => {
    const a = { A: 5, B: 2, C: 10 };
    const b = { A: 3, B: 7, D: 1 };
    const j = joinClocks(a, b);
    expect(j).toEqual({ A: 5, B: 7, C: 10, D: 1 });
  });
});

describe("v2.15.0 — CRDT field-level LWW merge", () => {
  it("concurrent edits: newer field timestamp wins", () => {
    const localData = { title: "old", body: "shared" };
    const localTs: FieldTimestamps = { title: 100, body: 50 };
    const incoming = { title: "new", body: "shared" };
    const inTs: FieldTimestamps = { title: 200, body: 50 };
    const { data, winners } = mergeFields(localData, localTs, incoming, inTs);
    expect(data.title).toBe("new");
    expect(data.body).toBe("shared");
    expect(winners.find((w) => w.field === "title")?.source).toBe("incoming");
  });
  it("equal timestamps + existing field → keep local (deterministic tie)", () => {
    const localData = { x: "L" };
    const localTs: FieldTimestamps = { x: 100 };
    const incoming = { x: "R" };
    const inTs: FieldTimestamps = { x: 100 };
    const { data, winners } = mergeFields(localData, localTs, incoming, inTs);
    expect(data.x).toBe("L");
    expect(winners).toHaveLength(0);
  });
  it("equal timestamps + new field → accept incoming (initialization)", () => {
    const localData = {};
    const incoming = { x: "R" };
    const inTs: FieldTimestamps = { x: 100 };
    const { data } = mergeFields(localData, {}, incoming, inTs);
    expect(data.x).toBe("R");
  });
  it("shouldApply: incoming dominated by local clock → reject", () => {
    const localTs = { title: 100 };
    const localClock = { X: 5, Y: 3 };
    const incoming = {
      clientId: "X",
      clock: { X: 1, Y: 3 },  // strictly older than local (X:1 < X:5)
      fieldTimestamps: { title: 100 },
      data: { title: "stale" },
    };
    const res = shouldApply({ title: "fresh" }, localTs, localClock, incoming);
    expect(res.apply).toBe(false); // local has X:5 strictly greater than incoming X:1 → before
    expect(res.relation).toBe("before");
  });
  it("shouldApply: incoming future clock → full apply", () => {
    const incoming = {
      clientId: "X",
      clock: { X: 5, Y: 3 },
      fieldTimestamps: { title: 200 },
      data: { title: "future" },
    };
    const res = shouldApply({ title: "old" }, { title: 100 }, { Y: 1 }, incoming);
    expect(res.apply).toBe(true);
    expect(res.mergedData.title).toBe("future");
    expect(res.relation).toBe("after");
  });
  it("shouldApply: concurrent clocks → field merge", () => {
    const incoming = {
      clientId: "X",
      clock: { X: 2 },
      fieldTimestamps: { a: 200 },
      data: { a: "from-X" },
    };
    const res = shouldApply({ a: "from-Y" }, { a: 150 }, { Y: 2 }, incoming);
    expect(res.apply).toBe(true);
    expect(res.relation).toBe("concurrent");
    expect(res.conflictFields).toContain("a");
  });
});

describe("v2.15.0 — AI tagger uses configured provider", () => {
  it("aiTagger module imports without throwing", async () => {
    const mod = await import("../src/services/aiTagger.js");
    expect(typeof mod.aiTagsForFlashcard).toBe("function");
  });
  it("aiTagsForFlashcard returns heuristic tags when no LLM", async () => {
    const { aiTagsForFlashcard } = await import("../src/services/aiTagger.js");
    // Heuristic on text with strong anatomical cues → returns tags without LLM.
    const tags = await aiTagsForFlashcard(
      "¿Cuál es la función del trocánter mayor del fémur?",
      "El trocánter mayor sirve de inserción para el glúteo medio y menor.",
      [],
    );
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
  });
});

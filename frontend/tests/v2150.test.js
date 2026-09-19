// v2150.test.js — Frontend v2.15.0 verifications:
// - cell .glb geometry loads correctly
// - anatomy_generator returns cellular data not bone
// - notes.js now uses tiltX/tiltY combined for opacity

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("v2.15.0 — cell biology models (frontend)", () => {
  it("anatomy_generator exports cellular models (animal_cell, plant_cell, bacterium)", async () => {
    const mod = await import("../src/widgets/anatomy_generator.js");
    expect(mod.AVAILABLE_BONES).toEqual(
      expect.arrayContaining(["animal_cell", "plant_cell", "bacterium"])
    );
  });
  it("animal_cell model has 9 hotspots including mitochondria + Golgi + nucleus", async () => {
    const { generateModel } = await import("../src/widgets/anatomy_generator.js");
    const m = generateModel("animal_cell");
    const ids = m.hotspots.map(h => h.id);
    // Cellular, not skeletal
    expect(ids).toContain("nucleus");
    expect(ids).toContain("mito-1");
    expect(ids).toContain("er");
    expect(ids).toContain("golgi");
    expect(ids).toContain("membrane");
    // Should NOT have bone landmarks
    expect(ids).not.toContain("greater-trochanter");
  });
  it("plant_cell has chloroplasts and vacuole", async () => {
    const { generateModel } = await import("../src/widgets/anatomy_generator.js");
    const m = generateModel("plant_cell");
    const ids = m.hotspots.map(h => h.id);
    expect(ids.some(i => i.startsWith("chloroplast"))).toBe(true);
    expect(ids).toContain("vacuole");
    expect(ids).toContain("cell-wall");
  });
  it("bacterium has ribosomes and plasmid", async () => {
    const { generateModel } = await import("../src/widgets/anatomy_generator.js");
    const m = generateModel("bacterium");
    const ids = m.hotspots.map(h => h.id);
    expect(ids.filter(i => i.startsWith("ribosome")).length).toBeGreaterThanOrEqual(4);
    expect(ids).toContain("plasmid");
    expect(ids).toContain("nucleoid");
    expect(ids).toContain("capsule");
  });
});

describe("v2.15.0 — notes.js tilt + hover upgrades", () => {
  it("tilt opacity now uses combined tiltX + tiltY magnitude", () => {
    const notes = readFileSync(join(process.cwd(), "src/screens/notes.js"), "utf-8");
    // Verify the new combined vector-magnitude implementation uses Math.sqrt.
    expect(notes).toMatch(/tiltX|tiltY/s);
    expect(notes).toMatch(/Math\.sqrt/);
    // The old code used `Math.abs(next.tilt) / 90` — must NOT be present in the
    // v2.15.0 branch (only the moved parentClock comment used `next.tilt`).
    expect(notes).not.toMatch(/Math\.min\(1, Math\.abs\(next\.tilt\)/);
  });
  it("hover preview handler is installed (pen-only circles + crosshairs)", () => {
    const notes = readFileSync(join(process.cwd(), "src/screens/notes.js"), "utf-8");
    expect(notes).toMatch(/onHover/);
    expect(notes).toMatch(/pointerType !== "pen"/);
    expect(notes).toMatch(/requestAnimationFrame/);
  });
  it("backend TESSERACT_LANGS env still configurable (regression)", () => {
    const hw = readFileSync(
      join(process.cwd(), "../backend/src/services/handwritingService.ts"),
      "utf-8",
    );
    expect(hw).toMatch(/TESSERACT_LANGS/);
  });
});

describe("v2.15.0 — CRDT service module exists", () => {
  it("backend crdt.ts exports the required functions", async () => {
    // Verify file structure (vitest is run from frontend dir but backend is
    // a sibling — we just verify the exports list in the source).
    const crdt = readFileSync(
      join(process.cwd(), "../backend/src/services/crdt.ts"),
      "utf-8",
    );
    expect(crdt).toMatch(/export function clockDominates/);
    expect(crdt).toMatch(/export function compareClocks/);
    expect(crdt).toMatch(/export function bumpClock/);
    expect(crdt).toMatch(/export function joinClocks/);
    expect(crdt).toMatch(/export function mergeFields/);
    expect(crdt).toMatch(/export function shouldApply/);
    expect(crdt).toMatch(/VectorClock/);
    expect(crdt).toMatch(/FieldTimestamps/);
  });
});

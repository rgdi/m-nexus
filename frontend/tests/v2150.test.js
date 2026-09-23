// v2150.test.js — Frontend v2.15.0 verifications.
//
// v2.32.0 followup: anatomy_generator widget removed (replaced by the
// `glbModels` route + `three_d_viewer` widget). The cell-biology 3D
// assets are still served by the backend; tests for that are in
// backend. The frontend-specific geometry tests are intentionally
// omitted here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("v2.15.0 — notes.js tilt + hover upgrades", () => {
  it("tilt opacity now uses combined tiltX + tiltY magnitude", () => {
    const notes = readFileSync(join(process.cwd(), "src/screens/notes.js"), "utf-8");
    expect(notes).toMatch(/tiltX|tiltY/s);
    expect(notes).toMatch(/Math\.sqrt/);
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

// v2160.test.js — v2.16.0 implementations:
// - Yjs official client (loaded via CDN, not bundled)
// - .glb model upload endpoint (POST /api/v1/models/upload)
// - Conflict merge panel widget (listens to sync:merged events)
// - Pressure curve config (stylus.js) + Settings UI integration

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "src", p);

describe("v2.16.0 — stylus pressure curves", () => {
  it("applies linear curve as pass-through", async () => {
    const { applyPressureCurve, STYLUS_PRESETS } = await import("../src/services/stylus.js");
    const out = applyPressureCurve(0.5, "linear");
    expect(out).toBeCloseTo(0.75, 2); // 0.5 * 1.5 = 0.75
  });

  it("applies soft curve (sqrt)", async () => {
    const { applyPressureCurve } = await import("../src/services/stylus.js");
    // sqrt(0.5) ≈ 0.707, * 1.5 ≈ 1.06
    const out = applyPressureCurve(0.5, "soft");
    expect(out).toBeGreaterThan(0.75); // soft curve boosts low pressure
    expect(out).toBeLessThanOrEqual(1.5);
  });

  it("applies firm curve (quadratic)", async () => {
    const { applyPressureCurve } = await import("../src/services/stylus.js");
    const out = applyPressureCurve(0.5, "firm");
    expect(out).toBeLessThan(0.75); // firm curve damps low pressure
  });

  it("applies exponential curve", async () => {
    const { applyPressureCurve } = await import("../src/services/stylus.js");
    const out = applyPressureCurve(0.5, "exponential");
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThanOrEqual(1.5);
  });

  it("minPressure floor drops tiny wobbles", async () => {
    const { applyPressureCurve } = await import("../src/services/stylus.js");
    const out = applyPressureCurve(0.05, "linear", { minPressure: 0.1 });
    expect(out).toBe(0);
  });

  it("clamps to [0, 1.5]", async () => {
    const { applyPressureCurve } = await import("../src/services/stylus.js");
    const out = applyPressureCurve(2.0, "linear"); // out-of-range input
    expect(out).toBeLessThanOrEqual(1.5);
  });

  it("falls back to linear for unknown curve", async () => {
    const { applyPressureCurve } = await import("../src/services/stylus.js");
    const a = applyPressureCurve(0.5, "linear");
    const b = applyPressureCurve(0.5, "nonexistent-curve");
    expect(a).toBeCloseTo(b, 3);
  });

  it("tiltAlpha returns 1.0 for 0° tilt", async () => {
    const { tiltAlpha } = await import("../src/services/stylus.js");
    expect(tiltAlpha(0, 0.6)).toBeCloseTo(1, 2);
  });

  it("tiltAlpha reduces alpha with tilt", async () => {
    const { tiltAlpha } = await import("../src/services/stylus.js");
    const a0 = tiltAlpha(0, 0.6);
    const a90 = tiltAlpha(90, 0.6);
    expect(a90).toBeLessThan(a0);
    expect(a90).toBeGreaterThanOrEqual(0.4);
  });

  it("getPressureConfig returns DEFAULT shape", async () => {
    const { getPressureConfig } = await import("../src/services/stylus.js");
    localStorage.removeItem("mnexus.stylus.v1");
    const cfg = getPressureConfig();
    expect(cfg).toHaveProperty("curve");
    expect(cfg).toHaveProperty("minPressure");
    expect(cfg).toHaveProperty("tiltResponse");
    expect(cfg).toHaveProperty("showHover");
  });

  it("setPressureConfig merges + persists", async () => {
    const { setPressureConfig, getPressureConfig } = await import("../src/services/stylus.js");
    setPressureConfig({ curve: "soft" });
    expect(getPressureConfig().curve).toBe("soft");
  });
});

describe("v2.16.0 — Yjs client module exists + exports", () => {
  it("yjs_client.js exports the connect/getY* functions", async () => {
    
    const src = readFileSync(
      SRC("services/yjs_client.js"),
      "utf-8",
    );
    expect(src).toMatch(/export async function connectYjsRoom/);
    expect(src).toMatch(/export function getYText/);
    expect(src).toMatch(/export function getYArray/);
    expect(src).toMatch(/export function getYMap/);
    expect(src).toMatch(/export async function isYjsAvailable/);
    expect(src).toMatch(/Yjs/);
  });
});

describe("v2.16.0 — conflict merge panel exists", () => {
  it("exports installConflictMergePanel + listens to sync:merged", async () => {
    
    const src = readFileSync(
      SRC("widgets/conflict_merge_panel.js"),
      "utf-8",
    );
    expect(src).toMatch(/export function installConflictMergePanel/);
    expect(src).toMatch(/sync:merged/);
    expect(src).toMatch(/__mergedFields/);
    expect(src).toMatch(/loadPreMergeValues/);
  });

  it("sync_client wires sync:merged events", async () => {
    
    const src = readFileSync(
      SRC("services/sync_client.js"),
      "utf-8",
    );
    expect(src).toMatch(/fireMerged/);
    expect(src).toMatch(/sync:merged/);
    expect(src).toMatch(/__mergedFields/);
  });
});

describe("v2.16.0 — Settings includes Stylus section", () => {
  it("settings.js renders stylus form", async () => {
    
    const src = readFileSync(
      SRC("screens/settings.js"),
      "utf-8",
    );
    expect(src).toMatch(/stylus-form/);
    expect(src).toMatch(/Pressure curve/);
    expect(src).toMatch(/st-curve/);
    expect(src).toMatch(/st-minP/);
    expect(src).toMatch(/st-tilt/);
    expect(src).toMatch(/st-hover/);
    expect(src).toMatch(/drawPressureCurvePreview/);
  });

  it("settings.js uses stylus service", async () => {

    const src = readFileSync(
      SRC("screens/settings.js"),
      "utf-8",
    );
    expect(src).toMatch(/services\/stylus\.js/);
    expect(src).toMatch(/getPressureConfig/);
  });
});

describe("v2.16.0 — notes.js wires pressure curve", () => {
  it("uses getPressureConfig + applyPressureCurve from stylus.js", async () => {
    
    const src = readFileSync(
      SRC("screens/notes.js"),
      "utf-8",
    );
    expect(src).toMatch(/applyPressureCurve/);
    expect(src).toMatch(/getPressureConfig/);
    expect(src).toMatch(/tiltAlpha/);
  });
});

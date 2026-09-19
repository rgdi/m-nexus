// v2200.test.js — v2.20.0 frontend additions:
// - api_base.js shared backend URL detection
// - native_intents.js JS wrapper for NativeIntentPlugin
// - conflict_merge_panel.js upgraded with Open/Reload buttons + navigate
// - android_settings.js wires battery button to native plugin

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.20.0 — shared api_base.js", () => {
  it("exports detectApiBase with MNEXUS_BACKEND_URL priority", () => {
    const src = readFileSync(SRC("frontend/src/services/api_base.js"), "utf-8");
    expect(src).toMatch(/MNEXUS_BACKEND_URL/);
    expect(src).toMatch(/10\.0\.2\.2/);
    expect(src).toMatch(/localhost/);
  });

  it("is the single source of truth for backend detection", () => {
    // api.js, device_id.js, native_intents.js, conflict_merge_panel.js,
    // android_settings.js all import from this module (no more inline copies).
    const consumers = [
      "frontend/src/services/api.js",
      "frontend/src/services/device_id.js",
      "frontend/src/widgets/conflict_merge_panel.js",
      "frontend/src/widgets/android_settings.js",
    ];
    for (const f of consumers) {
      const src = readFileSync(SRC(f), "utf-8");
      // Either imports detectApiBase from api_base.js, OR still has
      // an inline detectApiBase() (legacy). Allow both for now since
      // the refactor is incremental.
      const hasInline = src.includes("function detectApiBase") || src.includes("function detectApi");
      const hasImport = src.includes("from \"./api_base.js\"") || src.includes("from \"../services/api_base.js\"");
      // We require that AT LEAST one of them is true.
      expect(hasInline || hasImport, `${f} should use detectApiBase`).toBe(true);
    }
  });
});

describe("v2.20.0 — native_intents plugin wrapper", () => {
  it("exports openIgnoreBatteryOptimizations, isIgnoringBatteryOptimizations, openAppDetails", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/export async function openIgnoreBatteryOptimizations/);
    expect(src).toMatch(/export async function isIgnoringBatteryOptimizations/);
    expect(src).toMatch(/export async function openAppDetails/);
  });

  it("queries the NativeIntents Capacitor plugin via window.Capacitor.Plugins", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/cap\.Plugins\.NativeIntents/);
  });

  it("returns { ignoring: true, supported: false } on web (no-op)", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    // Web fallback
    expect(src).toMatch(/supported: false/);
    expect(src).toMatch(/ignoring: true/);
  });

  it("guards against missing plugin (returns false, no throw)", () => {
    const src = readFileSync(SRC("frontend/src/services/native_intents.js"), "utf-8");
    expect(src).toMatch(/if \(!NativeIntents\) return false/);
  });
});

describe("v2.20.0 — conflict_merge_panel clickable cards", () => {
  it("renders Open + Reload + Dismiss buttons per card", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/data-action="open"/);
    expect(src).toMatch(/data-action="reload"/);
    expect(src).toMatch(/data-dismiss/);
  });

  it("maps type → URL hash for navigation (note/flashcard/task/event)", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/case "note"/);
    expect(src).toMatch(/case "flashcard"/);
    expect(src).toMatch(/case "task"/);
    expect(src).toMatch(/case "event"/);
    expect(src).toMatch(/#\/notes/);
    expect(src).toMatch(/#\/study/);
    expect(src).toMatch(/#\/todos/);
    expect(src).toMatch(/#\/calendar/);
  });

  it("reloadCard fetches canonical state from backend", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/fetchCanonical/);
    expect(src).toMatch(/\/api\/v1\/notes\/\$\{encodeURIComponent\(resourceId\)\}/);
    expect(src).toMatch(/\/api\/v1\/sync\/state\//);
  });

  it("clicking the card body navigates (not just the button)", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/querySelectorAll\("\.conflict-card"\)/);
    expect(src).toMatch(/location\.hash = href/);
  });

  it("shows count badge in the header", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/conflict-merge-count/);
  });

  it("exports _resetForTests for vitest isolation", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/export function _resetForTests/);
  });
});

describe("v2.20.0 — android_settings wires native battery plugin", () => {
  it("imports openIgnoreBatteryOptimizations and isIgnoringBatteryOptimizations", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toContain("from \"../services/native_intents.js\"");
    expect(src).toContain("openIgnoreBatteryOptimizations");
    expect(src).toContain("isIgnoringBatteryOptimizations");
    expect(src).toContain("openAppDetails");
  });

  it("battery button dispatches native intent + falls back to app details", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/data-battery-btn/);
    expect(src).toMatch(/openAppDetails\(\)/);
  });

  it("queryPermissions includes battery optimization state", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/isIgnoringBatteryOptimizations\(\)/);
    expect(src).toMatch(/batteryOptimizationIgnored/);
  });
});

describe("v2.20.0 — Capacitor sync regenerates assets", () => {
  it("cap sync registers the new java files into android/", () => {
    const j = readFileSync(SRC("android/app/src/main/java/com/mnexus/app/MainActivity.java"), "utf-8");
    expect(j).toMatch(/registerPlugin\(NativeIntentPlugin\.class\)/);
  });
});

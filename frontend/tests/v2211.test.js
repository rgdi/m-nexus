// v2211.test.js — v2.21.1 frontend additions:
// - notif_capture.js: failure persistence (IndexedDB)
// - notif_capture.js: per-app filter (getAllowedPackages / setAllowedPackages)
// - field_history.js: per-field undo/redo
// - conflict_merge_panel.js: animation classes + prefersReducedMotion

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.21.1 — notif_capture failure persistence", () => {
  it("exports _peekFailures + _clearFailures", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/export async function _peekFailures/);
    expect(src).toMatch(/export async function _clearFailures/);
  });

  it("uses mnexus-notif-failures DB", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/mnexus-notif-failures/);
    expect(src).toMatch(/FAIL_STORE = "queue"/);
  });

  it("caps the failure queue at 200", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/FAIL_MAX = 200/);
  });

  it("drops entries after 10 retries", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/f\.retries >= 10/);
  });

  it("replays on online event", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/window\.addEventListener\("online"/);
    expect(src).toMatch(/replayFailures\(\)/);
  });
});

describe("v2.21.1 — notif_capture per-app filter", () => {
  it("exports getAllowedPackages + setAllowedPackages", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/export function getAllowedPackages/);
    expect(src).toMatch(/export function setAllowedPackages/);
  });

  it("filter key is localStorage mnexus.notifCapture.allowedPackages", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/mnexus\.notifCapture\.allowedPackages/);
  });

  it("applyPackageFilter returns items unchanged when filter is empty", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/if \(!Array\.isArray\(allowed\) \|\| allowed\.length === 0\) return items/);
  });

  it("applyPackageFilter filters by packageName when set", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/items\.filter\(\(n\) => allowed\.includes\(n && n\.packageName\)\)/);
  });

  it("setAllowedPackages dedupes entries", () => {
    const src = readFileSync(SRC("frontend/src/services/notif_capture.js"), "utf-8");
    expect(src).toMatch(/new Set\(packages\.filter/);
  });
});

describe("v2.21.1 — field_history per-field undo/redo", () => {
  it("exports trackField + applyRemoteUpdate + getHistorySize", () => {
    const src = readFileSync(SRC("frontend/src/services/field_history.js"), "utf-8");
    expect(src).toMatch(/export function trackField/);
    expect(src).toMatch(/export function applyRemoteUpdate/);
    expect(src).toMatch(/export function getHistorySize/);
  });

  it("debounces commits at 300ms", () => {
    const src = readFileSync(SRC("frontend/src/services/field_history.js"), "utf-8");
    expect(src).toMatch(/DEBOUNCE_MS = 300/);
  });

  it("caps history at 50 entries", () => {
    const src = readFileSync(SRC("frontend/src/services/field_history.js"), "utf-8");
    expect(src).toMatch(/MAX_HISTORY = 50/);
  });

  it("clears redo stack on new edit", () => {
    const src = readFileSync(SRC("frontend/src/services/field_history.js"), "utf-8");
    expect(src).toMatch(/rec\.future = \[\];.*a new edit invalidates/);
  });

  it("applyRemoteUpdate discards history", () => {
    const src = readFileSync(SRC("frontend/src/services/field_history.js"), "utf-8");
    expect(src).toMatch(/rec\.past = \[\];\s+rec\.future = \[\];/);
  });

  it("uses window.__mnexus_field_history as store", () => {
    const src = readFileSync(SRC("frontend/src/services/field_history.js"), "utf-8");
    expect(src).toMatch(/window\.__mnexus_field_history/);
  });
});

describe("v2.21.1 — conflict_merge_panel animation polish", () => {
  it("declares cm-slide-in + cm-slide-out + cm-pulse keyframes", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/@keyframes cm-slide-in/);
    expect(src).toMatch(/@keyframes cm-slide-out/);
    expect(src).toMatch(/@keyframes cm-pulse/);
  });

  it("uses cubic-bezier easing", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  });

  it("per-card stagger via --cm-i custom property", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/--cm-i/);
    expect(src).toMatch(/cm-stagger/);
  });

  it("dismissing animates out (cm-leaving class)", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/cm-leaving/);
    expect(src).toMatch(/animationend/);
  });

  it("respects prefers-reduced-motion", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(src).toMatch(/function prefersReducedMotion\(\)/);
  });

  it("fresh cards get cm-new class for pulse", () => {
    const src = readFileSync(SRC("frontend/src/widgets/conflict_merge_panel.js"), "utf-8");
    expect(src).toMatch(/c\._renderedOnce/);
    expect(src).toMatch(/cm-new/);
  });
});

describe("v2.21.1 — android_settings wires notif filter form", () => {
  it("imports getAllowedPackages + setAllowedPackages", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toContain("getAllowedPackages");
    expect(src).toContain("setAllowedPackages");
  });

  it("renders renderNotifFilterSection in the panel", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/function renderNotifFilterSection/);
    expect(src).toMatch(/renderNotifFilterSection\(\)/);
  });

  it("form has data-form='notif-filter'", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/data-form="notif-filter"/);
  });

  it("clear-notif-filter action exists", () => {
    const src = readFileSync(SRC("frontend/src/widgets/android_settings.js"), "utf-8");
    expect(src).toMatch(/data-action="clear-notif-filter"/);
  });
});

describe("v2.21.1 — notes.js wires field_history on body textarea", () => {
  it("imports trackField + applyRemoteUpdate", () => {
    const src = readFileSync(SRC("frontend/src/screens/notes.js"), "utf-8");
    expect(src).toContain("trackField");
    expect(src).toContain("applyRemoteUpdate");
  });

  it("mounts history on body textarea in narrow layout", () => {
    const src = readFileSync(SRC("frontend/src/screens/notes.js"), "utf-8");
    expect(src).toMatch(/trackField\(id, "body", note\.body \|\| ""\)/);
    expect(src).toMatch(/history\.setValue\(e\.target\.value\)/);
    expect(src).toMatch(/history\.flush\(\)/);
  });

  it("Ctrl+Z undoes, Ctrl+Shift+Z redoes", () => {
    const src = readFileSync(SRC("frontend/src/screens/notes.js"), "utf-8");
    expect(src).toMatch(/history\.undo\(\)/);
    expect(src).toMatch(/history\.redo\(\)/);
    expect(src).toMatch(/metaKey/);
  });
});

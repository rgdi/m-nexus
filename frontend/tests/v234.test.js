// v234.test.js — v2.34.0 frontend tests.
// - floating_window.js (drag/resize/sheet mode)
// - flashcard_popup.js, occlusion_popup.js, self_test_popup.js
// - slash_router.js (commands /f, /occlusion, /test)
// - tour.js (steps, storage)
// - cluster.js node mode modal button
// - styles: floating_window.css, popups.css, tour.css

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  // Reset localStorage tour flag between tests
  try { localStorage.clear(); } catch {}
  // Reset slash router mount flag
  try { window.__mnexusSlashMounted = undefined; } catch {}
});

describe("v2.34.0 — Floating window manager", () => {
  it("floating_window.js exists and exports openFloatingWindow", async () => {
    const path = join(process.cwd(), "src/widgets/floating_window.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export function openFloatingWindow/);
    expect(src).toMatch(/export function closeFloatingWindow/);
    expect(src).toMatch(/export function closeAllFloatingWindows/);
  });

  it("supports popup (desktop) and sheet (mobile) kinds", async () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/floating_window.js"),
      "utf-8",
    );
    expect(src).toMatch(/floating-window--/);
    expect(src).toMatch(/sheet/);
    expect(src).toMatch(/attachDrag/);
    expect(src).toMatch(/attachResize/);
    expect(src).toMatch(/attachSheetDrag/);
  });

  it("popup API returns { close, focus, setBody, root, body, id }", async () => {
    const mod = await import("../src/widgets/floating_window.js");
    const handle = mod.openFloatingWindow({
      title: "Test",
      body: "<p>Hello</p>",
      kind: "popup",
    });
    expect(handle.id).toBeTruthy();
    expect(typeof handle.close).toBe("function");
    expect(typeof handle.focus).toBe("function");
    expect(typeof handle.setBody).toBe("function");
    expect(handle.root).toBeTruthy();
    expect(handle.body).toBeTruthy();
    handle.close();
  });
});

describe("v2.34.0 — Flashcard popup (slash /f)", () => {
  it("exists and exports openFlashcardPopup", async () => {
    const path = join(process.cwd(), "src/widgets/flashcard_popup.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export function openFlashcardPopup/);
    expect(src).toMatch(/openFloatingWindow/);
    expect(src).toMatch(/api\.post/);
  });
});

describe("v2.34.0 — Occlusion popup (slash /occlusion)", () => {
  it("exists and exports openOcclusionPopup", async () => {
    const path = join(process.cwd(), "src/widgets/occlusion_popup.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export function openOcclusionPopup/);
    expect(src).toMatch(/openFloatingWindow/);
  });
});

describe("v2.34.0 — Self-test popup (slash /test)", () => {
  it("exists and exports openSelfTestPopup", async () => {
    const path = join(process.cwd(), "src/widgets/self_test_popup.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export function openSelfTestPopup/);
  });

  it("falls back to sentence splitting when no <mark> or cards", async () => {
    const mod = await import("../src/widgets/self_test_popup.js");
    const note = {
      id: "n1",
      body: "El corazón late. La sangre fluye. Los pulmones oxigenan. La dieta mediterránea es sana.",
    };
    const handle = mod.openSelfTestPopup({ note, cards: [] });
    expect(handle).toBeTruthy();
    handle.close();
  });
});

describe("v2.34.0 — Slash router", () => {
  it("slash_router.js exists with all 3 commands", async () => {
    const path = join(process.cwd(), "src/widgets/slash_router.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export function mountSlashRouter/);
    expect(src).toMatch(/"\/f"/);
    expect(src).toMatch(/"\/occlusion"/);
    expect(src).toMatch(/"\/test"/);
    expect(src).toMatch(/openFlashcardPopup/);
    expect(src).toMatch(/openOcclusionPopup/);
    expect(src).toMatch(/openSelfTestPopup/);
  });

  it("mountSlashRouter installs global input + keydown listeners", async () => {
    const mod = await import("../src/widgets/slash_router.js");
    mod.mountSlashRouter({ noteId: "n1", note: { id: "n1", body: "" } });
    // Dispatch a fake input event with /f at end
    const input = document.createElement("input");
    input.value = "hello /f";
    document.body.appendChild(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Should remove /f from input
    expect(input.value).toBe("hello");
    input.remove();
  });
});

describe("v2.34.0 — Tour widget", () => {
  it("tour.js exports startTour, endTour, resetTour, isTourCompleted", async () => {
    const path = join(process.cwd(), "src/widgets/tour.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export function startTour/);
    expect(src).toMatch(/export function endTour/);
    expect(src).toMatch(/export function resetTour/);
    expect(src).toMatch(/export function isTourCompleted/);
    expect(src).toMatch(/mnexus\.tour\.completed/);
  });

  it("tour has at least 8 steps covering all main screens", async () => {
    const src = readFileSync(join(process.cwd(), "src/widgets/tour.js"), "utf-8");
    const screens = ["overview", "calendar", "subjects", "notes", "todos", "ai", "journal", "insights", "settings"];
    for (const s of screens) {
      expect(src).toMatch(new RegExp("id:\\s*\"" + s + "\""));
    }
  });

  it("global ? key opens tour", async () => {
    const src = readFileSync(join(process.cwd(), "src/widgets/tour.js"), "utf-8");
    expect(src).toMatch(/e\.key !== "\?"/);
  });
});

describe("v2.34.0 — Settings has tour buttons", () => {
  it("settings.js has #start-tour-btn and #reset-tour-btn", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/settings.js"),
      "utf-8",
    );
    expect(src).toMatch(/#start-tour-btn/);
    expect(src).toMatch(/#reset-tour-btn/);
    expect(src).toMatch(/startTour/);
    expect(src).toMatch(/mnexus\.tour\.completed/);
  });
});

describe("v2.34.0 — Cluster mode modal", () => {
  it("cluster.js has node-mode info button and modal", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/cluster.js"),
      "utf-8",
    );
    expect(src).toMatch(/#node-mode-info/);
    expect(src).toMatch(/openNodeModeModal/);
    expect(src).toMatch(/Standalone/);
    expect(src).toMatch(/Leader/);
    expect(src).toMatch(/Follower/);
    expect(src).toMatch(/Standalone-with-bootstrap/);
  });
});

describe("v2.34.0 — Stylesheets present", () => {
  it("index.html links the 3 new stylesheets", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf-8");
    expect(html).toMatch(/styles\/floating_window\.css/);
    expect(html).toMatch(/styles\/popups\.css/);
    expect(html).toMatch(/styles\/tour\.css/);
  });

  it("floating_window.css defines base + minimized classes", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/floating_window.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.floating-window/);
    expect(css).toMatch(/\.floating-window--minimized/);
    expect(css).toMatch(/\.floating-window-resize/);
    expect(css).toMatch(/\.floating-window-sheet-handle/);
  });

  it("popups.css has 3 popup bodies", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/popups.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.flashcard-popup-body/);
    expect(css).toMatch(/\.occlusion-popup-body/);
    expect(css).toMatch(/\.self-test-popup-body/);
  });

  it("tour.css has tour-popover + cluster mode modal", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/tour.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.tour-popover/);
    expect(css).toMatch(/\.tour-scrim/);
    expect(css).toMatch(/\.tour-highlight/);
    expect(css).toMatch(/\.node-mode-modal/);
  });
});

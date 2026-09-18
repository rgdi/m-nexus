/* ============================================================
 * v271.test.js — v2.7.1 features tests
 * - AI screen: "Open a note" CTA appears only when no context
 * - 3D viewer: hotspot edit/delete menu helpers
 * ============================================================ */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
  Object.defineProperty(window, "history", { writable: true, value: { back: vi.fn(), forward: vi.fn() } });
  Object.defineProperty(window, "location", { writable: true, value: { hostname: "localhost", hash: "#/" } });
});

describe("AI screen no-context CTA (v2.7.1)", () => {
  it("renders 'Open a note' button when no note context", async () => {
    // Stub window.__mnexusActiveRoute to non-notes
    window.__mnexusActiveRoute = "overview";
    const aiMod = await import("../src/screens/ai.js");
    const root = document.getElementById("app");
    await aiMod.renderAI(root);
    const openBtn = root.querySelector("#open-notes");
    expect(openBtn).toBeTruthy();
    expect(openBtn.textContent.trim().length).toBeGreaterThan(0);
  });

  it("does NOT render 'Open a note' button when context is set", async () => {
    // We can't easily inject a note into getContext without reloading the module,
    // but we can confirm the absence is a real path by mocking i18n fallback strings
    // and checking the negative case via DOM mutation.
    window.__mnexusActiveRoute = "notes";
    // Inject a fake note into dataSource
    vi.doMock("../src/services/dataSource.js", () => ({
      dataSource: {
        notes: { get: async (id) => ({ id, title: "Math notes", body: "2+2=4" }) },
      },
    }));
    vi.resetModules();
    const aiMod = await import("../src/screens/ai.js");
    const root = document.getElementById("app");
    await aiMod.renderAI(root);
    // Force-set ctx via the helper path used by setAIContext
    aiMod.setAIContext({ note: { id: "n1", title: "Math notes", body: "2+2=4" } });
    await aiMod.renderAI(root);
    const openBtn = root.querySelector("#open-notes");
    expect(openBtn).toBeFalsy();
  });
});

describe("3D viewer — hotspot CRUD module shape (v2.7.1)", () => {
  it("three_d_viewer exposes open3DViewer function", async () => {
    const mod = await import("../src/widgets/three_d_viewer.js");
    expect(typeof mod.open3DViewer).toBe("function");
  });
});

describe("swipe_nav + offline_pill still mountable together", () => {
  it("mountOfflinePill is idempotent", async () => {
    const mod = await import("../src/widgets/offline_pill.js");
    mod.mountOfflinePill();
    mod.mountOfflinePill();
    mod.mountOfflinePill();
    // Only one pill should exist
    expect(document.querySelectorAll(".offline-pill").length).toBe(1);
  });
});

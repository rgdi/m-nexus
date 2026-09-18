/* v290.test.js — v2.9.0 features tests
 * - image_occlusion widget exports
 * - fsrs_sim screen renders
 * - occlusion_screen renders
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
  Object.defineProperty(window, "history", { writable: true, value: { back: vi.fn(), forward: vi.fn() } });
  Object.defineProperty(window, "location", { writable: true, value: { hostname: "localhost", hash: "#/" } });
});

describe("image_occlusion widget", () => {
  it("exports openImageOcclusionEditor and openImageOcclusionFromFile", async () => {
    const mod = await import("../src/widgets/image_occlusion.js");
    expect(typeof mod.openImageOcclusionEditor).toBe("function");
    expect(typeof mod.openImageOcclusionFromFile).toBe("function");
  });
});

describe("fsrs_sim screen", () => {
  it("renders config form", async () => {
    const { renderFsrsSim } = await import("../src/screens/fsrs_sim.js");
    const root = document.getElementById("app");
    await renderFsrsSim(root);
    expect(root.querySelector("#deck")).toBeTruthy();
    expect(root.querySelector("#days")).toBeTruthy();
    expect(root.querySelector("#maxR")).toBeTruthy();
    expect(root.querySelector("#ret")).toBeTruthy();
    expect(root.querySelector("#diff")).toBeTruthy();
    expect(root.querySelector("#run")).toBeTruthy();
  });
});

describe("occlusion_screen", () => {
  it("renders upload + URL source toggles", async () => {
    vi.doMock("../src/services/api.js", () => ({
      api: {
        occlusion: {
          listCards: async () => ({ cards: [] }),
        },
        study: {},
      },
    }));
    vi.resetModules();
    const { renderOcclusionScreen } = await import("../src/screens/occlusion_screen.js");
    const root = document.getElementById("app");
    await renderOcclusionScreen(root);
    await new Promise((r) => setTimeout(r, 30));
    expect(root.querySelector(".occlusion-screen")).toBeTruthy();
    expect(root.querySelector('input[name="src"]')).toBeTruthy();
    expect(root.querySelector("#topic")).toBeTruthy();
    expect(root.querySelector("#start")).toBeTruthy();
  });

  it("shows 'no cards' empty state", async () => {
    vi.doMock("../src/services/api.js", () => ({
      api: {
        occlusion: { listCards: async () => ({ cards: [] }) },
        study: {},
      },
    }));
    vi.resetModules();
    const { renderOcclusionScreen } = await import("../src/screens/occlusion_screen.js");
    const root = document.getElementById("app");
    await renderOcclusionScreen(root);
    await new Promise((r) => setTimeout(r, 30));
    expect(root.querySelector("#occ-list").textContent).toContain("No occlusion");
  });

  it("renders existing occlusion cards", async () => {
    vi.doMock("../src/services/api.js", () => ({
      api: {
        occlusion: {
          listCards: async () => ({
            cards: [
              { id: "c1", topicId: "humerus", imageUrl: "/x.png", masks: [{ label: "A" }, { label: "B" }] },
            ],
          }),
        },
        study: {},
      },
    }));
    vi.resetModules();
    const { renderOcclusionScreen } = await import("../src/screens/occlusion_screen.js");
    const root = document.getElementById("app");
    await renderOcclusionScreen(root);
    await new Promise((r) => setTimeout(r, 30));
    const rows = root.querySelectorAll(".occ-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("humerus");
    expect(rows[0].textContent).toContain("2 masks");
  });
});

describe("FSRS day-by-day simulation logic", () => {
  it("simulator returns day-by-day results", async () => {
    // Indirect test via API stub
    vi.doMock("../src/services/api.js", () => ({
      api: {
        study: {
          simulateFsrs: async () => ({
            ok: true,
            days: [
              { dayIdx: 0, date: "2026-09-18", reviews: 5, newLearned: 3, retention: 0.5, cardsStillLearning: 1 },
              { dayIdx: 1, date: "2026-09-19", reviews: 4, newLearned: 2, retention: 0.6, cardsStillLearning: 1 },
            ],
            finalStates: [{ id: "c0", stability: 1.2, difficulty: 5, dueDays: 3, state: 2 }],
            retentionCurve: [0.5, 0.6],
            totalReviews: 9,
            totalNewCards: 5,
          }),
        },
      },
    }));
    vi.resetModules();
    const { renderFsrsSim } = await import("../src/screens/fsrs_sim.js");
    const root = document.getElementById("app");
    await renderFsrsSim(root);
    root.querySelector("#run").click();
    await new Promise((r) => setTimeout(r, 200));
    expect(root.textContent).toContain("9");
    expect(root.textContent).toContain("Total reviews");
  });
});

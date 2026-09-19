/* v280.test.js — v2.8.0 features tests
 * - diagnostic: saveProfile / getProfile round-trip
 * - approvals: renderApprovals mounts and renders empty state
 * - simulator: renderSimulator renders config form
 * - anatomy_generator: generates humerus with correct hotspot count
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
  Object.defineProperty(window, "history", { writable: true, value: { back: vi.fn(), forward: vi.fn() } });
  Object.defineProperty(window, "location", { writable: true, value: { hostname: "localhost", hash: "#/" } });
});

describe("diagnostic.saveProfile / getProfile", () => {
  it("round-trips a profile via localStorage", async () => {
    const { saveProfile, getProfile } = await import("../src/screens/diagnostic.js");
    const profile = {
      topicId: "humerus",
      totalQuestions: 5,
      correctCount: 4,
      knowledgeRatio: 0.8,
      confidence: 0.85,
      fsrsProfile: { initialStability: 10, initialDifficulty: 3, desiredRetention: 0.9 },
      takenAt: Date.now(),
    };
    saveProfile("humerus", profile);
    const out = getProfile("humerus");
    expect(out).toBeTruthy();
    expect(out.knowledgeRatio).toBe(0.8);
    expect(out.fsrsProfile.initialDifficulty).toBe(3);
  });

  it("returns null for unknown topic", async () => {
    const { getProfile } = await import("../src/screens/diagnostic.js");
    expect(getProfile("nope")).toBeNull();
  });
});

describe("renderApprovals", () => {
  it("mounts and renders empty state when no candidates", async () => {
    // Stub api.study.pendingCandidates
    vi.doMock("../src/services/api.js", () => ({
      api: {
        study: {
          pendingCandidates: async () => ({ candidates: [] }),
          decideCandidate: async () => ({}),
        },
      },
    }));
    vi.resetModules();
    const { renderApprovals } = await import("../src/screens/approvals.js");
    const root = document.getElementById("app");
    await renderApprovals(root);
    await new Promise((r) => setTimeout(r, 20));
    expect(root.querySelector(".approvals-screen")).toBeTruthy();
    expect(root.querySelector(".empty")).toBeTruthy();
  });

  it("renders candidate cards when present", async () => {
    vi.doMock("../src/services/api.js", () => ({
      api: {
        study: {
          pendingCandidates: async () => ({
            candidates: [
              { id: "c1", kind: "cloze", confidence: 0.9, preview: "Front", answer: "Back" },
              { id: "c2", kind: "flashcard", confidence: 0.7, preview: "Q", answer: "A" },
            ],
          }),
          decideCandidate: async () => ({}),
        },
      },
    }));
    vi.resetModules();
    const { renderApprovals } = await import("../src/screens/approvals.js");
    const root = document.getElementById("app");
    await renderApprovals(root);
    await new Promise((r) => setTimeout(r, 20));
    const cards = root.querySelectorAll(".approval-card");
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector(".approval-front").textContent).toBe("Front");
    expect(cards[1].querySelector(".approval-front").textContent).toBe("Q");
  });
});

describe("renderSimulator", () => {
  it("renders config form with topic input", async () => {
    const { renderSimulator } = await import("../src/screens/simulator.js");
    const root = document.getElementById("app");
    await renderSimulator(root);
    expect(root.querySelector("#topic")).toBeTruthy();
    expect(root.querySelector("#days")).toBeTruthy();
    expect(root.querySelector("#daily")).toBeTruthy();
    expect(root.querySelector("#run")).toBeTruthy();
  });
});

describe("anatomy_generator.generateModel (v2.15.0: cell biology)", () => {
  it("returns animal_cell with organelles", async () => {
    const { generateModel, AVAILABLE_BONES } = await import("../src/widgets/anatomy_generator.js");
    expect(AVAILABLE_BONES).toContain("animal_cell");
    const m = generateModel("animal_cell");
    expect(m.name).toBe("Célula animal");
    expect(m.hotspots.length).toBeGreaterThanOrEqual(8);
    const first = m.hotspots[0];
    expect(first.label).toBeTruthy();
    expect(first.noteAnchor).toMatch(/celula-animal#/);
  });

  it("returns bacterium hotspots with ribosomes + plasmid", async () => {
    const { generateModel } = await import("../src/widgets/anatomy_generator.js");
    const m = generateModel("bacterium");
    expect(m.hotspots.length).toBeGreaterThan(0);
    expect(m.hotspots.some((h) => h.label.toLowerCase().includes("ribosoma") || h.label.toLowerCase().includes("plásmido"))).toBe(true);
  });

  it("throws on unknown model", async () => {
    const { generateModel } = await import("../src/widgets/anatomy_generator.js");
    expect(() => generateModel("rib")).toThrow();
  });
});

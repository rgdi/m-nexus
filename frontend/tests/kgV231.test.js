// kgV231.test.js — v2.31.0 Knowledge Graph widget tests (jsdom).

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("v2.31.0 — KG graph widget (jsdom)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
    // Mock canvas context for jsdom
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillText: vi.fn(),
      set fillStyle(v) {},
      set strokeStyle(v) {},
      set lineWidth(v) {},
      set font(v) {},
      set textAlign(v) {},
      set textBaseline(v) {},
      setTransform: vi.fn(),
    }));
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
    }));
    global.requestAnimationFrame = vi.fn((cb) => {
      setTimeout(cb, 16);
      return 1;
    });
    global.cancelAnimationFrame = vi.fn();
  });

  it("module exports mountKgGraph", async () => {
    const mod = await import("../src/widgets/kg_graph.js");
    expect(typeof mod.mountKgGraph).toBe("function");
  });

  it("renders the KG structure on mount", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        nodes: [
          { id: "a", label: "corazon", freq: 3, community: 1, weight: 12 },
          { id: "b", label: "sangre", freq: 5, community: 1, weight: 16 },
        ],
        edges: [{ source: "a", target: "b", weight: 2 }],
        documents: [{ id: "x", type: "note", entityIds: ["a", "b"] }],
        totalDocs: 1,
      }),
    });
    const mod = await import("../src/widgets/kg_graph.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountKgGraph(host);
    expect(host.querySelector(".kg-canvas")).toBeTruthy();
    expect(host.querySelector(".kg-search")).toBeTruthy();
    expect(host.querySelector('[data-action="rebuild"]')).toBeTruthy();
  });

  it("updates stats from graph response", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes("/graph")) {
        return {
          ok: true,
          json: async () => ({
            nodes: Array.from({ length: 64 }).map((_, i) => ({
              id: `n${i}`, label: `l${i}`, freq: 1, community: i % 5, weight: i,
            })),
            edges: Array.from({ length: 10 }).map((_, i) => ({
              source: `n${i}`, target: `n${i + 1}`, weight: 1,
            })),
            documents: [],
            totalDocs: 6,
          }),
        };
      }
      if (url.includes("/communities")) {
        return { ok: true, json: async () => ({ communities: Array.from({ length: 5 }).map((_, i) => ({ id: i, size: 12, topLabel: "x" })) }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const mod = await import("../src/widgets/kg_graph.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountKgGraph(host);
    await new Promise((r) => setTimeout(r, 30));
    expect(host.querySelector("[data-stat='nodes']").textContent).toContain("64");
    expect(host.querySelector("[data-stat='edges']").textContent).toContain("10");
    expect(host.querySelector("[data-stat='communities']").textContent).toContain("5");
  });

  it("search input triggers search API", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes("/search")) {
        return {
          ok: true,
          json: async () => ({
            results: [{ id: "x", label: "found", freq: 1, community: 0, weight: 5 }],
            query: "fou",
          }),
        };
      }
      if (url.includes("/graph")) {
        return { ok: true, json: async () => ({ nodes: [{ id: "x", label: "found", freq: 1, community: 0, weight: 5 }], edges: [], documents: [], totalDocs: 0 }) };
      }
      if (url.includes("/neighbours/")) {
        return { ok: true, json: async () => ({ center: "x", nodes: [], edges: [] }) };
      }
      if (url.includes("/communities")) {
        return { ok: true, json: async () => ({ communities: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const mod = await import("../src/widgets/kg_graph.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountKgGraph(host);
    await new Promise((r) => setTimeout(r, 10));
    const search = host.querySelector(".kg-search");
    search.value = "fou";
    search.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 250));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/search?q=fou"));
  });
});

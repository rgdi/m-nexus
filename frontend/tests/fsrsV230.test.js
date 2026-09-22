// fsrsV230.test.js — v2.30.0 FSRS-7 dashboard widget tests.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("v2.30.0 — FSRS dashboard widget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
  });

  it("module exports mountFsrsDashboard", async () => {
    const mod = await import("../src/widgets/fsrs_dashboard.js");
    expect(typeof mod.mountFsrsDashboard).toBe("function");
  });

  it("renders the dashboard structure", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        recommended: [],
        totalAtRiskToday: 0,
        estimatedMinutes: 0,
      }),
    });
    const mod = await import("../src/widgets/fsrs_dashboard.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountFsrsDashboard(host, { fetchCards: async () => [] });
    expect(host.querySelector("#fsrs-title")).toBeTruthy();
    expect(host.querySelector("#fsrs-retention-input")).toBeTruthy();
    expect(host.querySelector("[data-heatmap]")).toBeTruthy();
    expect(host.querySelector("[data-list]")).toBeTruthy();
  });

  it("retention slider updates label", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ recommended: [], totalAtRiskToday: 0, estimatedMinutes: 0 }),
    });
    const mod = await import("../src/widgets/fsrs_dashboard.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountFsrsDashboard(host, { fetchCards: async () => [] });
    const slider = host.querySelector("#fsrs-retention-input");
    slider.value = "0.85";
    slider.dispatchEvent(new Event("input"));
    expect(host.querySelector("[data-retention-value]").textContent).toBe("0.85");
  });

  it("renders list items when API returns them", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes("/optimal-window")) {
        return {
          ok: true,
          json: async () => ({
            recommended: [
              { id: "abc", risk: 0.8, action: "review-now", rNow: 0.3, optimalReviewDay: 0 },
            ],
            totalAtRiskToday: 1,
            estimatedMinutes: 0.5,
          }),
        };
      }
      if (url.includes("/risk-heatmap")) {
        return { ok: true, json: async () => ({ days: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    const mod = await import("../src/widgets/fsrs_dashboard.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountFsrsDashboard(host, { fetchCards: async () => [{ id: "abc", stability: 2 }] });
    // Wait microtask
    await new Promise((r) => setTimeout(r, 10));
    const items = host.querySelectorAll(".fsrs-list-item");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].classList.contains("fsrs-list-item--review-now")).toBe(true);
  });

  it("shows error toast on fetch failure", async () => {
    global.fetch.mockRejectedValue(new Error("network"));
    const mod = await import("../src/widgets/fsrs_dashboard.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountFsrsDashboard(host, { fetchCards: async () => [] });
    await new Promise((r) => setTimeout(r, 30));
    const toast = document.querySelector(".fsrs-toast--error");
    expect(toast).toBeTruthy();
    expect(toast.textContent).toContain("network");
  });
});

// v232.test.js — v2.32.0 Smart Notifications bell + Boards screen tests.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("v2.32.0 — notifications_bell widget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
    global.location = { hash: "" };
  });

  it("module exports mountNotificationBell", async () => {
    const mod = await import("../src/widgets/notifications_bell.js");
    expect(typeof mod.mountNotificationBell).toBe("function");
  });

  it("renders bell + badge", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ count: 3 }),
    });
    const mod = await import("../src/widgets/notifications_bell.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountNotificationBell(host);
    expect(host.querySelector(".notif-bell")).toBeTruthy();
    expect(host.querySelector(".notif-bell-btn")).toBeTruthy();
  });

  it("badge updates from API count", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ count: 7 }),
    });
    const mod = await import("../src/widgets/notifications_bell.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountNotificationBell(host);
    await new Promise((r) => setTimeout(r, 10));
    const badge = host.querySelector("[data-badge]");
    expect(badge.textContent).toBe("7");
    expect(badge.hidden).toBe(false);
  });

  it("badge hidden when count = 0", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ count: 0 }),
    });
    const mod = await import("../src/widgets/notifications_bell.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mod.mountNotificationBell(host);
    await new Promise((r) => setTimeout(r, 10));
    const badge = host.querySelector("[data-badge]");
    expect(badge.hidden).toBe(true);
  });
});

describe("v2.32.0 — boards screen", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
    global.prompt = vi.fn();
    global.confirm = vi.fn(() => true);
  });

  it("module exports renderBoardsScreen", async () => {
    const mod = await import("../src/screens/boards.js");
    expect(typeof mod.renderBoardsScreen).toBe("function");
  });

  it("renders empty state", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ boards: [] }),
    });
    const mod = await import("../src/screens/boards.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    await mod.renderBoardsScreen(host);
    expect(host.querySelector(".boards-empty")).toBeTruthy();
  });

  it("renders board cards", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        boards: [
          { id: "b1", name: "Cardio", subject: "anatomy", color: "#e91e63", icon: "❤️", createdAt: 1000 },
          { id: "b2", name: "Resp", subject: "anatomy", color: "#9c27b0", icon: "🫁", createdAt: 2000 },
        ],
      }),
    });
    const mod = await import("../src/screens/boards.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    await mod.renderBoardsScreen(host);
    const cards = host.querySelectorAll(".board-card");
    expect(cards.length).toBe(2);
  });

  it("create button posts to API", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes("/boards") && !url.includes("/recommendations") && !url.includes("/diagnose")) {
        return { ok: true, json: async () => ({ boards: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    global.prompt.mockReturnValueOnce("Bio").mockReturnValueOnce("biology");
    const mod = await import("../src/screens/boards.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    await mod.renderBoardsScreen(host);
    const createBtn = host.querySelector('[data-action="create"]');
    createBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    const calls = global.fetch.mock.calls.filter((c) => c[0].includes("/boards") && c[1]?.method === "POST");
    expect(calls.length).toBeGreaterThan(0);
  });
});

// v232.test.js — v2.32.0 OCR + Multi-board + Smart notifications tests.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("v2.32.0 — OCR widget (jsdom)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
  });

  it("module exports openOcrRecognize", async () => {
    const mod = await import("../src/widgets/ocr_recognize.js");
    expect(typeof mod.openOcrRecognize).toBe("function");
  });

  it("renders modal with drop zone + options", async () => {
    const { openOcrRecognize } = await import("../src/widgets/ocr_recognize.js");
    openOcrRecognize();
    expect(document.querySelector(".ocr-modal")).toBeTruthy();
    expect(document.querySelector(".ocr-drop")).toBeTruthy();
    expect(document.querySelector('[data-langs]')).toBeTruthy();
    expect(document.querySelector('[data-detect-hw]')).toBeTruthy();
  });
});

describe("v2.32.0 — Multi-Board widget (jsdom)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
  });

  it("module exports mountMultiBoard", async () => {
    const mod = await import("../src/widgets/multi_board.js");
    expect(typeof mod.mountMultiBoard).toBe("function");
  });

  it("renders board structure", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ boards: [] }),
    });
    const { mountMultiBoard } = await import("../src/widgets/multi_board.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountMultiBoard(host);
    expect(host.querySelector("#mb-title")).toBeTruthy();
    expect(host.querySelector('[data-action="create"]')).toBeTruthy();
    expect(host.querySelector('[data-action="diagnostic"]')).toBeTruthy();
  });
});

describe("v2.32.0 — Smart Notifications widget (jsdom)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
  });

  it("module exports mountSmartNotifications", async () => {
    const mod = await import("../src/widgets/smart_notifications.js");
    expect(typeof mod.mountSmartNotifications).toBe("function");
  });

  it("renders list with empty state when no notifications", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ notifications: [] }),
    });
    const { mountSmartNotifications } = await import("../src/widgets/smart_notifications.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountSmartNotifications(host);
    await new Promise((r) => setTimeout(r, 10));
    expect(host.querySelector(".sn-empty")).toBeTruthy();
  });

  it("renders notification items with severity badges", async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes("/notifications-smart") && !url.includes("/generate")) {
        return {
          ok: true,
          json: async () => ({
            notifications: [
              { id: "n1", severity: "critical", title: "🚨 3 cards en riesgo hoy", body: "Repásalas ahora.", cardIds: ["a", "b", "c"], generatedAt: Date.now(), read: false, dismissed: false },
              { id: "n2", severity: "info", title: "⏳ 5 cards soon", body: "Planifica.", cardIds: [], generatedAt: Date.now(), read: false, dismissed: false },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    const { mountSmartNotifications } = await import("../src/widgets/smart_notifications.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    mountSmartNotifications(host);
    await new Promise((r) => setTimeout(r, 30));
    const items = host.querySelectorAll(".sn-item");
    expect(items.length).toBe(2);
    expect(items[0].classList.contains("sn-item--critical")).toBe(true);
    expect(items[1].classList.contains("sn-item--info")).toBe(true);
  });
});

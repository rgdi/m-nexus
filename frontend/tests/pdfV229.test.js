// pdfV229.test.js — v2.29.0 PDF occlusion + sync indicator tests.

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("v2.29.0 — PDF occlusion widget (jsdom)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    global.fetch = vi.fn();
    global.prompt = vi.fn(() => "vena cava");
    global.confirm = vi.fn(() => true);
  });

  it("module loads and exports attachOcclusionMode + renderOcclusions", async () => {
    const mod = await import("../src/widgets/pdf_occlusion.js");
    expect(typeof mod.attachOcclusionMode).toBe("function");
    expect(typeof mod.renderOcclusions).toBe("function");
  });

  it("renderOcclusions fetches from API when occlusions not provided", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ occlusions: [{ id: "o-1", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2, state: "raw" }] }),
    });
    const mod = await import("../src/widgets/pdf_occlusion.js");
    const host = document.createElement("div");
    host.innerHTML = `<div class="pdf-page" data-page="1" style="width:600px;height:800px;position:relative"></div>`;
    document.body.appendChild(host);
    await mod.renderOcclusions(host, "x.pdf");
    const rect = host.querySelector(".pdf-oclusion-rect");
    expect(rect).toBeTruthy();
    expect(rect.dataset.occlusionId).toBe("o-1");
  });

  it("renderOcclusions uses provided occlusions list (no fetch)", async () => {
    const mod = await import("../src/widgets/pdf_occlusion.js");
    const host = document.createElement("div");
    host.innerHTML = `<div class="pdf-page" data-page="2" style="width:600px;height:800px;position:relative"></div>`;
    document.body.appendChild(host);
    await mod.renderOcclusions(host, "x.pdf", [{ id: "o-2", page: 2, x: 0.5, y: 0.5, w: 0.1, h: 0.1, state: "card-created" }]);
    expect(global.fetch).not.toHaveBeenCalled();
    const rect = host.querySelector(".pdf-oclusion-rect");
    expect(rect?.classList.contains("pdf-oclusion-rect--card-created")).toBe(true);
  });
});

describe("v2.29.0 — PDF sync indicator widget", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    global.fetch = vi.fn();
  });

  it("mounts indicator inside host", async () => {
    const { mountSyncIndicator } = await import("../src/widgets/pdf_sync_indicator.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountSyncIndicator(host);
    expect(host.querySelector(".pdf-sync-indicator")).toBeTruthy();
    expect(handle).toBeDefined();
    handle.stop();
  });

  it("setDocumentPath triggers stats fetch", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ highlights: [], occlusions: [], lamport: 0 }),
    });
    const { mountSyncIndicator } = await import("../src/widgets/pdf_sync_indicator.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountSyncIndicator(host);
    handle.setDocumentPath("x.pdf");
    // wait microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(global.fetch).toHaveBeenCalled();
    expect(global.fetch.mock.calls[0][0]).toContain("/sync/pdf/state");
    handle.stop();
  });

  it("handles fetch error → label becomes offline", async () => {
    global.fetch.mockRejectedValueOnce(new Error("network"));
    const { mountSyncIndicator } = await import("../src/widgets/pdf_sync_indicator.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const handle = mountSyncIndicator(host);
    handle.setDocumentPath("x.pdf");
    await new Promise((r) => setTimeout(r, 10));
    const indicator = host.querySelector(".pdf-sync-indicator");
    expect(indicator?.classList.contains("pdf-sync-indicator--error")).toBe(true);
    handle.stop();
  });
});

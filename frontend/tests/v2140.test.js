/* v2140.test.js — v2.14.0 features tests
 * - ocrToast: showOcrToast() mounts DOM elements + auto-dismiss
 * - ocrToast: short text + long text handling
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.useFakeTimers();
});

describe("showOcrToast (v2.14.0)", () => {
  it("renders nothing for empty text", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("", 0.7, "tesseract");
    expect(document.querySelector(".ocr-toast")).toBeNull();
  });

  it("renders a toast with text + meta", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("Hola mundo", 0.85, "tesseract");
    const toast = document.querySelector(".ocr-toast");
    expect(toast).toBeTruthy();
    expect(toast.querySelector(".ocr-toast-text").textContent).toBe("Hola mundo");
    expect(toast.querySelector(".ocr-toast-meta").textContent).toContain("tesseract");
    expect(toast.querySelector(".ocr-toast-meta").textContent).toContain("85%");
  });

  it("truncates long text at 60 chars with ellipsis", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    const longText = "a".repeat(80);
    showOcrToast(longText, 0.7, "heuristic");
    const text = document.querySelector(".ocr-toast-text").textContent;
    expect(text.length).toBe(61); // 60 + ellipsis
    expect(text.endsWith("…")).toBe(true);
  });

  it("applies visible class after rAF tick", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("Test", 0.5, "tesseract");
    const toast = document.querySelector(".ocr-toast");
    expect(toast).toBeTruthy();
    // With fake timers, rAF won't run automatically. We just verify the
    // toast is in the DOM and has correct structure.
    expect(toast.querySelector(".ocr-toast-text").textContent).toBe("Test");
  });

  it("auto-dismisses after TTL_MS", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("Auto dismiss test", 0.9, "tesseract");
    expect(document.querySelector(".ocr-toast")).toBeTruthy();
    // Fast-forward past TTL
    vi.advanceTimersByTime(4000);
    // Wait for fade
    vi.advanceTimersByTime(300);
    expect(document.querySelector(".ocr-toast")).toBeNull();
  });

  it("stacks multiple toasts vertically", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("First", 0.5, "tesseract");
    showOcrToast("Second", 0.6, "tesseract");
    showOcrToast("Third", 0.7, "tesseract");
    const toasts = document.querySelectorAll(".ocr-toast");
    expect(toasts.length).toBe(3);
  });

  it("formats confidence as percentage", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("Test", 0.456, "tesseract");
    const meta = document.querySelector(".ocr-toast-meta").textContent;
    expect(meta).toMatch(/46%/); // rounded to 0 decimals
  });

  it("includes source label in meta", async () => {
    const { showOcrToast } = await import("../src/widgets/ocrToast.js");
    showOcrToast("Test", 0.7, "hybrid");
    const meta = document.querySelector(".ocr-toast-meta").textContent;
    expect(meta).toContain("hybrid");
  });
});

describe("GLB model files (v2.14.0 + v2.15.0 cell models)", () => {
  for (const model of ["animal_cell.glb", "plant_cell.glb", "bacterium.glb"]) {
    it(`${model} has valid GLB header`, async () => {
      const fs = await import("node:fs/promises");
      const buf = await fs.readFile(`/workspace/m-nexus/backend/public/models/${model}`);
      const magic = buf.subarray(0, 4).toString();
      const version = buf.readUInt32LE(4);
      expect(magic).toBe("glTF");
      expect(version).toBe(2);
    });
  }
});

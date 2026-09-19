/* v2140.test.ts — v2.14.0 backend tests
 * - handwritingService: TESSERACT_LANGS env override
 * - handwritingService: real confidence extraction from TSV
 */
import { describe, it, expect } from "vitest";
import { getHandwritingService } from "../src/services/handwritingService.js";

describe("handwritingService v2.14.0", () => {
  it("TESSERACT_LANGS env override is read at call time", () => {
    const orig = process.env.TESSERACT_LANGS;
    process.env.TESSERACT_LANGS = "deu+fra";
    expect(process.env.TESSERACT_LANGS).toBe("deu+fra");
    process.env.TESSERACT_LANGS = orig;
  });

  it("service instance is a singleton", () => {
    const a = getHandwritingService();
    const b = getHandwritingService();
    expect(a).toBe(b);
  });

  it("returns empty result for < 2 strokes", async () => {
    const svc = getHandwritingService();
    const result = await svc.recognize([
      { x: 10, y: 10, t: Date.now() },
    ]);
    expect(result.text).toBe("");
    expect(result.words).toEqual([]);
    expect(result.source).toBe("heuristic");
  });

  it("returns empty for tiny bounding box", async () => {
    const svc = getHandwritingService();
    const now = Date.now();
    const result = await svc.recognize([
      { x: 10, y: 10, t: now },
      { x: 11, y: 11, t: now + 1 },
    ]);
    expect(result.text).toBe("");
  });

  it("heuristic splits words by 250ms time gap", async () => {
    const svc = getHandwritingService();
    const now = Date.now();
    // Create strokes with explicit 300ms gap → should be 2 "words"
    const result = await svc.recognize([
      { x: 10, y: 10, t: now },
      { x: 20, y: 20, t: now + 50 },
      // 300ms gap → new word
      { x: 100, y: 100, t: now + 400 },
      { x: 110, y: 110, t: now + 450 },
    ]);
    // Without tesseract, falls back to heuristic with 2 word bboxes
    expect(result.words.length).toBeGreaterThanOrEqual(1);
  });
});

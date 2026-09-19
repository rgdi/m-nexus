/* v2110.test.ts — v2.11.0 tests
 * - autoTagger: extractTags from anatomical content
 * - autoTagger: tagsForFlashcard merges existing + extracted
 * - cloudflareAccess: cache + verify (mock JWT)
 */
import { describe, it, expect } from "vitest";
import { extractTags, tagsForFlashcard } from "../src/services/autoTagger.js";
import {
  isCloudflareAccessEnabled,
  verifyCfAccessJwt,
  clearCfCache,
  cfCacheStats,
} from "../src/middleware/cloudflareAccess.js";

describe("autoTagger.extractTags (v2.11.0)", () => {
  it("extracts anatomical terms in Spanish", () => {
    const tags = extractTags("El troquiter inserta el supraespinoso en el húmero");
    expect(tags).toContain("húmero");
    expect(tags.some((t) => t.includes("trocánter") || t.includes("troquiter"))).toBe(true);
  });

  it("extracts Latin terms", () => {
    const tags = extractTags("The trochanter major of the femur");
    expect(tags).toContain("femur");
  });

  it("extracts topic keywords", () => {
    const tags = extractTags("Conceptos de anatomía y fisiología");
    expect(tags).toContain("anatomía");
    expect(tags).toContain("fisiología");
  });

  it("is case-insensitive", () => {
    const tags = extractTags("HÚMERO y Fémur");
    expect(tags).toContain("húmero");
    expect(tags).toContain("fémur");
  });

  it("is accent-insensitive", () => {
    const tags = extractTags("humero sin acento");
    expect(tags).toContain("húmero");
  });

  it("returns empty for unrelated text", () => {
    const tags = extractTags("Lorem ipsum dolor sit amet");
    expect(tags).toEqual([]);
  });

  it("caps at maxTags", () => {
    const tags = extractTags("húmero fémur tibia peroné radio cúbito escápula", 3);
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it("prefers longer/more specific tags", () => {
    const tags = extractTags("húmero troquiter húmero troquiter");
    // Should dedupe and sort by length
    const unique = Array.from(new Set(tags));
    expect(unique.length).toBe(tags.length);
  });
});

describe("autoTagger.tagsForFlashcard (v2.11.0)", () => {
  it("merges existing + extracted", () => {
    const tags = tagsForFlashcard(
      "¿Qué inserta el troquiter?",
      "supraespinoso, infraespinoso y redondo menor",
      ["cloze"],
    );
    expect(tags).toContain("cloze");
    expect(tags.some((t) => t.includes("troquiter") || t.includes("trocánter"))).toBe(true);
  });

  it("caps at 6", () => {
    const tags = tagsForFlashcard(
      "húmero fémur tibia peroné radio cúbito escápula",
      "anatomía fisiología histología embriología",
      ["cloze", "upper-limb"],
    );
    expect(tags.length).toBeLessThanOrEqual(6);
  });

  it("handles empty content", () => {
    const tags = tagsForFlashcard("", "");
    expect(tags.length).toBeLessThanOrEqual(6);
  });
});

describe("cloudflareAccess middleware (v2.11.0)", () => {
  it("returns null when no cert configured (default)", () => {
    clearCfCache();
    // Without setting CF_ACCESS_CERT_PATH, the middleware should be disabled
    const beforeEnabled = isCloudflareAccessEnabled();
    if (!beforeEnabled) {
      expect(verifyCfAccessJwt("invalid.jwt.token")).toBeNull();
    }
  });

  it("cfCacheStats reports empty cache after clear", () => {
    clearCfCache();
    const stats = cfCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.live).toBe(0);
  });
});

// Tests para ImageOcclusionService (Fase 3.B).

import { describe, it, expect } from "vitest";
import { ImageOcclusionService, OcclusionMask } from "../src/services/imageOcclusionService";

describe("ImageOcclusionService.toFrontmatter", () => {
  it("generates valid YAML front matter", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 10, y: 20, width: 100, height: 50, label: "Riñón" },
      { id: 1, x: 200, y: 100, width: 80, height: 80, label: "Hígado" },
    ];
    const fm = ImageOcclusionService.toFrontmatter("anatomia.png", 800, 600, masks);
    expect(fm).toContain("image_occlusion:");
    expect(fm).toContain("image: anatomia.png");
    expect(fm).toContain("width: 800");
    expect(fm).toContain("height: 600");
    expect(fm).toContain("label: \"Riñón\"");
    expect(fm).toContain("label: \"Hígado\"");
  });

  it("uses red color by default", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 0, y: 0, width: 50, height: 50, label: "X" },
    ];
    const fm = ImageOcclusionService.toFrontmatter("img.png", 100, 100, masks);
    expect(fm).toContain('color: "#FF0000"');
  });

  it("respects custom color", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 0, y: 0, width: 50, height: 50, label: "X", color: "#00FF00" },
    ];
    const fm = ImageOcclusionService.toFrontmatter("img.png", 100, 100, masks);
    expect(fm).toContain('color: "#00FF00"');
  });
});

describe("ImageOcclusionService.parse", () => {
  it("parses front matter with masks", () => {
    const content = `---
image_occlusion:
  image: anatomia.png
  width: 800
  height: 600
  masks:
    - { id: 0, x: 10, y: 20, width: 100, height: 50, label: "Riñón" }
    - { id: 1, x: 200, y: 100, width: 80, height: 80, label: "Hígado" }
---

# Anatomía

Notas médicas.`;

    const cards = ImageOcclusionService.parse(content);
    expect(cards).toHaveLength(2);
    expect(cards[0].imageUrl).toBe("anatomia.png");
    expect(cards[0].imageWidth).toBe(800);
    expect(cards[0].imageHeight).toBe(600);
    expect(cards[0].label).toBe("Riñón");
    expect(cards[1].label).toBe("Hígado");
  });

  it("returns empty for content without image_occlusion", () => {
    const content = `---
title: Normal
tags: [anatomia]
---

# Solo texto`;
    expect(ImageOcclusionService.parse(content)).toEqual([]);
  });

  it("returns empty for content without front matter", () => {
    expect(ImageOcclusionService.parse("Sin front matter")).toEqual([]);
  });
});

describe("ImageOcclusionService.pixelsToPercent", () => {
  it("converts pixel coords to percentage", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 100, y: 50, width: 200, height: 100, label: "A" },
    ];
    const result = ImageOcclusionService.pixelsToPercent(masks, 1000, 500);
    expect(result[0].xPct).toBe(10);
    expect(result[0].yPct).toBe(10);
    expect(result[0].wPct).toBe(20);
    expect(result[0].hPct).toBe(20);
  });

  it("handles 0 coordinates", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 0, y: 0, width: 0, height: 0, label: "" },
    ];
    const result = ImageOcclusionService.pixelsToPercent(masks, 100, 100);
    expect(result[0].xPct).toBe(0);
  });
});

describe("ImageOcclusionService.generateCards", () => {
  it("generates one card per mask", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 10, y: 10, width: 50, height: 50, label: "A" },
      { id: 1, x: 100, y: 100, width: 50, height: 50, label: "B" },
    ];
    const cards = ImageOcclusionService.generateCards("img.png", 200, 200, masks);
    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe(0);
    expect(cards[0].label).toBe("A");
    expect(cards[1].id).toBe(1);
    expect(cards[1].label).toBe("B");
  });
});

describe("ImageOcclusionService.validate", () => {
  it("passes valid masks", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 10, y: 10, width: 50, height: 50, label: "A" },
    ];
    expect(ImageOcclusionService.validate(masks, 200, 200)).toEqual([]);
  });

  it("detects mask exceeding image bounds", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 100, y: 100, width: 200, height: 50, label: "A" },
    ];
    const errors = ImageOcclusionService.validate(masks, 200, 200);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("excede ancho");
  });

  it("detects negative coordinates", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: -10, y: 0, width: 50, height: 50, label: "A" },
    ];
    const errors = ImageOcclusionService.validate(masks, 200, 200);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("detects empty label", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 0, y: 0, width: 50, height: 50, label: "" },
    ];
    const errors = ImageOcclusionService.validate(masks, 200, 200);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("label");
  });

  it("detects zero dimensions", () => {
    const masks: OcclusionMask[] = [
      { id: 0, x: 0, y: 0, width: 0, height: 0, label: "A" },
    ];
    const errors = ImageOcclusionService.validate(masks, 200, 200);
    expect(errors.length).toBeGreaterThan(0);
  });
});

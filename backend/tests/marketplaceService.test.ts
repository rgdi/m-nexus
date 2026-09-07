// Tests para MarketplaceService (Fase 5).

import { describe, it, expect, beforeEach } from "vitest";
import { MarketplaceService } from "../src/services/marketplaceService";

describe("MarketplaceService", () => {
  let service: MarketplaceService;

  beforeEach(() => {
    service = new MarketplaceService();
  });

  it("lists seed decks", () => {
    const decks = service.list();
    expect(decks.length).toBeGreaterThanOrEqual(5);
  });

  it("filters by category", () => {
    const medical = service.list({ category: "medical" });
    expect(medical.length).toBeGreaterThan(0);
    expect(medical.every((d) => d.category === "medical")).toBe(true);
  });

  it("filters by language", () => {
    const spanish = service.list({ language: "es" });
    expect(spanish.every((d) => d.language === "es")).toBe(true);
    expect(spanish.length).toBeGreaterThan(0);
  });

  it("filters by tag", () => {
    const anatomy = service.list({ tag: "anatomia" });
    expect(anatomy.every((d) => d.tags.some((t) => t.toLowerCase().includes("anatomia")))).toBe(true);
  });

  it("get deck by ID", () => {
    const deck = service.get("usmle-step1");
    expect(deck).not.toBeNull();
    expect(deck!.name).toContain("USMLE");
  });

  it("returns null for unknown ID", () => {
    expect(service.get("nonexistent")).toBeNull();
  });

  it("search by name", () => {
    const results = service.search("farmacología");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((d) => d.id === "farmacologia-essencial")).toBe(true);
  });

  it("search is case-insensitive", () => {
    const a = service.search("ANATOMÍA");
    const b = service.search("anatomía");
    expect(a.length).toBe(b.length);
  });

  it("search by description", () => {
    const results = service.search("Robbins");
    expect(results.some((d) => d.id === "patologia-robbins")).toBe(true);
  });

  it("top N most installed", () => {
    const top = service.top(3);
    expect(top).toHaveLength(3);
    // El primero debe tener más installs que el último
    expect(top[0].installs).toBeGreaterThanOrEqual(top[2].installs);
  });

  it("topRated N by rating", () => {
    const top = service.topRated(3);
    expect(top).toHaveLength(3);
    expect(top[0].rating).toBeGreaterThanOrEqual(top[2].rating);
  });

  it("install and uninstall", () => {
    expect(service.install("usmle-step1")).toBe(true);
    expect(service.installedDecks()).toHaveLength(1);
    expect(service.uninstall("usmle-step1")).toBe(true);
    expect(service.installedDecks()).toHaveLength(0);
  });

  it("install returns false for unknown ID", () => {
    expect(service.install("nope")).toBe(false);
  });

  it("uninstall returns false for not installed", () => {
    expect(service.uninstall("usmle-step1")).toBe(false);
  });

  it("official returns only official decks", () => {
    const official = service.official();
    expect(official.length).toBeGreaterThan(0);
    expect(official.every((d) => d.official)).toBe(true);
  });

  it("stats counts decks and cards", () => {
    const stats = service.stats();
    expect(stats.totalDecks).toBeGreaterThanOrEqual(5);
    expect(stats.totalCards).toBeGreaterThan(25000);
    expect(stats.categories).toBeGreaterThanOrEqual(4);
  });
});

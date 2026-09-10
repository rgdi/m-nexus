// marketplaceSqlite.test.ts: tests del marketplace con SQLite (v0.61.0)
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getMarketplaceSqliteService, __resetMarketplaceSqlite } from "../src/services/marketplaceSqliteService.js";

let dbPath: string;

describe("MarketplaceSqliteService (v0.61.0)", () => {
  beforeEach(() => {
    __resetMarketplaceSqlite();
    dbPath = join(mkdtempSync(join(tmpdir(), "mkdb-")), "test.db");
    // Force create singleton with new path
    const svc = getMarketplaceSqliteService(dbPath);
    expect(svc).toBeDefined();
  });
  afterAll(() => {
    __resetMarketplaceSqlite();
  });

  it("seed crea 3 decks oficiales", () => {
    const svc = getMarketplaceSqliteService();
    const list = svc.listDecks();
    expect(list.length).toBe(3);
    expect(list.some(d => d.id === "anatomia-clinica-es")).toBe(true);
  });

  it("listDecks filtra por categoria", () => {
    const svc = getMarketplaceSqliteService();
    const list = svc.listDecks({ category: "anatomy" });
    expect(list.every(d => d.category === "anatomy")).toBe(true);
  });

  it("listDecks filtra por busqueda NFD", () => {
    const svc = getMarketplaceSqliteService();
    const list = svc.listDecks({ search: "Anatomía" });
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBe("anatomia-clinica-es");
  });

  it("listDecks filtra official=true", () => {
    const svc = getMarketplaceSqliteService();
    const list = svc.listDecks({ official: true });
    expect(list.every(d => d.official === 1)).toBe(true);
  });

  it("getDeck retorna deck por id", () => {
    const svc = getMarketplaceSqliteService();
    const d = svc.getDeck("anatomia-clinica-es");
    expect(d).toBeDefined();
    expect(d?.card_count).toBe(850);
  });

  it("getDeck retorna undefined para id inexistente", () => {
    const svc = getMarketplaceSqliteService();
    expect(svc.getDeck("no-existe")).toBeUndefined();
  });

  it("getVersions / getLatestVersion", () => {
    const svc = getMarketplaceSqliteService();
    const vs = svc.getVersions("anatomia-clinica-es");
    expect(vs.length).toBe(1);
    expect(vs[0].version).toBe("1.0.0");
    const latest = svc.getLatestVersion("anatomia-clinica-es");
    expect(latest?.id).toBe("anatomia-clinica-es-1.0.0");
  });

  it("createDeck persiste deck user", () => {
    const svc = getMarketplaceSqliteService();
    const created = svc.createDeck({
      id: "user-deck-1",
      name: "Mi deck",
      description: "test",
      author_id: "user1", author_name: "User 1",
      tags: JSON.stringify(["test"]),
      card_count: 100, language: "es", category: "test",
      official: 0, price_cents: 0,
    });
    expect(created.id).toBe("user-deck-1");
    expect(svc.getDeck("user-deck-1")).toBeDefined();
  });

  it("addReview actualiza rating transaccionalmente", () => {
    const svc = getMarketplaceSqliteService();
    const before = svc.getDeck("anatomia-clinica-es")!;
    const beforeRatingCount = before.rating_count;
    const beforeRating = before.rating;
    svc.addReview({
      id: "", deck_id: "anatomia-clinica-es",
      user_id: "u1", user_name: "Test", rating: 5, comment: "ok", created_at: 0,
    });
    const after = svc.getDeck("anatomia-clinica-es")!;
    expect(after.rating_count).toBe(beforeRatingCount + 1);
    // La nueva media debe ser mayor si rating 5 es > before.rating
    if (beforeRating > 0 && beforeRating < 5) {
      expect(after.rating).toBeGreaterThan(beforeRating);
    }
  });

  it("addReview rating fuera de rango -> throw", () => {
    const svc = getMarketplaceSqliteService();
    expect(() => svc.addReview({
      id: "", deck_id: "anatomia-clinica-es",
      user_id: "u1", user_name: "t", rating: 6, comment: "", created_at: 0,
    })).toThrow();
  });

  it("install incrementa total_installs", () => {
    const svc = getMarketplaceSqliteService();
    const before = svc.getDeck("anatomia-clinica-es")!.total_installs;
    svc.install("user-x", "anatomia-clinica-es");
    const after = svc.getDeck("anatomia-clinica-es")!.total_installs;
    expect(after).toBe(before + 1);
  });

  it("install de deck inexistente -> null", () => {
    const svc = getMarketplaceSqliteService();
    expect(svc.install("user-x", "no-existe")).toBeNull();
  });

  it("isInstalled check", () => {
    const svc = getMarketplaceSqliteService();
    svc.install("user-y", "farmacologia-basica");
    expect(svc.isInstalled("user-y", "farmacologia-basica")).toBe(true);
    expect(svc.isInstalled("user-y", "anatomia-clinica-es")).toBe(false);
  });

  it("getUserInstalls", () => {
    const svc = getMarketplaceSqliteService();
    svc.install("user-z", "anatomia-clinica-es");
    svc.install("user-z", "farmacologia-basica");
    const list = svc.getUserInstalls("user-z");
    expect(list.length).toBe(2);
  });

  it("stats agregadas", () => {
    const svc = getMarketplaceSqliteService();
    const s = svc.stats();
    expect(s.totalDecks).toBeGreaterThanOrEqual(3);
    expect(s.totalInstalls).toBeGreaterThan(0);
    expect(s.avgRating).toBeGreaterThan(0);
    expect(s.topCategories.length).toBeGreaterThan(0);
  });

  it("persiste entre instancias (re-open)", () => {
    // Cerrar instancia actual
    __resetMarketplaceSqlite();
    // Re-abrir misma DB
    const svc2 = getMarketplaceSqliteService(dbPath);
    const list = svc2.listDecks();
    expect(list.length).toBe(3);
  });
});

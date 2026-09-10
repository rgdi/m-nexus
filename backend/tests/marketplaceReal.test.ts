// marketplaceReal.test.ts: tests del marketplace real (v0.60 P1.11)
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { getMarketplaceRealService } from "../src/services/marketplaceRealService.js";

describe("MarketplaceRealService (P1.11)", () => {
  describe("Decks", () => {
    it("lista decks con seed inicial", () => {
      const svc = getMarketplaceRealService();
      const list = svc.listDecks();
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(list[0].rating).toBeGreaterThan(0);
    });
    it("filtra por categoria", () => {
      const svc = getMarketplaceRealService();
      const list = svc.listDecks({ category: "anatomy" });
      expect(list.every(d => d.category === "anatomy")).toBe(true);
    });
    it("filtra por busqueda", () => {
      const svc = getMarketplaceRealService();
      const list = svc.listDecks({ search: "Anatomía" });
      expect(list.length).toBeGreaterThan(0);
    });
    it("devuelve detalle de deck", () => {
      const svc = getMarketplaceRealService();
      const d = svc.getDeck("anatomia-clinica-es");
      expect(d).toBeDefined();
      expect(d?.cardCount).toBe(850);
    });
    it("devuelve null para deck inexistente", () => {
      const svc = getMarketplaceRealService();
      expect(svc.getDeck("no-existe")).toBeUndefined();
    });
  });

  describe("Versions", () => {
    it("devuelve versiones del deck", () => {
      const svc = getMarketplaceRealService();
      const vs = svc.getVersions("anatomia-clinica-es");
      expect(vs.length).toBeGreaterThan(0);
      expect(vs[0].version).toBe("1.0.0");
    });
    it("devuelve latest version", () => {
      const svc = getMarketplaceRealService();
      const latest = svc.getLatestVersion("anatomia-clinica-es");
      expect(latest).toBeDefined();
      expect(latest?.version).toBe("1.0.0");
    });
  });

  describe("Reviews", () => {
    it("agrega review y actualiza rating", () => {
      const svc = getMarketplaceRealService();
      // Usar un deck que no aparezca en otros tests de reviews
      const targetDeck = "farmacologia-basica";
      const before = svc.getDeck(targetDeck)!;
      const beforeCount = before.ratingCount;
      svc.addReview({
        deckId: targetDeck, userId: "u1", userName: "tester",
        rating: 5, comment: "Excelente",
      });
      const after = svc.getDeck(targetDeck)!;
      expect(after.ratingCount).toBe(beforeCount + 1);
      // rating debe haber cambiado
      expect(after.rating).toBeGreaterThan(0);
    });
    it("lista reviews", () => {
      const svc = getMarketplaceRealService();
      const rs = svc.getReviews("farmacologia-basica");
      expect(rs.length).toBeGreaterThan(0);
    });
  });

  describe("Installs", () => {
    it("instala deck y cuenta", () => {
      const svc = getMarketplaceRealService();
      const before = svc.getDeck("histologia-celulas")!.totalInstalls;
      const i = svc.install("user-x", "histologia-celulas");
      expect(i).not.toBeNull();
      const after = svc.getDeck("histologia-celulas")!.totalInstalls;
      expect(after).toBe(before + 1);
    });
    it("instala deck inexistente devuelve null", () => {
      const svc = getMarketplaceRealService();
      expect(svc.install("user-x", "no-existe")).toBeNull();
    });
    it("lista installs de usuario", () => {
      const svc = getMarketplaceRealService();
      svc.install("user-y", "histologia-celulas");
      const list = svc.getUserInstalls("user-y");
      expect(list.length).toBeGreaterThan(0);
      expect(list.every(i => i.userId === "user-y")).toBe(true);
    });
  });

  describe("Stats", () => {
    it("devuelve stats agregadas", () => {
      const svc = getMarketplaceRealService();
      const s = svc.stats();
      expect(s.totalDecks).toBeGreaterThan(0);
      expect(s.totalInstalls).toBeGreaterThan(0);
      expect(s.avgRating).toBeGreaterThan(0);
      expect(Array.isArray(s.topCategories)).toBe(true);
    });
  });
});

describe("MarketplaceReal HTTP routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const { marketplaceRealRoutes } = await import("../src/routes/marketplaceReal.js");
    await app.register(marketplaceRealRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("GET /api/v1/marketplace/decks", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/marketplace/decks" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.decks.length).toBeGreaterThan(0);
  });
  it("GET /api/v1/marketplace/decks/:id", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/marketplace/decks/anatomia-clinica-es" });
    expect(r.statusCode).toBe(200);
    expect(r.json().deck.cardCount).toBe(850);
  });
  it("GET deck inexistente -> 404", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/marketplace/decks/no-existe" });
    expect(r.statusCode).toBe(404);
  });
  it("POST /api/v1/marketplace/decks/:id/reviews", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/decks/anatomia-clinica-es/reviews",
      payload: { userId: "u1", userName: "tester", rating: 4, comment: "ok" },
    });
    expect(r.statusCode).toBe(201);
  });
  it("POST review con rating invalido -> 400", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/decks/anatomia-clinica-es/reviews",
      payload: { rating: 10 },
    });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
  it("POST install", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/marketplace/decks/farmacologia-basica/install",
      payload: { userId: "u-test" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().deckId).toBe("farmacologia-basica");
  });
  it("GET stats", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/marketplace/stats" });
    expect(r.statusCode).toBe(200);
    expect(r.json().totalDecks).toBeGreaterThan(0);
  });
  it("GET downloads (stub v0.60)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/marketplace/decks/anatomia-clinica-es/download" });
    expect(r.statusCode).toBe(200);
    expect(r.json().message).toContain("v0.60");
  });
});

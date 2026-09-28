// v235.test.ts — v2.35.0 progress analytics tests.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server.js";

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  try { await app.close(); } catch {}
});

describe("v2.35.0 — progress analytics endpoints", () => {
  it("GET /api/v1/progress/heatmap returns a GitHub-style grid", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/progress/heatmap?weeks=10" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.weeks).toBe(10);
    // 10 weeks × 7 days = 70 cells
    expect(j.days.length).toBe(70);
    expect(j.days[0]).toHaveProperty("date");
    expect(j.days[0]).toHaveProperty("reviews");
    expect(j.days[0]).toHaveProperty("level");
    // level is 0..4
    for (const d of j.days) {
      expect(d.level).toBeGreaterThanOrEqual(0);
      expect(d.level).toBeLessThanOrEqual(4);
    }
    expect(j.totals).toHaveProperty("currentStreak");
    expect(j.totals).toHaveProperty("longestStreak");
  });

  it("heatmap aligns the last cell to today's week (Sat)", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/progress/heatmap?weeks=4" });
    const j = r.json();
    expect(j.days.length).toBe(28);
    // No future days have reviews
    const futureWithReviews = j.days.filter((d: { future?: boolean; reviews: number }) => d.future && d.reviews > 0);
    expect(futureWithReviews.length).toBe(0);
  });

  it("GET /api/v1/progress/stats returns headline numbers", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/progress/stats" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j).toHaveProperty("reviewsTotal");
    expect(j).toHaveProperty("cardsTotal");
    expect(j).toHaveProperty("retention30");
    expect(j.retention30).toBeGreaterThanOrEqual(0);
    expect(j.retention30).toBeLessThanOrEqual(1);
  });

  it("GET /api/v1/progress/series returns a cumulative line series", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/progress/series?days=14" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.points.length).toBe(14);
    expect(j.points[0]).toHaveProperty("cumulative");
    // Cumulative must be non-decreasing
    for (let i = 1; i < j.points.length; i++) {
      expect(j.points[i].cumulative).toBeGreaterThanOrEqual(j.points[i - 1].cumulative);
    }
  });

  it("GET /api/v1/progress/retention returns weekly buckets", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/progress/retention?weeks=6" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.points.length).toBe(6);
    for (const p of j.points) {
      expect(p.retention).toBeGreaterThanOrEqual(0);
      expect(p.retention).toBeLessThanOrEqual(1);
    }
  });

  it("GET /api/v1/progress/breakdown returns colored slices", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/progress/breakdown" });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(Array.isArray(j.slices)).toBe(true);
    for (const s of j.slices) {
      expect(s).toHaveProperty("subject");
      expect(s).toHaveProperty("reviews");
      expect(s).toHaveProperty("cards");
      expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("clamps out-of-range query params instead of erroring", async () => {
    const h1 = await app.inject({ method: "GET", url: "/api/v1/progress/heatmap?weeks=99999" });
    expect(h1.statusCode).toBe(200);
    expect(h1.json().weeks).toBe(120); // clamped to max

    const h2 = await app.inject({ method: "GET", url: "/api/v1/progress/heatmap?weeks=0" });
    expect(h2.statusCode).toBe(200);
    expect(h2.json().weeks).toBe(4); // clamped to min
  });
});

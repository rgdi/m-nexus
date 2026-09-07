// Tests para HeatmapService (Fase 3.D).

import { describe, it, expect } from "vitest";
import { HeatmapService, ReviewEvent } from "../src/services/heatmapService";

describe("HeatmapService.compute", () => {
  it("returns empty stats for no events", () => {
    const stats = HeatmapService.compute([]);
    expect(stats.totalReviews).toBe(0);
    expect(stats.totalDays).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestStreak).toBe(0);
    expect(stats.bestDay).toBeNull();
  });

  it("counts total reviews", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime() },
      { timestamp: new Date("2026-01-01").getTime() + 1000 },
      { timestamp: new Date("2026-01-02").getTime() },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.totalReviews).toBe(3);
  });

  it("groups events by day", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01T10:00:00Z").getTime() },
      { timestamp: new Date("2026-01-01T15:00:00Z").getTime() },
      { timestamp: new Date("2026-01-02T10:00:00Z").getTime() },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.daily).toHaveLength(2);
    expect(stats.daily[0].reviews).toBe(2);
    expect(stats.daily[1].reviews).toBe(1);
  });

  it("counts new cards", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime(), newCard: true },
      { timestamp: new Date("2026-01-01").getTime() + 1000, newCard: false },
      { timestamp: new Date("2026-01-01").getTime() + 2000, newCard: true },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.totalNewCards).toBe(2);
  });

  it("sums study time per day", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime(), studyTimeSec: 60 },
      { timestamp: new Date("2026-01-01").getTime() + 1000, studyTimeSec: 120 },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.daily[0].studyTimeSec).toBe(180);
  });

  it("calculates longest streak (consecutive days)", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime() },
      { timestamp: new Date("2026-01-02").getTime() },
      { timestamp: new Date("2026-01-03").getTime() },
      // gap
      { timestamp: new Date("2026-01-10").getTime() },
      { timestamp: new Date("2026-01-11").getTime() },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.longestStreak).toBe(3);
  });

  it("best day has most reviews", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime() },
      { timestamp: new Date("2026-01-02").getTime() },
      { timestamp: new Date("2026-01-02").getTime() + 1000 },
      { timestamp: new Date("2026-01-02").getTime() + 2000 },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.bestDay?.date).toBe("2026-01-02");
    expect(stats.bestDay?.reviews).toBe(3);
  });

  it("computes avg reviews per day", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime() },
      { timestamp: new Date("2026-01-02").getTime() },
      { timestamp: new Date("2026-01-03").getTime() },
      { timestamp: new Date("2026-01-03").getTime() + 1000 },
      { timestamp: new Date("2026-01-03").getTime() + 2000 },
      { timestamp: new Date("2026-01-03").getTime() + 3000 },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.avgReviewsPerDay).toBe(2); // 6 reviews / 3 days
  });

  it("totalDays counts unique study days", () => {
    const events: ReviewEvent[] = [
      { timestamp: new Date("2026-01-01").getTime() },
      { timestamp: new Date("2026-01-01").getTime() + 1000 },
      { timestamp: new Date("2026-01-02").getTime() },
    ];
    const stats = HeatmapService.compute(events);
    expect(stats.totalDays).toBe(2);
  });
});

describe("HeatmapService.intensityBucket", () => {
  it("0 for no reviews", () => {
    expect(HeatmapService.intensityBucket(0)).toBe(0);
  });

  it("1 for 1-5 reviews", () => {
    expect(HeatmapService.intensityBucket(1)).toBe(1);
    expect(HeatmapService.intensityBucket(5)).toBe(1);
  });

  it("2 for 6-15 reviews", () => {
    expect(HeatmapService.intensityBucket(6)).toBe(2);
    expect(HeatmapService.intensityBucket(15)).toBe(2);
  });

  it("3 for 16-30 reviews", () => {
    expect(HeatmapService.intensityBucket(16)).toBe(3);
    expect(HeatmapService.intensityBucket(30)).toBe(3);
  });

  it("4 for 31+ reviews", () => {
    expect(HeatmapService.intensityBucket(31)).toBe(4);
    expect(HeatmapService.intensityBucket(100)).toBe(4);
  });
});

describe("HeatmapService.fillRange", () => {
  it("fills missing dates with zero stats", () => {
    const daily = [
      { date: "2026-01-01", reviews: 5, newCards: 0, studyTimeSec: 0 },
      { date: "2026-01-03", reviews: 3, newCards: 0, studyTimeSec: 0 },
    ];
    const result = HeatmapService.fillRange(daily, "2026-01-01", "2026-01-03");
    expect(result).toHaveLength(3);
    expect(result[0].reviews).toBe(5);
    expect(result[1].reviews).toBe(0); // 2026-01-02 (gap)
    expect(result[2].reviews).toBe(3);
  });
});

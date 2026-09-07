// Tests para GamificationService (Fase 6).

import { describe, it, expect, beforeEach } from "vitest";
import { GamificationService } from "../src/services/gamificationService";

describe("GamificationService.levelFromXP", () => {
  it("level 1 at 0 XP", () => {
    expect(GamificationService.levelFromXP(0)).toBe(1);
  });

  it("level 2 at 100 XP", () => {
    expect(GamificationService.levelFromXP(100)).toBe(2);
  });

  it("level 3 at 400 XP", () => {
    expect(GamificationService.levelFromXP(400)).toBe(3);
  });

  it("level 10 at 8100 XP", () => {
    expect(GamificationService.levelFromXP(8100)).toBe(10);
  });
});

describe("GamificationService.xpForLevel", () => {
  it("level 1 = 0 XP", () => {
    expect(GamificationService.xpForLevel(1)).toBe(0);
  });

  it("level 2 = 100 XP", () => {
    expect(GamificationService.xpForLevel(2)).toBe(100);
  });

  it("roundtrip: levelFromXP(xpForLevel(n)) = n", () => {
    for (const n of [1, 5, 10, 25, 50]) {
      const xp = GamificationService.xpForLevel(n);
      expect(GamificationService.levelFromXP(xp)).toBe(n);
    }
  });
});

describe("GamificationService.recordEvent", () => {
  let service: GamificationService;

  beforeEach(() => {
    service = new GamificationService();
  });

  it("review event gives 10 XP", () => {
    const result = service.recordEvent({ type: "review" });
    // 10 base + 50 first_review achievement = 60
    expect(result.xp).toBe(60);
  });

  it("correct_easy gives 20 XP", () => {
    const result = service.recordEvent({ type: "review_correct_easy" });
    // 20 + 50 first_review = 70
    expect(result.xp).toBe(70);
  });

  it("correct_hard gives 15 XP", () => {
    const result = service.recordEvent({ type: "review_correct_hard" });
    // 15 + 50 first_review = 65
    expect(result.xp).toBe(65);
  });

  it("new_card gives 20 XP", () => {
    // Sin reviews, no achievement unlocked
    expect(service.recordEvent({ type: "new_card" }).xp).toBe(20);
  });

  it("streak_day gives 50 XP", () => {
    expect(service.recordEvent({ type: "streak_day", amount: 1 }).xp).toBe(50);
  });

  it("deck_complete gives 200 XP", () => {
    expect(service.recordEvent({ type: "deck_complete" }).xp).toBe(200);
  });

  it("unlocks first_review after 1 review", () => {
    const result = service.recordEvent({ type: "review" });
    expect(result.newAchievements.map((a) => a.id)).toContain("first_review");
    // XP = 10 (review) + 50 (achievement bonus) = 60
    expect(result.xp).toBe(60);
  });

  it("unlocks review_100 after 100 reviews", () => {
    for (let i = 0; i < 100; i++) {
      service.recordEvent({ type: "review" });
    }
    // Already unlocked first_review earlier
    const stats = service.getStats(0);
    expect(stats.unlockedAchievements).toContain("first_review");
    expect(stats.unlockedAchievements).toContain("review_100");
  });

  it("does not re-unlock same achievement", () => {
    service.recordEvent({ type: "review" }); // first_review
    const result = service.recordEvent({ type: "review" });
    expect(result.newAchievements.map((a) => a.id)).not.toContain("first_review");
  });

  it("unlocks streak_7 after 7 streak days", () => {
    for (let i = 0; i < 7; i++) {
      service.recordEvent({ type: "streak_day", amount: i + 1 });
    }
    const stats = service.getStats(0);
    expect(stats.unlockedAchievements).toContain("streak_7");
  });
});

describe("GamificationService.getStats", () => {
  it("returns level 1 at 0 XP", () => {
    const service = new GamificationService();
    const stats = service.getStats(0);
    expect(stats.level).toBe(1);
    expect(stats.totalXP).toBe(0);
  });

  it("includes unlocked achievements", () => {
    const service = new GamificationService();
    service.recordEvent({ type: "review" });
    const stats = service.getStats(60);
    expect(stats.unlockedAchievements).toContain("first_review");
  });

  it("has next achievement when not all unlocked", () => {
    const service = new GamificationService();
    const stats = service.getStats(0);
    expect(stats.nextAchievement).not.toBeNull();
  });

  it("computes xpToNextLevel", () => {
    const service = new GamificationService();
    const stats = service.getStats(0);
    // Level 1 → Level 2 necesita 100 XP
    expect(stats.xpToNextLevel).toBe(100);
  });

  it("currentStreak reflects events", () => {
    const service = new GamificationService();
    service.recordEvent({ type: "streak_day", amount: 5 });
    const stats = service.getStats(50);
    expect(stats.currentStreak).toBe(5);
  });
});

describe("GamificationService.listAchievements", () => {
  it("returns achievement catalog", () => {
    const list = GamificationService.listAchievements();
    expect(list.length).toBeGreaterThanOrEqual(10);
  });

  it("each achievement has icon, name, bonusXP", () => {
    const list = GamificationService.listAchievements();
    for (const a of list) {
      expect(a.icon).toBeTruthy();
      expect(a.name).toBeTruthy();
      expect(a.bonusXP).toBeGreaterThan(0);
    }
  });
});

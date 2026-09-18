/* v290.test.ts — v2.9.0 tests
 * - generationApprovals: persistence (file-backed) round-trip
 * - fsrsSimulator: day-by-day produces valid output
 * - occlusion CRUD: still works after persistence refactor
 */
import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  addCandidate,
  listCandidates,
  decide,
  clearDecided,
  getCandidate,
  stats,
} from "../src/services/generationApprovals.js";
import { simulate } from "../src/services/fsrsSimulator.js";
import * as occlusion from "../src/services/imageOcclusionService.js";

const DATA_FILE = path.resolve(process.cwd(), "data", "approval-queue.json");

beforeEach(async () => {
  // Clean file before each test
  try { await fs.unlink(DATA_FILE); } catch { /* ignore */ }
  // Note: occlusion module uses module-level Map, so tests share state.
  // We use unique topic IDs per test to avoid collisions.
});

describe("generationApprovals persistence (v2.9.0)", () => {
  it("addCandidate persists to file", async () => {
    const c = await addCandidate({
      topicId: "t1",
      kind: "cloze",
      payload: {},
      preview: "Front",
      answer: "Back",
      confidence: 0.9,
    });
    expect(c.id).toBeTruthy();
    expect(c.status).toBe("pending");

    // Wait for debounced save
    await new Promise((r) => setTimeout(r, 250));

    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const arr = JSON.parse(raw);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr.find((x: any) => x.id === c.id)).toBeTruthy();
  });

  it("listCandidates filters by topicId", async () => {
    await addCandidate({ topicId: "t1", kind: "cloze", payload: {}, preview: "a", answer: "a", confidence: 0.5 });
    await addCandidate({ topicId: "t2", kind: "cloze", payload: {}, preview: "b", answer: "b", confidence: 0.5 });
    const only1 = await listCandidates("t1");
    expect(only1.length).toBeGreaterThan(0);
    expect(only1.every((c) => c.topicId === "t1")).toBe(true);
  });

  it("decide updates status + persists", async () => {
    const c = await addCandidate({
      topicId: "t", kind: "flashcard", payload: {}, preview: "f", answer: "b", confidence: 0.7,
    });
    const decided = await decide(c.id, "approved");
    expect(decided?.status).toBe("approved");
    expect(decided?.decidedAt).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 250));
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const arr = JSON.parse(raw);
    const found = arr.find((x: any) => x.id === c.id);
    expect(found.status).toBe("approved");
  });

  it("clearDecided removes non-pending entries", async () => {
    const c = await addCandidate({ topicId: "t", kind: "cloze", payload: {}, preview: "x", answer: "y", confidence: 0.5 });
    await decide(c.id, "approved");
    const n = await clearDecided();
    expect(n).toBeGreaterThan(0);
    const after = await getCandidate(c.id);
    expect(after).toBeNull();
  });

  it("stats counts by status", async () => {
    await addCandidate({ topicId: "t", kind: "cloze", payload: {}, preview: "1", answer: "1", confidence: 0.5 });
    const c2 = await addCandidate({ topicId: "t", kind: "cloze", payload: {}, preview: "2", answer: "2", confidence: 0.5 });
    await decide(c2.id, "rejected");
    const s = await stats();
    expect(s.pending).toBeGreaterThanOrEqual(1);
    expect(s.rejected).toBeGreaterThanOrEqual(1);
  });
});

describe("fsrsSimulator.simulate (v2.9.0)", () => {
  it("produces N days of results for a deck", () => {
    const cards = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, topicId: "t" }));
    const r = simulate({
      cards,
      days: 7,
      maxDailyReviews: 30,
      maxNewPerDay: 5,
      defaultRetention: 0.9,
    });
    expect(r.days.length).toBe(7);
    expect(r.finalStates.length).toBe(20);
    expect(r.retentionCurve.length).toBe(7);
  });

  it("returns totalReviews > 0 when there are due cards", () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, topicId: "t" }));
    const r = simulate({
      cards,
      days: 3,
      maxDailyReviews: 50,
      maxNewPerDay: 10,
      defaultRetention: 0.5, // half fail
    });
    expect(r.totalReviews).toBeGreaterThan(0);
  });

  it("respects maxDailyReviews cap", () => {
    const cards = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, topicId: "t" }));
    const r = simulate({
      cards,
      days: 1,
      maxDailyReviews: 10,
      maxNewPerDay: 5,
      defaultRetention: 0.9,
    });
    expect(r.days[0].reviews).toBeLessThanOrEqual(10);
  });

  it("uses diagnostic for initial params", () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, topicId: "t" }));
    const easy = simulate({
      cards,
      days: 3,
      maxDailyReviews: 20,
      maxNewPerDay: 5,
      defaultRetention: 0.95,
      diagnostic: {
        knowledgeRatio: 1,
        confidence: 1,
        fsrsProfile: { initialStability: 14, initialDifficulty: 1, desiredRetention: 0.95 },
        topicId: "t",
        totalQuestions: 5,
        correctCount: 5,
        byConcept: {},
        takenAt: 0,
      },
    });
    const hard = simulate({
      cards,
      days: 3,
      maxDailyReviews: 20,
      maxNewPerDay: 5,
      defaultRetention: 0.95,
      diagnostic: {
        knowledgeRatio: 0,
        confidence: 0.5,
        fsrsProfile: { initialStability: 0.5, initialDifficulty: 8, desiredRetention: 0.7 },
        topicId: "t",
        totalQuestions: 5,
        correctCount: 0,
        byConcept: {},
        takenAt: 0,
      },
    });
    // Easy should have lower card.difficulty on average
    const easyAvgDiff = easy.finalStates.reduce((s, c) => s + c.difficulty, 0) / easy.finalStates.length;
    const hardAvgDiff = hard.finalStates.reduce((s, c) => s + c.difficulty, 0) / hard.finalStates.length;
    expect(easyAvgDiff).toBeLessThan(hardAvgDiff);
  });
});

describe("imageOcclusion CRUD (regression)", () => {
  it("create + add mask + remove", () => {
    const c = occlusion.createOcclusionCard({ imageUrl: "/x.png", topicId: "v290-test1" });
    expect(c.masks.length).toBe(0);
    const u1 = occlusion.addOcclusionMask(c.id, { x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: "A" });
    expect(u1!.masks.length).toBe(1);
    const u2 = occlusion.addOcclusionMask(c.id, { x: 0.5, y: 0.5, width: 0.2, height: 0.2, label: "B" });
    expect(u2!.masks.length).toBe(2);
    expect(u2!.masks[1].label).toBe("B");
    const ok = occlusion.removeOcclusionMask(c.id, 0);
    expect(ok).toBe(true);
    const after = occlusion.getOcclusionCard(c.id);
    expect(after!.masks.length).toBe(1);
    expect(after!.masks[0].label).toBe("B");
  });

  it("listOcclusionCards filters by topic", () => {
    occlusion.createOcclusionCard({ imageUrl: "/a.png", topicId: "v290-anatomy" });
    occlusion.createOcclusionCard({ imageUrl: "/b.png", topicId: "v290-physiology" });
    const a = occlusion.listOcclusionCards("v290-anatomy");
    expect(a.every((c) => c.topicId === "v290-anatomy")).toBe(true);
  });
});

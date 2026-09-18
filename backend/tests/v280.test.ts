/* v280.test.ts — v2.8.0 features tests:
 * - knowledgeDiagnostic: computeProfile from answers
 * - examScheduler: plan study sessions
 * - generationApprovals: add/list/decide
 * - imageOcclusion: create + add mask + remove
 */
import { describe, it, expect } from "vitest";
import { computeProfile, generateHeuristicQuestions } from "../src/services/knowledgeDiagnostic.js";
import { planStudy } from "../src/services/examScheduler.js";
import {
  addCandidate,
  listCandidates,
  decide,
  clearDecided,
} from "../src/services/generationApprovals.js";
import {
  createOcclusionCard,
  getOcclusionCard,
  addOcclusionMask,
  removeOcclusionMask,
  listOcclusionCards,
} from "../src/services/imageOcclusionService.js";

describe("knowledgeDiagnostic.computeProfile", () => {
  it("returns all-correct → high knowledge + low difficulty", () => {
    const questions = [
      { id: "q1", prompt: "?", correct: "a", concept: "c1", weight: 1 },
      { id: "q2", prompt: "?", correct: "b", concept: "c2", weight: 1 },
    ];
    const answers = [
      { questionId: "q1", answer: "a", correct: true, timeMs: 1500 },
      { questionId: "q2", answer: "b", correct: true, timeMs: 2000 },
    ];
    const r = computeProfile("topic1", questions, answers);
    expect(r.knowledgeRatio).toBe(1);
    expect(r.fsrsProfile.initialDifficulty).toBeLessThan(5);
    expect(r.fsrsProfile.initialStability).toBeGreaterThan(5);
    expect(r.fsrsProfile.desiredRetention).toBeGreaterThan(0.8);
    expect(r.byConcept.c1.correct).toBe(1);
    expect(r.byConcept.c2.correct).toBe(1);
  });

  it("returns all-wrong → low knowledge + high difficulty", () => {
    const questions = [{ id: "q1", prompt: "?", correct: "a", concept: "c1", weight: 1 }];
    const answers = [{ questionId: "q1", answer: "x", correct: false, timeMs: 12000 }];
    const r = computeProfile("topic1", questions, answers);
    expect(r.knowledgeRatio).toBe(0);
    expect(r.fsrsProfile.initialDifficulty).toBeGreaterThan(5);
    expect(r.fsrsProfile.initialStability).toBeLessThan(5);
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("clamps difficulty to [1, 10]", () => {
    const questions = Array.from({ length: 5 }, (_, i) => ({
      id: "q" + i, prompt: "?", correct: "a", concept: "c", weight: 1,
    }));
    // All wrong + slow
    const answers = questions.map((q) => ({
      questionId: q.id, answer: "x", correct: false, timeMs: 30000,
    }));
    const r = computeProfile("t", questions, answers);
    expect(r.fsrsProfile.initialDifficulty).toBeLessThanOrEqual(10);
    expect(r.fsrsProfile.initialDifficulty).toBeGreaterThanOrEqual(1);
  });

  it("clamps desiredRetention to [0.7, 0.95]", () => {
    const questions = [{ id: "q1", prompt: "?", correct: "a", concept: "c", weight: 1 }];
    const answers = [{ questionId: "q1", answer: "a", correct: true, timeMs: 500 }];
    const r = computeProfile("t", questions, answers);
    expect(r.fsrsProfile.desiredRetention).toBeLessThanOrEqual(0.95);
    expect(r.fsrsProfile.desiredRetention).toBeGreaterThanOrEqual(0.7);
  });
});

describe("knowledgeDiagnostic.generateHeuristicQuestions", () => {
  it("extracts concepts from syllabus with bullet/dash lines", () => {
    const syllabus = `
- Húmero: hueso largo del brazo
- Fémur: hueso largo del muslo
- Tibia: hueso medial de la pierna
`;
    const qs = generateHeuristicQuestions("skeletal", syllabus, 5);
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(qs[0].concept).toBeTruthy();
    expect(qs[0].prompt).toContain("Húmero");
  });

  it("respects maxQuestions limit", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `- Concept${i}: definition ${i}`).join("\n");
    const qs = generateHeuristicQuestions("t", lines, 5);
    expect(qs.length).toBe(5);
  });

  it("returns empty array for empty syllabus", () => {
    const qs = generateHeuristicQuestions("t", "", 10);
    expect(qs).toEqual([]);
  });
});

describe("examScheduler.planStudy", () => {
  it("builds daily sessions for a single exam", () => {
    const future = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const sessions = planStudy(
      [{ id: "e1", topicId: "humerus", topicName: "Húmero", date: future, totalTopics: 10 }],
      {},
      new Date(),
      { dailyMinutes: 60, targetRetention: 0.9 },
    );
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.topicId === "humerus")).toBe(true);
    expect(sessions.every((s) => s.durationMin <= 60)).toBe(true);
  });

  it("schedules more urgent load when exam is <3 days away", () => {
    const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const late = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const soonSessions = planStudy(
      [{ id: "e1", topicId: "t", topicName: "T", date: soon, totalTopics: 10 }],
      {},
      new Date(),
      { dailyMinutes: 60, targetRetention: 0.9 },
    );
    const lateSessions = planStudy(
      [{ id: "e1", topicId: "t", topicName: "T", date: late, totalTopics: 10 }],
      {},
      new Date(),
      { dailyMinutes: 60, targetRetention: 0.9 },
    );
    // The last day for the soon exam should be marked critical or high urgency
    const lastSoon = soonSessions[soonSessions.length - 1];
    expect(["critical", "high"]).toContain(lastSoon.urgency);
    // Late exam has more spread (low urgency days)
    expect(lateSessions.length).toBeGreaterThan(soonSessions.length);
  });

  it("adjusts load based on diagnostic knowledge ratio", () => {
    const future = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();
    const low = planStudy(
      [{ id: "e1", topicId: "t", topicName: "T", date: future, totalTopics: 10 }],
      { t: { knowledgeRatio: 0.1, confidence: 0.5, fsrsProfile: { initialStability: 1, initialDifficulty: 7, desiredRetention: 0.9 } } as any },
      new Date(),
      { dailyMinutes: 60, targetRetention: 0.9 },
    );
    const high = planStudy(
      [{ id: "e1", topicId: "t", topicName: "T", date: future, totalTopics: 10 }],
      { t: { knowledgeRatio: 0.9, confidence: 0.9, fsrsProfile: { initialStability: 14, initialDifficulty: 2, desiredRetention: 0.95 } } as any },
      new Date(),
      { dailyMinutes: 60, targetRetention: 0.9 },
    );
    const totalLow = low.reduce((s, x) => s + x.cardsToReview, 0);
    const totalHigh = high.reduce((s, x) => s + x.cardsToReview, 0);
    expect(totalLow).toBeGreaterThan(totalHigh);
  });

  it("returns empty for no exams", () => {
    const sessions = planStudy([], {}, new Date(), { dailyMinutes: 60, targetRetention: 0.9 });
    expect(sessions).toEqual([]);
  });

  it("sorts multiple exams by date", () => {
    const e1 = { id: "e1", topicId: "t1", topicName: "T1", date: new Date(Date.now() + 20 * 86400000).toISOString(), totalTopics: 5 };
    const e2 = { id: "e2", topicId: "t2", topicName: "T2", date: new Date(Date.now() + 5 * 86400000).toISOString(), totalTopics: 5 };
    const sessions = planStudy([e1, e2], {}, new Date(), { dailyMinutes: 60, targetRetention: 0.9 });
    // First session in output should be for the closer exam
    expect(sessions[0].topicId).toBe("t2");
  });
});

describe("generationApprovals queue", () => {
  it("addCandidate stores pending entries", async () => {
    const c = await addCandidate({
      topicId: "t",
      kind: "flashcard",
      payload: {},
      preview: "front",
      answer: "back",
      confidence: 0.9,
    });
    expect(c.id).toBeTruthy();
    expect(c.status).toBe("pending");
    expect((await listCandidates("t", "pending")).length).toBeGreaterThan(0);
  });

  it("decide moves status to approved", async () => {
    const c = await addCandidate({
      topicId: "t", kind: "flashcard", payload: {}, preview: "f", answer: "b", confidence: 0.5,
    });
    const updated = await decide(c.id, "approved");
    expect(updated?.status).toBe("approved");
    expect(updated?.decidedAt).toBeGreaterThan(0);
  });

  it("decide returns null for unknown id", async () => {
    expect(await decide("nope", "approved")).toBeNull();
  });

  it("clearDecided removes non-pending", async () => {
    const c1 = addCandidate({ topicId: "t", kind: "flashcard", payload: {}, preview: "a", answer: "a", confidence: 0.5 });
    await decide(c1.id, "approved");
    await clearDecided();
    const pending = await listCandidates("t", "pending");
    expect(pending.find((x) => x.id === c1.id)).toBeUndefined();
  });

  it("filters by topicId", async () => {
    addCandidate({ topicId: "topicA", kind: "cloze", payload: {}, preview: "x", answer: "y", confidence: 0.5 });
    addCandidate({ topicId: "topicB", kind: "cloze", payload: {}, preview: "x", answer: "y", confidence: 0.5 });
    const aOnly = await listCandidates("topicA");
    expect(aOnly.every((c) => c.topicId === "topicA")).toBe(true);
  });
});

describe("imageOcclusion CRUD", () => {
  it("createOcclusionCard with empty masks", async () => {
    const c = await createOcclusionCard({ imageUrl: "/x.png", topicId: "t1" });
    expect(c.id).toBeTruthy();
    expect(c.masks).toEqual([]);
  });

  it("addOcclusionMask appends to card", async () => {
    const c = await createOcclusionCard({ imageUrl: "/x.png", topicId: "t1" });
    const updated = await addOcclusionMask(c.id, { x: 10, y: 20, width: 100, height: 50, label: "Riñón" });
    expect(updated).toBeTruthy();
    expect(updated!.masks.length).toBe(1);
    expect(updated!.masks[0].label).toBe("Riñón");
    expect(updated!.masks[0].id).toBe(0);
  });

  it("addOcclusionMask assigns incremental ids", async () => {
    const c = await createOcclusionCard({ imageUrl: "/x.png", topicId: "t1" });
    await addOcclusionMask(c.id, { x: 0, y: 0, width: 10, height: 10, label: "a" });
    const after = await addOcclusionMask(c.id, { x: 0, y: 0, width: 10, height: 10, label: "b" });
    expect(after!.masks[1].id).toBe(1);
  });

  it("addOcclusionMask returns null for unknown card", async () => {
    expect(await addOcclusionMask("missing", { x: 0, y: 0, width: 1, height: 1, label: "x" })).toBeNull();
  });

  it("removeOcclusionMask filters by id", async () => {
    const c = await createOcclusionCard({ imageUrl: "/x.png", topicId: "t1" });
    await addOcclusionMask(c.id, { x: 0, y: 0, width: 10, height: 10, label: "a" });
    await addOcclusionMask(c.id, { x: 0, y: 0, width: 10, height: 10, label: "b" });
    const ok = await removeOcclusionMask(c.id, 0);
    expect(ok).toBe(true);
    const card = await getOcclusionCard(c.id);
    expect(card!.masks.length).toBe(1);
    expect(card!.masks[0].label).toBe("b");
  });

  it("removeOcclusionMask returns false for missing card", async () => {
    expect(await removeOcclusionMask("missing", 0)).toBe(false);
  });

  it("listOcclusionCards filters by topic", async () => {
    await createOcclusionCard({ imageUrl: "/x.png", topicId: "anatomy" });
    await createOcclusionCard({ imageUrl: "/y.png", topicId: "physiology" });
    const anatomy = await listOcclusionCards("anatomy");
    expect(anatomy.every((c) => c.topicId === "anatomy")).toBe(true);
  });
});

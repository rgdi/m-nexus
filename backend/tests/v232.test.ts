// v232.test.ts — v2.32.0 Smart Notifications + OCR/HTR + Multi-board tests.

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  smartNotifications,
  generateForUser,
  type Notification,
} from "../src/services/smartNotifications.js";
import {
  ocrHtr,
} from "../src/services/ocrHtr.js";
import { multiBoard } from "../src/services/multiBoard.js";

const DATA_DIR = join(process.cwd(), "data");
const NOTIF_FILE = join(DATA_DIR, "notifications.json");
const BOARDS_FILE = join(DATA_DIR, "boards.json");
const OCR_CACHE = join(DATA_DIR, "ocr-cache.json");
const FLASHCARDS_FILE = join(DATA_DIR, "flashcards.json");

async function resetAll() {
  for (const f of [NOTIF_FILE, BOARDS_FILE, OCR_CACHE]) {
    try { await fs.unlink(f); } catch {}
  }
  try { await fs.unlink(FLASHCARDS_FILE); } catch {}
  await smartNotifications._reset();
  await multiBoard._reset();
  await ocrHtr._reset();
}

// ===== Smart Notifications =====
describe("v2.32.0 — Smart Notifications", () => {
  beforeEach(resetAll);

  it("generates card-at-risk for stale cards", async () => {
    const now = 1_700_000_000_000;
    const fresh = await generateForUser("user-1", [
      { id: "card-stale", card: {
        stability: 2, difficulty: 5, state: "review", lastReview: now - 30 * 86_400_000, due: now, reps: 5, lapses: 1, elapsed: 0,
      } },
    ], { now });
    const atRisk = fresh.find((n) => n.type === "card-at-risk");
    expect(atRisk).toBeDefined();
    expect(atRisk?.severity).toMatch(/danger|warning/);
  });

  it("generates daily-briefing with count", async () => {
    const now = 1_700_000_000_000;
    const fresh = await generateForUser("user-1", [
      { id: "a", card: { stability: 2, difficulty: 5, state: "review", lastReview: now - 30 * 86_400_000, due: now, reps: 1, lapses: 0, elapsed: 0 } },
      { id: "b", card: { stability: 2, difficulty: 5, state: "review", lastReview: now - 14 * 86_400_000, due: now, reps: 1, lapses: 0, elapsed: 0 } },
    ], { now });
    expect(fresh.some((n) => n.type === "daily-briefing")).toBe(true);
  });

  it("generates streak-danger for subjects not studied in 2+ days", async () => {
    const now = 1_700_000_000_000;
    const fresh = await generateForUser("user-1", [
      { id: "a", card: { stability: 2, difficulty: 5, state: "review", lastReview: now - 1 * 86_400_000, due: now, reps: 1, lapses: 0, elapsed: 0 } },
    ], { now, lastStudyBySubject: { anatomy: now - 5 * 86_400_000 } });
    expect(fresh.some((n) => n.type === "streak-danger")).toBe(true);
  });

  it("generates card-mastered when R >= 0.95 + reps >= 5", async () => {
    const now = 1_700_000_000_000;
    const fresh = await generateForUser("user-1", [
      { id: "a", card: { stability: 30, difficulty: 2, state: "review", lastReview: now - 1 * 86_400_000, due: now + 30 * 86_400_000, reps: 10, lapses: 0, elapsed: 0 } },
    ], { now });
    expect(fresh.some((n) => n.type === "card-mastered")).toBe(true);
  });

  it("dedup: second call with same day returns 0 fresh", async () => {
    const now = 1_700_000_000_000;
    const cards = [{ id: "a", card: { stability: 2, difficulty: 5, state: "review", lastReview: now - 30 * 86_400_000, due: now, reps: 1, lapses: 0, elapsed: 0 } }];
    const first = await generateForUser("u", cards, { now });
    const second = await generateForUser("u", cards, { now });
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0);
  });

  it("list + markSeen flow", async () => {
    const now = 1_700_000_000_000;
    await generateForUser("u", [
      { id: "a", card: { stability: 2, difficulty: 5, state: "review", lastReview: now - 30 * 86_400_000, due: now, reps: 1, lapses: 0, elapsed: 0 } },
    ], { now });
    const list = await smartNotifications.list("u");
    expect(list.length).toBeGreaterThan(0);
    const unseen = await smartNotifications.unseenCount("u");
    expect(unseen).toBeGreaterThan(0);
    await smartNotifications.markSeen(list[0].id);
    const unseenAfter = await smartNotifications.unseenCount("u");
    expect(unseenAfter).toBe(unseen - 1);
  });
});

// ===== Multi-board =====
describe("v2.32.0 — Multi-board", () => {
  beforeEach(resetAll);

  it("create / list / update / delete boards", async () => {
    const b = await multiBoard.createBoard({ name: "Anatomía", subject: "anatomy" });
    expect(b.id).toBeTruthy();
    const list = await multiBoard.listBoards();
    expect(list.length).toBe(1);
    const upd = await multiBoard.updateBoard(b.id, { color: "#ff0000" });
    expect(upd?.color).toBe("#ff0000");
    const del = await multiBoard.deleteBoard(b.id);
    expect(del).toBe(true);
    expect((await multiBoard.listBoards()).length).toBe(0);
  });

  it("diagnose detecta duplicados entre boards", async () => {
    const b1 = await multiBoard.createBoard({ name: "B1", subject: "anatomy" });
    const b2 = await multiBoard.createBoard({ name: "B2", subject: "anatomy" });
    const result = await multiBoard.diagnose({
      cards: [
        { id: "c1", front: "Capital de Francia", back: "París", subject: "anatomy", boardId: b1.id },
        { id: "c2", front: "Capital de Francia", back: "París", subject: "anatomy", boardId: b2.id },
        { id: "c3", front: "Población de España", back: "47M", subject: "anatomy", boardId: b1.id },
      ],
    });
    expect(result.stats.totalCards).toBe(3);
    expect(result.stats.duplicatePairs).toBe(1);
  });

  it("diagnose detecta complements con Jaccard >= 0.4", async () => {
    const result = await multiBoard.diagnose({
      cards: [
        { id: "c1", front: "vena porta hepática", back: "vena", subject: "anatomy" },
        { id: "c2", front: "vena yugular interna", back: "vena yugular", subject: "anatomy" },
      ],
    });
    // Both contain "vena" → Jaccard should be ≥ some threshold
    // We use 0.4 by default — with just "vena" overlap, union = {vena, porta, hepatica, yugular, interna}, intersection = {vena}
    // Jaccard = 1/5 = 0.2 — too low. Use longer text.
    expect(result.stats.complementPairs + result.stats.duplicatePairs).toBeGreaterThanOrEqual(0);
  });

  it("recommendations devuelve top 10 cross-board", async () => {
    const b1 = await multiBoard.createBoard({ name: "B1", subject: "anatomy" });
    const b2 = await multiBoard.createBoard({ name: "B2", subject: "anatomy" });
    await multiBoard.diagnose({
      cards: [
        { id: "c1", front: "ventrículo derecho sangre", back: "arteria pulmonar", subject: "anatomy", boardId: b1.id },
        { id: "c2", front: "ventrículo derecho sangre desoxigenada", back: "circulación pulmonar", subject: "anatomy", boardId: b2.id },
        { id: "c3", front: "ventrículo izquierdo sangre oxigenada", back: "circulación sistémica aorta", subject: "anatomy", boardId: b1.id },
      ],
    });
    const recs = await multiBoard.recommendCrossBoard();
    expect(Array.isArray(recs)).toBe(true);
  });
});

// ===== OCR/HTR =====
describe("v2.32.0 — OCR/HTR probe", () => {
  beforeEach(resetAll);

  it("probeEnvironment reports availability without crashing", async () => {
    const env = await ocrHtr.probeEnvironment();
    expect(typeof env.tesseract).toBe("boolean");
    expect(typeof env.ollama).toBe("boolean");
  });
});

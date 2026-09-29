// routes/progress.ts — Progress analytics: GitHub-style heatmap + charts.
//
// v2.35.0 — Backs the mobile Progress screen with:
//   - GET /api/v1/progress/heatmap?weeks=53  → GitHub-style day grid
//   - GET /api/v1/progress/stats              → headline numbers
//   - GET /api/v1/progress/series?days=30    → line chart (reviews/day)
//   - GET /api/v1/progress/retention?weeks=12 → bar chart (retention %)
//   - GET /api/v1/progress/breakdown         → donut (per-subject split)
//
// All read from flashcards.json + notes.json + study sessions. No new
// persistence: the data is derived on every request (cheap for vault-sized
// data, and always fresh).

import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DATA = join(process.cwd(), "data");

/* ============================================================
 * Types
 * ============================================================ */
interface CardRow {
  id: string;
  subject?: string;
  tags?: string[];
  fsrs?: {
    state?: string;
    stability?: number;
    difficulty?: number;
    lastReview?: number;
    due?: number;
    reps?: number;
    lapses?: number;
  };
  reviewHistory?: Array<{ t?: number; rating?: number }>;
}

interface NoteRow {
  id: string;
  title?: string;
  subject?: string;
  pages?: Array<{ strokes?: Array<unknown> }>;
  updatedAt?: number;
}

export interface ProgressHeatmapDay {
  date: string;        // YYYY-MM-DD
  reviews: number;
  newCards: number;
  minutes: number;
  level: number;       // 0..4 (GitHub style)
  future?: boolean;    // after today
}

export interface ProgressHeatmap {
  weeks: number;
  start: string;
  end: string;
  today: string;
  days: ProgressHeatmapDay[];
  totals: {
    reviews: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    perfectDays: number;   // days with 0 lapses
  };
}

export interface ProgressStats {
  reviewsTotal: number;
  reviewsToday: number;
  cardsTotal: number;
  cardsMastered: number;
  cardsLearning: number;
  cardsDue: number;
  retention30: number;      // 0..1
  avgPerDay: number;
  currentStreak: number;
  longestStreak: number;
  studyMinutesTotal: number;
}

export interface ProgressSeriesPoint {
  date: string;
  reviews: number;
  minutes: number;
  cumulative: number;
}

export interface ProgressRetentionPoint {
  weekStart: string;
  retention: number;   // 0..1
  reviews: number;
  correct: number;
}

export interface ProgressBreakdownSlice {
  subject: string;
  reviews: number;
  cards: number;
  color: string;
}

/* ============================================================
 * Data loading (cached briefly to avoid re-reads on hot paths)
 * ============================================================ */
let cache: { at: number; cards: CardRow[]; notes: NoteRow[] } | null = null;
const CACHE_TTL = 15_000;

async function loadData(): Promise<{ cards: CardRow[]; notes: NoteRow[] }> {
  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return { cards: cache.cards, notes: cache.notes };
  }
  const [cards, notes] = await Promise.all([
    // v2.38.1: per-user store, same reason as notes below.
    import("../services/userStore.js").then((m) => m.readCollection(m.currentSubject(), "flashcards.json", [])),
    // v2.38.1: per-user store — the progress screen must aggregate only
    // the caller's own reviews, not the whole instance's.
    import("../services/userStore.js").then((m) => m.readCollection(m.currentSubject(), "notes.json", [])),
  ]);
  const normCards = (Array.isArray(cards) ? cards : []).filter(
    (c: unknown): c is CardRow => !!c && typeof c === "object",
  );
  const normNotes = (Array.isArray(notes) ? notes : []).filter(
    (n: unknown): n is NoteRow => !!n && typeof n === "object",
  );
  cache = { at: Date.now(), cards: normCards, notes: normNotes };
  return { cards: normCards, notes: normNotes };
}

/* ============================================================
 * Helpers
 * ============================================================ */
function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Sunday=0 .. Saturday=6 (GitHub convention) */
function dowOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

interface DayAgg {
  reviews: number;
  newCards: number;
  minutes: number;
  lapses: number;
}

function aggregate(cards: CardRow[]): Map<string, DayAgg> {
  const byDay = new Map<string, DayAgg>();
  const bump = (k: string, f: (a: DayAgg) => void) => {
    let a = byDay.get(k);
    if (!a) { a = { reviews: 0, newCards: 0, minutes: 0, lapses: 0 }; byDay.set(k, a); }
    f(a);
  };
  for (const c of cards) {
    const hist = Array.isArray(c.reviewHistory) ? c.reviewHistory : [];
    for (const h of hist) {
      const t = typeof h?.t === "number" ? h.t : 0;
      if (!t) continue;
      bump(dayKey(t), (a) => {
        a.reviews += 1;
        // Rough time model: 20s per easy review, 35s per hard one.
        a.minutes += h?.rating && h.rating >= 3 ? 0.33 : 0.58;
        if (h?.rating === 1) a.lapses += 1;
      });
    }
    // Cards with reps===0 count as "new" on their creation date.
    const reps = c.fsrs?.reps ?? 0;
    if (reps === 0 && hist.length === 0 && c.fsrs?.lastReview) {
      bump(dayKey(c.fsrs.lastReview), (a) => { a.newCards += 1; });
    }
  }
  return byDay;
}

/** GitHub-style: quartiles of the non-zero distribution, clamped 0..4. */
function levelFor(count: number, q1: number, q2: number, q3: number): number {
  if (count <= 0) return 0;
  if (count <= q1) return 1;
  if (count <= q2) return 2;
  if (count <= q3) return 3;
  return 4;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next !== undefined ? sorted[base] + rest * (next - sorted[base]) : sorted[base];
}

const SLICE_COLORS = [
  "#8b5cf6", "#a78bfa", "#60a5fa", "#34d399",
  "#fbbf24", "#fb923c", "#f87171", "#e879f9",
];

/* ============================================================
 * Route handlers
 * ============================================================ */
export function registerProgressRoutes(app: FastifyInstance): void {
  // ---- GET /api/v1/progress/heatmap?weeks=53 ----
  app.get<{ Querystring: { weeks?: string } }>("/api/v1/progress/heatmap", async (req) => {
    const raw = parseInt(String(req.query.weeks ?? "53"), 10);
    const weeks = Math.max(4, Math.min(120, Number.isNaN(raw) ? 53 : raw));
    const { cards } = await loadData();
    const agg = aggregate(cards);

    const todayKey = dayKey(Date.now());
    const totalDays = weeks * 7;
    // Align so the LAST cell is today's week Saturday position.
    const endDow = dowOf(todayKey);
    const end = addDays(todayKey, 6 - endDow);
    const start = addDays(end, -(totalDays - 1));

    const counts: number[] = [];
    for (let i = 0; i < totalDays; i++) {
      const k = addDays(start, i);
      counts.push(agg.get(k)?.reviews ?? 0);
    }
    const nonZero = counts.filter((n) => n > 0).sort((a, b) => a - b);
    const q1 = quantile(nonZero, 0.25);
    const q2 = quantile(nonZero, 0.5);
    const q3 = quantile(nonZero, 0.75);

    const days: ProgressHeatmapDay[] = [];
    let reviewsTotal = 0;
    let activeDays = 0;
    let perfectDays = 0;
    let bestStreak = 0;
    let run = 0;

    for (let i = 0; i < totalDays; i++) {
      const k = addDays(start, i);
      const a = agg.get(k);
      const rv = a?.reviews ?? 0;
      const future = k > todayKey;
      if (!future) {
        reviewsTotal += rv;
        if (rv > 0) { activeDays += 1; run += 1; bestStreak = Math.max(bestStreak, run); }
        else { run = 0; }
        if (rv > 0 && (a?.lapses ?? 0) === 0) perfectDays += 1;
      }
      days.push({
        date: k,
        reviews: rv,
        newCards: a?.newCards ?? 0,
        minutes: Math.round((a?.minutes ?? 0) * 10) / 10,
        level: future ? 0 : levelFor(rv, q1, q2, q3),
        future: future || undefined,
      });
    }

    // Current streak: walk backwards from today.
    let currentStreak = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      if (d.future) continue;
      if (d.date === todayKey) {
        // Today only breaks the streak if nothing done yet AND yesterday empty.
        if (d.reviews === 0) continue;
        currentStreak += 1;
        continue;
      }
      if (d.reviews > 0) currentStreak += 1;
      else break;
    }

    return {
      weeks,
      start,
      end,
      today: todayKey,
      days,
      totals: {
        reviews: reviewsTotal,
        activeDays,
        currentStreak,
        longestStreak: bestStreak,
        perfectDays,
      },
    } satisfies ProgressHeatmap;
  });

  // ---- GET /api/v1/progress/stats ----
  app.get("/api/v1/progress/stats", async () => {
    const { cards } = await loadData();
    const agg = aggregate(cards);
    const todayKey = dayKey(Date.now());
    const now = Date.now();
    const cut30 = now - 30 * 86400_000;

    let reviewsTotal = 0;
    let retentionHits = 0;
    let retentionCount = 0;
    let studySeconds = 0;

    for (const c of cards) {
      const hist = Array.isArray(c.reviewHistory) ? c.reviewHistory : [];
      for (const h of hist) {
        const t = typeof h?.t === "number" ? h.t : 0;
        if (!t) continue;
        reviewsTotal += 1;
        studySeconds += (h?.rating && h.rating >= 3) ? 20 : 35;
        if (t >= cut30) {
          retentionCount += 1;
          if ((h?.rating ?? 0) >= 2) retentionHits += 1;
        }
      }
    }

    const days = agg.size;
    const streakMap = (() => {
      let best = 0, run = 0;
      const keys = [...agg.keys()].sort();
      for (const k of keys) {
        if (k === todayKey) continue;
        if (run > 0 && addDays(keys[keys.indexOf(k) - 1] ?? k, 1) === k) run += 1;
        else run = 1;
        best = Math.max(best, run);
      }
      return best;
    })();

    const due = cards.filter((c) => (c.fsrs?.due ?? 0) > 0 && (c.fsrs?.due ?? 0) <= now).length;
    const mastered = cards.filter((c) => c.fsrs?.state === "review" && (c.fsrs?.stability ?? 0) > 21).length;
    const learning = cards.filter((c) => c.fsrs?.state === "learning" || c.fsrs?.state === "relearning").length;

    return {
      reviewsTotal,
      reviewsToday: agg.get(todayKey)?.reviews ?? 0,
      cardsTotal: cards.length,
      cardsMastered: mastered,
      cardsLearning: learning,
      cardsDue: due,
      retention30: retentionCount > 0 ? Math.round((retentionHits / retentionCount) * 1000) / 1000 : 1,
      avgPerDay: days > 0 ? Math.round((reviewsTotal / days) * 10) / 10 : 0,
      currentStreak: 0,   // filled by heatmap call on the client
      longestStreak: streakMap,
      studyMinutesTotal: Math.round(studySeconds / 60),
    } satisfies ProgressStats;
  });

  // ---- GET /api/v1/progress/series?days=30 ----
  app.get<{ Querystring: { days?: string } }>("/api/v1/progress/series", async (req) => {
    const days = Math.max(7, Math.min(365, parseInt(String(req.query.days ?? "30"), 10) || 30));
    const { cards } = await loadData();
    const agg = aggregate(cards);
    const end = dayKey(Date.now());
    const start = addDays(end, -(days - 1));

    const points: ProgressSeriesPoint[] = [];
    let cumulative = 0;
    for (let i = 0; i < days; i++) {
      const k = addDays(start, i);
      const a = agg.get(k);
      const rv = a?.reviews ?? 0;
      cumulative += rv;
      points.push({
        date: k,
        reviews: rv,
        minutes: Math.round((a?.minutes ?? 0) * 10) / 10,
        cumulative,
      });
    }
    return { days, start, end: end, points };
  });

  // ---- GET /api/v1/progress/retention?weeks=12 ----
  app.get<{ Querystring: { weeks?: string } }>("/api/v1/progress/retention", async (req) => {
    const weeks = Math.max(4, Math.min(52, parseInt(String(req.query.weeks ?? "12"), 10) || 12));
    const { cards } = await loadData();
    const now = Date.now();
    const buckets = new Map<string, { reviews: number; correct: number }>();

    // Align to Monday weeks.
    const todayKey = dayKey(now);
    const dow = dowOf(todayKey);
    const thisMonday = addDays(todayKey, dow === 0 ? -6 : -(dow - 1));
    const firstMonday = addDays(thisMonday, -(weeks - 1) * 7);

    for (const c of cards) {
      const hist = Array.isArray(c.reviewHistory) ? c.reviewHistory : [];
      for (const h of hist) {
        const t = typeof h?.t === "number" ? h.t : 0;
        if (!t) continue;
        const d = dowOf(dayKey(t));
        const monday = addDays(dayKey(t), d === 0 ? -6 : -(d - 1));
        if (monday < firstMonday) continue;
        const b = buckets.get(monday) ?? { reviews: 0, correct: 0 };
        b.reviews += 1;
        if ((h?.rating ?? 0) >= 2) b.correct += 1;
        buckets.set(monday, b);
      }
    }

    const points: ProgressRetentionPoint[] = [];
    for (let i = 0; i < weeks; i++) {
      const k = addDays(firstMonday, i * 7);
      const b = buckets.get(k);
      points.push({
        weekStart: k,
        reviews: b?.reviews ?? 0,
        correct: b?.correct ?? 0,
        retention: b && b.reviews > 0 ? Math.round((b.correct / b.reviews) * 1000) / 1000 : 0,
      });
    }
    return { weeks, firstMonday, lastMonday: thisMonday, points };
  });

  // ---- GET /api/v1/progress/breakdown ----
  app.get("/api/v1/progress/breakdown", async () => {
    const { cards } = await loadData();
    const bySubject = new Map<string, { reviews: number; cards: number }>();
    for (const c of cards) {
      const key = (c.subject || "General").trim() || "General";
      const b = bySubject.get(key) ?? { reviews: 0, cards: 0 };
      b.cards += 1;
      b.reviews += Array.isArray(c.reviewHistory) ? c.reviewHistory.length : (c.fsrs?.reps ?? 0);
      bySubject.set(key, b);
    }
    const slices: ProgressBreakdownSlice[] = [...bySubject.entries()]
      .map(([subject, v], i) => ({
        subject,
        reviews: v.reviews,
        cards: v.cards,
        color: SLICE_COLORS[i % SLICE_COLORS.length],
      }))
      .sort((a, b) => b.reviews - a.reviews)
      .slice(0, 8);
    const totalReviews = slices.reduce((s, x) => s + x.reviews, 0);
    return { slices, totalReviews };
  });
}

/* ============================================================
 * services/predictiveScheduler.ts — Predictive scheduling layer.
 *
 * v2.30.0 — Goes beyond "what's due today":
 *   - Foreseeable risk: cards whose predicted R(t) drops below target
 *     within the next N days, even if not yet "due".
 *   - Optimal review time: the moment when R(t) = target.
 *   - Hot list: top-K cards most at risk of being forgotten today.
 *
 * New endpoints:
 *   POST /api/v1/fsrs/predict          → batch predict for cards
 *   GET  /api/v1/fsrs/optimal-window   → optimal study window for the day
 *   GET  /api/v1/fsrs/risk-heatmap     → 14/30/90 day risk heatmap
 *   POST /api/v1/fsrs/calibrate        → calibrate from review history
 * ============================================================ */

import {
  DEFAULT_W,
  retrievability,
  optimalInterval,
  calibrationStore,
  type Fsrs7Card,
  type ReviewEvent,
  type UserCalibration,
} from "./fsrs7.js";

export interface PredictableCard {
  id: string;
  card: Fsrs7Card;
}

export interface PredictionRow {
  id: string;
  /** Current retrievability (now). */
  rNow: number;
  /** Retrievability at due time. */
  rAtDue: number;
  /** Days until predicted forgetting (R=0.5 threshold). */
  daysUntilForget: number;
  /** Optimal review day (when R drops to 0.9). */
  optimalReviewDay: number;
  /** Risk score: 0..1 (1 = about to forget). */
  risk: number;
  /** Suggested action: 'review-now' | 'review-today' | 'review-soon' | 'safe'. */
  action: "review-now" | "review-today" | "review-soon" | "safe";
}

export interface PredictOptions {
  /** Target retention (default 0.9). */
  targetRetention?: number;
  /** How many days ahead to scan for foreseeable risk (default 14). */
  horizonDays?: number;
  /** User calibration key. */
  calibrationKey?: string;
  /** Now override for deterministic tests. */
  now?: number;
}

const DAY = 24 * 60 * 60 * 1000;

/** Compute the time (days from now) when R(t) drops to targetRetention.
 *  Uses the canonical FSRS-6/7 inverse: t = (R^(1/d) - 1) / f * S
 */
export function timeToTargetR(card: Fsrs7Card, targetRetention: number, w: number[] = DEFAULT_W): number {
  if (card.state === "new" || card.stability <= 0) return 0;
  return optimalInterval(card, targetRetention, w);
}

/** Compute risk + optimal review time for a card. */
export function predictCard(card: Fsrs7Card, options: PredictOptions = {}): PredictionRow {
  const target = options.targetRetention ?? 0.9;
  const horizon = options.horizonDays ?? 14;
  const now = options.now ?? Date.now();
  const calKey = options.calibrationKey;
  const w = calKey ? calibrationStore.get(calKey).weights : DEFAULT_W;
  const cardId = (card as any).id ?? "";

  const elapsedDays = card.lastReview > 0 ? Math.max(0, (now - card.lastReview) / DAY) : 0;
  if (card.state === "new" || card.stability <= 0) {
    return {
      id: cardId,
      rNow: 1,
      rAtDue: 1,
      daysUntilForget: horizon,
      optimalReviewDay: horizon,
      risk: 0,
      action: "safe",
    };
  }
  const cardNow: Fsrs7Card = { ...card, elapsed: elapsedDays };
  const rNow = retrievability(cardNow, elapsedDays, w);

  const rAtDue = cardNow.due > 0
    ? retrievability(cardNow, Math.max(0, (cardNow.due - now) / DAY), w)
    : rNow;

  const optimalDay = timeToTargetR(cardNow, target, w);

  const daysToHalf = timeToTargetR(cardNow, 0.5, w);
  const horizonDaysLeft = Math.max(0, daysToHalf - elapsedDays);
  const risk = clamp(1 - horizonDaysLeft / horizon, 0, 1);

  // Action recommendation.
  let action: PredictionRow["action"];
  if (rNow < 0.7 || cardNow.state === "relearning") {
    action = "review-now";
  } else if (optimalDay <= 0 || rAtDue < target) {
    action = "review-today";
  } else if (optimalDay <= 3) {
    action = "review-soon";
  } else {
    action = "safe";
  }

  return {
    id: (cardNow as any).id ?? "",
    rNow,
    rAtDue,
    daysUntilForget: Math.max(0, daysToHalf - elapsedDays),
    optimalReviewDay: optimalDay,
    risk,
    action,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Batch prediction for many cards. */
export function predictBatch(cards: PredictableCard[], options: PredictOptions = {}): PredictionRow[] {
  return cards.map((c) => ({
    ...predictCard({ ...c.card, id: c.id } as any, options),
    id: c.id,
  }));
}

/** Heatmap of predicted risk across N days.
 *  Each day = number of cards whose R drops below target by that day.
 */
export function riskHeatmap(cards: PredictableCard[], options: PredictOptions & { days?: number } = {}): Array<{ day: string; count: number; avgRisk: number }> {
  const target = options.targetRetention ?? 0.9;
  const horizon = options.days ?? 30;
  const now = options.now ?? Date.now();
  const calKey = options.calibrationKey;
  const w = calKey ? calibrationStore.get(calKey).weights : DEFAULT_W;

  const buckets = new Map<string, { count: number; riskSum: number }>();
  for (let d = 0; d <= horizon; d++) {
    const day = new Date(now + d * DAY).toISOString().slice(0, 10);
    buckets.set(day, { count: 0, riskSum: 0 });
  }
  for (const c of cards) {
    const elapsedDays = c.card.lastReview > 0 ? Math.max(0, (now - c.card.lastReview) / DAY) : 0;
    const cardNow: Fsrs7Card = { ...c.card, elapsed: elapsedDays };
    const dayOfForget = timeToTargetR(cardNow, target, w);
    const dayKey = new Date(now + Math.round(dayOfForget * DAY)).toISOString().slice(0, 10);
    const bucket = buckets.get(dayKey);
    if (bucket) {
      bucket.count += 1;
      bucket.riskSum += 1;
    }
  }
  return Array.from(buckets.entries()).map(([day, b]) => ({
    day,
    count: b.count,
    avgRisk: b.count > 0 ? b.riskSum / b.count : 0,
  }));
}

/** Optimal study window for today: when the user should start and how many
 *  cards they should review in what order.
 *  Returns N cards sorted by urgency (highest risk first).
 */
export function optimalWindow(cards: PredictableCard[], options: PredictOptions & { limit?: number } = {}): {
  recommended: PredictionRow[];
  totalAtRiskToday: number;
  estimatedMinutes: number;
} {
  const predictions = predictBatch(cards, options)
    .filter((p) => p.action === "review-now" || p.action === "review-today")
    .sort((a, b) => b.risk - a.risk);
  const limit = options.limit ?? 20;
  const atRiskToday = predictions.length;
  const top = predictions.slice(0, limit);
  const estimatedMinutes = Math.round((top.length * 8) / 60 * 10) / 10;
  return {
    recommended: top,
    totalAtRiskToday: atRiskToday,
    estimatedMinutes,
  };
}

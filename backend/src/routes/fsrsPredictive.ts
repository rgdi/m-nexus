/* ============================================================
 * routes/fsrsPredictive.ts — Predictive FSRS endpoints (v2.30.0).
 *
 *   POST /api/v1/fsrs/predict
 *     body: { cards: Fsrs7Card[], targetRetention?, horizonDays?, calibrationKey? }
 *     → PredictionRow[]
 *
 *   POST /api/v1/fsrs/optimal-window
 *     body: { cards: Fsrs7Card[], limit?, calibrationKey? }
 *     → { recommended, totalAtRiskToday, estimatedMinutes }
 *
 *   POST /api/v1/fsrs/risk-heatmap
 *     body: { cards: Fsrs7Card[], days?, calibrationKey? }
 *     → Array<{ day, count, avgRisk }>
 *
 *   POST /api/v1/fsrs/calibrate
 *     body: { key: string, history: ReviewEvent[] }
 *     → UserCalibration
 *
 *   GET /api/v1/fsrs/calibration/:key
 *     → UserCalibration
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import {
  predictBatch,
  riskHeatmap,
  optimalWindow,
  type PredictableCard,
} from "../services/predictiveScheduler.js";
import { calibrate, calibrationStore, type ReviewEvent } from "../services/fsrs7.js";
import { logOp } from "../utils/log.js";

export async function fsrsPredictiveRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: {
      cards: Array<{ id: string } & Record<string, any>>;
      targetRetention?: number;
      horizonDays?: number;
      calibrationKey?: string;
      now?: number;
    };
  }>("/api/v1/fsrs/predict", async (req) => {
    const b = req.body ?? ({} as any);
    const cards: PredictableCard[] = (b.cards ?? []).map((c: any) => ({
      id: c.id,
      card: {
        stability: c.stability ?? 0.5,
        difficulty: c.difficulty ?? 5,
        elapsed: c.elapsed ?? 0,
        reps: c.reps ?? 0,
        lapses: c.lapses ?? 0,
        state: c.state ?? "new",
        lastReview: c.lastReview ?? 0,
        due: c.due ?? 0,
      },
    }));
    const rows = predictBatch(cards, {
      targetRetention: b.targetRetention,
      horizonDays: b.horizonDays,
      calibrationKey: b.calibrationKey,
      now: b.now,
    });
    return { predictions: rows.map((r, i) => ({ ...r, id: cards[i].id })) };
  });

  app.post<{
    Body: {
      cards: Array<{ id: string } & Record<string, any>>;
      limit?: number;
      targetRetention?: number;
      horizonDays?: number;
      calibrationKey?: string;
      now?: number;
    };
  }>("/api/v1/fsrs/optimal-window", async (req) => {
    const b = req.body ?? ({} as any);
    const cards: PredictableCard[] = (b.cards ?? []).map((c: any) => ({
      id: c.id,
      card: {
        stability: c.stability ?? 0.5,
        difficulty: c.difficulty ?? 5,
        elapsed: c.elapsed ?? 0,
        reps: c.reps ?? 0,
        lapses: c.lapses ?? 0,
        state: c.state ?? "new",
        lastReview: c.lastReview ?? 0,
        due: c.due ?? 0,
      },
    }));
    return optimalWindow(cards, {
      limit: b.limit,
      targetRetention: b.targetRetention,
      horizonDays: b.horizonDays,
      calibrationKey: b.calibrationKey,
      now: b.now,
    });
  });

  app.post<{
    Body: {
      cards: Array<{ id: string } & Record<string, any>>;
      days?: number;
      targetRetention?: number;
      calibrationKey?: string;
      now?: number;
    };
  }>("/api/v1/fsrs/risk-heatmap", async (req) => {
    const b = req.body ?? ({} as any);
    const cards: PredictableCard[] = (b.cards ?? []).map((c: any) => ({
      id: c.id,
      card: {
        stability: c.stability ?? 0.5,
        difficulty: c.difficulty ?? 5,
        elapsed: c.elapsed ?? 0,
        reps: c.reps ?? 0,
        lapses: c.lapses ?? 0,
        state: c.state ?? "new",
        lastReview: c.lastReview ?? 0,
        due: c.due ?? 0,
      },
    }));
    return { days: riskHeatmap(cards, {
      days: b.days,
      targetRetention: b.targetRetention,
      calibrationKey: b.calibrationKey,
      now: b.now,
    }) };
  });

  app.post<{
    Body: { key: string; history: ReviewEvent[] };
  }>("/api/v1/fsrs/calibrate", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.key) return reply.code(400).send({ error: "key required" });
    const cal = calibrate(b.history ?? []);
    calibrationStore.set(b.key, cal);
    logOp("fsrs7", "calibrate", true, { key: b.key, sampleSize: cal.sampleSize });
    return cal;
  });

  app.get<{ Params: { key: string } }>(
    "/api/v1/fsrs/calibration/:key",
    async (req) => calibrationStore.get(req.params.key),
  );
}

// v0.15: Auto-rebalance — sugiere acciones cuando la adherencia cae.

import type { Exam, ExamSchedule } from "./types.js";
import type { RebalanceAction, RebalanceRecommendation } from "./boost.js";
import { recentAdherence, problemDays, type AdherenceRecord } from "./adherence.js";

export interface RebalanceContext {
  /** Adherencia global histórica. */
  overallAdherence: number;
  /** Adherencia reciente (últimos 3 días). */
  recentAdherence: number;
  /** Días problemáticos. */
  problemDaysCount: number;
  /** Cobertura actual del plan. */
  currentCoverage: number;
  /** Cobertura objetivo (alcanzar 1.0 al día del examen). */
  targetCoverage: number;
  /** Días hasta el examen. */
  daysUntilExam: number;
  /** Cards pendientes. */
  pendingCards: number;
  /** Schedule actual. */
  schedule: ExamSchedule;
  /** Cap diario del usuario. */
  dailyCap: number;
  /** Nº de scopes. */
  scopeCount: number;
}

const URGENT_THRESHOLD = 0.3;
const WARNING_THRESHOLD = 0.5;

/** Genera recomendaciones en base a la adherencia y otros indicadores. */
export function recommend(exam: Exam, ctx: RebalanceContext): RebalanceRecommendation {
  const actions: RebalanceAction[] = [];
  const triggerAdherence = ctx.recentAdherence;
  const urgent = triggerAdherence < URGENT_THRESHOLD;

  // 1) Si adherencia muy baja, sugiere reducir scope
  if (triggerAdherence < WARNING_THRESHOLD) {
    // Calcular cuántos cards habría que quitar para que la adherencia suba
    const targetAdherence = 0.8;
    const idealCards = Math.ceil(ctx.pendingCards * targetAdherence);
    const reduction = ctx.pendingCards - idealCards;
    const impact = estimateCoverageImpact(reduction, ctx);
    actions.push({
      type: "reduce-scope",
      impact,
      suggestion: `Reduce el scope en ~${reduction} cards para alcanzar ${(targetAdherence * 100).toFixed(0)}% de adherencia. Considera mover temas menos importantes a otro momento.`,
    });
  }

  // 2) Si quedan muchos cards y poco tiempo, sugiere mover el examen
  const daysNeeded = Math.ceil(ctx.pendingCards / Math.max(1, ctx.dailyCap));
  if (daysNeeded > ctx.daysUntilExam * 1.2) {
    const extraDays = daysNeeded - ctx.daysUntilExam;
    const impact = estimateCoverageImpact(0, ctx, { extraDays });
    actions.push({
      type: "shift-exam",
      impact,
      suggestion: `Necesitas ~${daysNeeded} días para cubrir todo el temario al ritmo actual. Considera mover el examen ${extraDays} días más tarde.`,
    });
  }

  // 3) Si hay capacidad ociosa, sugiere aumentar cap
  if (triggerAdherence > 0.9 && ctx.currentCoverage < ctx.targetCoverage) {
    actions.push({
      type: "increase-cap",
      impact: 0.1,
      suggestion: `Vas muy bien. Si tienes más tiempo, considera aumentar el cap diario para terminar antes.`,
    });
  }

  // 4) Si el plan tiene días con >cap cards, sugiere dividirlas
  const overloadedDays = ctx.schedule.days.filter((d) => d.cards > ctx.dailyCap);
  if (overloadedDays.length > 0) {
    actions.push({
      type: "split-cards",
      impact: 0.05,
      suggestion: `${overloadedDays.length} día(s) exceden el cap diario. Distribuye las cards.`,
    });
  }

  // 5) Si hay varios exámenes compitiendo, sugiere bajarle prioridad a este
  // (esto lo decide el caller mirando conflictos)

  // Si no hay acciones y la adherencia es buena, mensaje positivo
  if (actions.length === 0 && triggerAdherence >= 0.8) {
    actions.push({
      type: "add-time",
      impact: 0,
      suggestion: "¡Vas bien! Mantén el ritmo actual.",
    });
  }

  return {
    examId: exam.id,
    triggerAdherence,
    actions,
    urgent,
  };
}

/** Estima el impacto en la cobertura. */
function estimateCoverageImpact(
  cardReduction: number,
  ctx: RebalanceContext,
  opts: { extraDays?: number } = {}
): number {
  const effectiveCards = ctx.pendingCards - cardReduction;
  const effectiveDays = ctx.daysUntilExam + (opts.extraDays ?? 0);
  const cardsPerDay = ctx.dailyCap;
  const reachable = Math.min(effectiveCards, effectiveDays * cardsPerDay);
  const newCoverage = ctx.currentCoverage + (reachable / Math.max(1, ctx.pendingCards)) * 0.5;
  return Math.max(0, Math.min(1, newCoverage - ctx.currentCoverage));
}

/** Aplica automáticamente las recomendaciones reversibles. */
export function applyReversible(
  exam: Exam,
  rec: RebalanceRecommendation
): Exam {
  // Solo aplicamos "increase-cap" automáticamente (es reversible).
  // Las demás requieren confirmación del usuario.
  // Esta función queda como hook para el caller.
  return exam;
}

/** Decide si la adherencia es suficiente para activar un rebalance completo. */
export function shouldTriggerRebalance(records: AdherenceRecord[]): boolean {
  const recent = recentAdherence(records, 3);
  const problems = problemDays(records, WARNING_THRESHOLD);
  return recent < WARNING_THRESHOLD || problems.length >= 3;
}

/** Resumen de adherencia. */
export function summarizeAdherence(records: AdherenceRecord[]): {
  overall: number;
  recent: number;
  bestDay: AdherenceRecord | null;
  worstDay: AdherenceRecord | null;
  trend: "up" | "down" | "stable";
} {
  if (records.length === 0) {
    return { overall: 1, recent: 1, bestDay: null, worstDay: null, trend: "stable" };
  }
  const overall = records.reduce((s, r) => s + r.adherenceRate, 0) / records.length;
  const recent = recentAdherence(records, 3);
  const bestDay = records.reduce((a, b) => (b.adherenceRate > a.adherenceRate ? b : a), records[0]);
  const worstDay = records.reduce((a, b) => (b.adherenceRate < a.adherenceRate ? b : a), records[0]);
  let trend: "up" | "down" | "stable" = "stable";
  if (records.length >= 4) {
    const first = records.slice(0, Math.floor(records.length / 2)).reduce((s, r) => s + r.adherenceRate, 0) / Math.floor(records.length / 2);
    const second = records.slice(Math.floor(records.length / 2)).reduce((s, r) => s + r.adherenceRate, 0) / Math.ceil(records.length / 2);
    if (second > first + 0.1) trend = "up";
    else if (second < first - 0.1) trend = "down";
  }
  return { overall, recent, bestDay, worstDay, trend };
}

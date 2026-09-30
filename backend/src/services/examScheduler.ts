// examScheduler.ts — Exam proximity-based study planner.
//
// v2.8.0 — given an upcoming exam date, distributes topic weights and
// computes per-day study load so the user hits a target retention curve.
//
// Strategy:
// - For each topic with known exam, weight by (1 / daysToExam)
// - For days ≤ 3, force high-weight topics into the daily queue
// - For days > 14, spread topics evenly
// - Daily load capped at user-defined `dailyMinutes`
// - Per-topic sessions: short for high urgency, long for low urgency

import type { DiagnosticResult } from "./knowledgeDiagnostic.js";

export interface Exam {
  id: string;
  topicId: string;
  topicName: string;
  date: string;        // ISO date
  totalTopics: number; // total concepts in syllabus
  weight?: number;     // user override 0-1
}

export interface StudySession {
  date: string;        // YYYY-MM-DD
  topicId: string;
  topicName: string;
  durationMin: number;
  urgency: "critical" | "high" | "normal" | "low";
  cardsToReview: number;
  newCardsToLearn: number;
  reason: string;
}

export interface SchedulerConfig {
  dailyMinutes: number;
  /** Target retention on exam day, 0-1 */
  targetRetention: number;
  /** Skip diagnostic — start fresh with default params */
  skipDiagnostic?: boolean;
}

export interface DiagnosticMap {
  [topicId: string]: DiagnosticResult;
}

export function planStudy(
  exams: Exam[],
  diagnostics: DiagnosticMap,
  fromDate: Date = new Date(),
  cfg: SchedulerConfig = { dailyMinutes: 60, targetRetention: 0.9 },
): StudySession[] {
  const sessions: StudySession[] = [];
  if (exams.length === 0) return sessions;

  const sortedExams = [...exams].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Per exam, build a daily plan from today → exam day
  for (const exam of sortedExams) {
    const examDate = new Date(exam.date);
    const daysToExam = Math.max(1, Math.ceil(
      (examDate.getTime() - fromDate.getTime()) / (24 * 3600 * 1000)
    ));

    const diag = diagnostics[exam.topicId];
    // v2.38.8 — Math.max(1, NaN) es NaN, no 1. Con un diagnóstico a
    // medio construir —fsrsProfile sin desiredRetention— el
    // sessionsCount salía NaN y TODAS las sesiones del plan acababan
    // con duración NaN, sin error y sin un solo aviso. Un dato que no
    // existe se cambia por un valor por defecto, nunca se propaga.
    const knowledgeRatio = num(diag?.knowledgeRatio, 0);
    const desiredRetention = clamp(num(diag?.fsrsProfile?.desiredRetention, cfg.targetRetention), 0.7, 0.98);

    // Total sessions needed = totalTopics × (1 - knowledgeRatio) × urgency
    const urgent = daysToExam <= 3;
    const sessionsCount = Math.max(
      1,
      Math.ceil(
        exam.totalTopics *
          (1 - knowledgeRatio * 0.7) *  // know 70% if diag ratio is 1
          (urgent ? 1.2 : 1.0) *
          (1 + (1 - desiredRetention))
      )
    );

    // Daily load: distribute sessions across days, more on closer days
    const dailyDist = distributeAcrossDays(sessionsCount, daysToExam, urgent);

    for (let d = 0; d < daysToExam && d < dailyDist.length; d++) {
      const n = dailyDist[d];
      if (n === 0) continue;
      const date = new Date(fromDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().slice(0, 10);

      // v2.38.6: la cuota se calcula sobre el reparto total del periodo,
      // no sobre el máximo local. Con el cálculo anterior, dos exámenes
      // —uno a dos días y otro a cuarenta— daban los dos 60 min/día
      // porque ambos topaban el tope, y el plan no podía decir cuál
      // tenía prioridad.
      const totalSessions = num(dailyDist.reduce((a, b) => a + b, 0), 1);
      const share = shareOf(n, totalSessions);
      const durationMin = Math.max(
        n > 0 ? 5 : 0,
        Math.min(cfg.dailyMinutes, Math.round(cfg.dailyMinutes * share)),
      );
      const cardsToReview = Math.max(0, Math.ceil(n * (8 + 12 * (1 - knowledgeRatio))));
      const newCardsToLearn = Math.max(0, Math.ceil(n * (5 * (1 - knowledgeRatio))));
      const urgency = urgent ? (d === daysToExam - 1 ? "critical" : "high")
                    : d < 7 ? "normal" : "low";

      sessions.push({
        date: dateStr,
        topicId: exam.topicId,
        topicName: exam.topicName,
        durationMin,
        urgency,
        cardsToReview,
        newCardsToLearn,
        reason: buildReason(urgent, knowledgeRatio, daysToExam, d),
      });
    }
  }

  // v2.38.8 — el tope diario era por sesión, no por día.
  //
  // El bucle es por examen, y el tope se aplicaba dentro. Con dos
  // exámenes el mismo día —el caso normal en ineturnos— el usuario
  // acababa con 120 min programados con dailyMinutes: 60. El test de
  // carga lo vio al primer intento: 66 min en un día. El reparto se
  // hace después de juntar todo, que es donde se puede ver el día
  // completo, y si algo no cabe se dice en el motivo en vez de
  // repartirse en silencio.
  const byDay = new Map<string, StudySession[]>();
  for (const s of sessions) {
    const list = byDay.get(s.date) ?? [];
    list.push(s);
    byDay.set(s.date, list);
  }
  const out: StudySession[] = [];
  for (const [date, list] of byDay) {
    const before = list.reduce((a, s) => a + s.durationMin, 0);
    if (before <= cfg.dailyMinutes) {
      out.push(...list);
      continue;
    }
    const k = cfg.dailyMinutes / before;
    const short = before - cfg.dailyMinutes;
    // Cuenta corriente: el tope es del DÍA entero, no de cada sesión.
    // Con un presupuesto por sesión, la primera se llevaba el tope y la
    // segunda lo repetía, y el día acababa en 65 con 60 de tope.
    let left = cfg.dailyMinutes;
    list.forEach((s, i) => {
      // La prioridad se respeta: lo primero que hay en la lista es lo
      // más urgente, y ese no se recorta más de la mitad.
      const cut = i === 0 ? Math.max(0.5, k) : k;
      const dur = Math.max(0, Math.min(Math.round(s.durationMin * cut), left));
      left -= dur;
      out.push({
        ...s,
        durationMin: dur,
        reason:
          short > 0
            ? `${s.reason}. Se recortó ${short} min: no cabía todo el día.`
            : s.reason,
      });
    });
  }
  return out;
}

/**
 * Reparte N sesiones entre D días. La suma es exactamente N.
 *
 * v2.38.6 — esto estaba al revés para los exámenes lejanos.
 *
 * Los pesos crecían con 1.4^d, así que con 60 días por delante el
 * último día se llevaba casi todo: 5 minutos el primero y 60 el
 * último. Es justo lo contrario de lo que sirve. Con tiempo de sobra lo
 * que funciona es repartir desde el principio y bajar al final, que es
 * como serepasar un temario largo: varios repasos repartidos y un último
 * intento fuerte cerca del examen, no un día monstrous al final.
 *
 *   examen cercano (<= 3 días) → carga creciente, el esfuerzo se junta
 *   examen medio             → ladeo, leve
 *   examen lejano            → repartido desde el día uno, bajando al final
 *
 * Lo segundo que estaba mal: la duración se saturaba en dailyMinutes
 * para cualquier examen, así que el plan no distinguía entre uno
 * urgente y otro tranquilo. Ahora se limita al tope pero se escala con
 * la urgencia relativa.
 */
function distributeAcrossDays(n: number, days: number, urgent: boolean): number[] {
  const out = new Array(days).fill(0);
  if (n <= 0 || days <= 0) return out;
  const weights: number[] = [];
  for (let d = 0; d < days; d++) {
    const t = days === 1 ? 1 : d / (days - 1);
    if (urgent) {
      weights.push(1 + t * 3); // 1x → 4x: el esfuerzo se acumula
    } else {
      // Campana suave: sube al principio, baja al final, sin picos.
      weights.push(Math.exp(-Math.pow((t - 0.25) / 0.55, 2)));
    }
  }
  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  let assigned = 0;
  for (let d = 0; d < days; d++) {
    const share = Math.round((weights[d] / wsum) * n);
    out[d] = share;
    assigned += share;
  }
  out[days - 1] += n - assigned;
  return out;
}

/**
 * Cuánto de la sesión diaria se gasta un tema, antes de topar con el
 * tope. La urgencia relativa devuelve un multiplicador: un examen a dos
 * días tiene que comer más|Minuto que uno a cuarenta.
 */
function shareOf(n: number, peak: number): number {
  if (!(peak > 0)) return 0;
  return Math.max(0, Math.min(1, n / peak));
}

/** Un número usable, o el valor por defecto. Nunca NaN. */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function buildReason(urgent: boolean, knowledgeRatio: number, days: number, dayIdx: number): string {
  if (urgent && dayIdx === days - 1) return "Final review before exam";
  if (urgent) return `Crash review — ${days - dayIdx} day${days - dayIdx === 1 ? "" : "s"} left`;
  if (knowledgeRatio < 0.3) return "Fill knowledge gaps";
  if (knowledgeRatio > 0.7) return "Consolidate strong areas";
  return "Steady practice";
}

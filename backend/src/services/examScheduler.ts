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
    const knowledgeRatio = diag?.knowledgeRatio ?? 0;
    const desiredRetention = diag?.fsrsProfile.desiredRetention ?? cfg.targetRetention;

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

      const durationMin = Math.min(cfg.dailyMinutes, Math.ceil(cfg.dailyMinutes * (n / Math.max(...dailyDist))));
      const cardsToReview = Math.ceil(n * (8 + 12 * (1 - knowledgeRatio)));
      const newCardsToLearn = Math.ceil(n * (5 * (1 - knowledgeRatio)));
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

  return sessions;
}

/**
 * Distribute N items across D days with exponential weighting toward later days.
 * Sum equals N.
 */
function distributeAcrossDays(n: number, days: number, urgent: boolean): number[] {
  const out = new Array(days).fill(0);
  if (n <= 0) return out;
  // weights: if urgent, grow linearly; else grow exponentially
  const weights: number[] = [];
  for (let d = 0; d < days; d++) {
    if (urgent) {
      weights.push(1 + (d / Math.max(1, days - 1)) * 3); // 1x → 4x
    } else {
      weights.push(Math.pow(1.4, d)); // 1x → 1.4^D
    }
  }
  const wsum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0;
  for (let d = 0; d < days; d++) {
    const share = Math.round((weights[d] / wsum) * n);
    out[d] = share;
    assigned += share;
  }
  // Adjust last bucket for rounding
  out[days - 1] += (n - assigned);
  return out;
}

function buildReason(urgent: boolean, knowledgeRatio: number, days: number, dayIdx: number): string {
  if (urgent && dayIdx === days - 1) return "Final review before exam";
  if (urgent) return `Crash review — ${days - dayIdx} day${days - dayIdx === 1 ? "" : "s"} left`;
  if (knowledgeRatio < 0.3) return "Fill knowledge gaps";
  if (knowledgeRatio > 0.7) return "Consolidate strong areas";
  return "Steady practice";
}

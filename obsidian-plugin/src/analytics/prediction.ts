// Prediction: predicción de probabilidad de aprobación por asignatura
// y por examen, basada en FSRS + tiempo restante + dominio actual.
//
// Modelo (heurístico, validable, sin ML opaco):
//   - P(aprobado | subject, daysToExam)
//     = sigmoid(mastery - daysToExam * loadFactor)
//
//   donde:
//     mastery        ∈ [0, 1] (viene de metrics.averageMastery)
//     daysToExam     días hasta el examen
//     loadFactor     = 1 / (1 + avgStability)  → más estabilidad = menos carga
//
//   Ajustes:
//     - Si hay > overdueThreshold cards vencidas → penalizar
//     - Si dueThisWeek > 2 * dailyCap → penalizar (sobrecarga)

import { SubjectMetrics } from "./metrics";
import { ExamMatch } from "../types";

export interface PredictionInput {
  subject: string;
  metrics: SubjectMetrics;
  daysToExam: number;
  dailyCap: number;
}

export interface PredictionOutput {
  subject: string;
  probability: number; // 0-1
  level: "critical" | "risky" | "ok" | "good" | "excellent";
  daysToExam: number;
  loadScore: number; // 0-1, mayor = más saturado
  recommendations: string[];
}

export function predictPassProbability(input: PredictionInput): PredictionOutput {
  const { metrics, daysToExam, dailyCap } = input;
  const recs: string[] = [];

  // ─── Carga de trabajo normalizada ──────────────────────────────────
  // Ratio de carga = cards que vencen en 7 días / capacidad de 7 días
  const weeklyLoad = metrics.review;
  const weeklyCapacity = dailyCap * 7;
  const loadScore = weeklyCapacity > 0 ? Math.min(1, weeklyLoad / weeklyCapacity) : 1;
  if (loadScore > 0.8) {
    recs.push("⚠ Saturación alta: considera subir dailyCap o suspender nuevas tarjetas.");
  } else if (loadScore > 0.6) {
    recs.push("Carga elevada. Revisa que dailyCap esté bien calibrado.");
  }

  // ─── Penalización por estado "new" o "learning" sin progreso ──────
  const newRatio = metrics.total > 0 ? (metrics.new + metrics.learning) / metrics.total : 0;
  if (newRatio > 0.5 && daysToExam < 30) {
    recs.push("Demasiadas tarjetas nuevas. Aplaza las que no entran al examen.");
  }

  // ─── Penalización por tasa de lapsos ───────────────────────────────
  if (metrics.lapseRate > 0.2) {
    recs.push("Tasa de lapsos >20%: las tarjetas pueden ser demasiado difíciles o estar mal planteadas.");
  }

  // ─── Modelo: sigmoid(mastery - penalización por tiempo/carga) ─────
  // daysToExam corta: penaliza menos. daysToExam larga sin mastery: penaliza más.
  const timePressure = daysToExam > 0 ? 1 / (1 + daysToExam / 14) : 1;
  // Penalización: combinación de carga y "new ratio"
  const penalty = 0.5 * loadScore + 0.3 * newRatio + 0.2 * (1 - metrics.retention30d);
  // Signal: mastery (0-1) amplificado por tiempo disponible
  const signal = metrics.mastery * 0.7 + (1 - timePressure) * 0.3;
  const raw = signal - penalty * 0.5;
  const probability = sigmoid(raw * 3); // amplificar el rango

  // Nivel cualitativo
  let level: PredictionOutput["level"];
  if (probability < 0.35) level = "critical";
  else if (probability < 0.55) level = "risky";
  else if (probability < 0.7) level = "ok";
  else if (probability < 0.85) level = "good";
  else level = "excellent";

  if (level === "critical") {
    recs.unshift("🚨 CRÍTICO: probabilidad < 35%. Revisa el plan: priorizar repasos, aplazar nuevas, considerar repaso intensivo en grupo.");
  } else if (level === "risky") {
    recs.unshift("⚠ Arriesgado: probabilidad < 55%. Aún hay tiempo si ajustas el ritmo.");
  } else if (level === "excellent") {
    recs.unshift("✅ Dominio alto. Mantén el ritmo, no acumules repasos.");
  }

  return {
    subject: input.subject,
    probability,
    level,
    daysToExam,
    loadScore,
    recommendations: recs,
  };
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function predictAll(
  bySubject: SubjectMetrics[],
  exams: ExamMatch[],
  dailyCap: number,
  now: Date = new Date()
): PredictionOutput[] {
  const out: PredictionOutput[] = [];
  for (const m of bySubject) {
    // Encontrar el examen más cercano para esta materia
    const subjExams = exams.filter((e) => e.subject === m.subject || e.subject === "general");
    let daysToExam = 60; // default: 2 meses
    if (subjExams.length > 0) {
      const sorted = [...subjExams].sort((a, b) => a.date.localeCompare(b.date));
      const next = sorted[0];
      const t = new Date(next.date).getTime();
      const diff = Math.max(0, t - now.getTime());
      daysToExam = Math.floor(diff / (24 * 3600 * 1000));
    }
    out.push(predictPassProbability({ subject: m.subject, metrics: m, daysToExam, dailyCap }));
  }
  // Ordenar por probabilidad ascendente (peores primero → más atención)
  return out.sort((a, b) => a.probability - b.probability);
}

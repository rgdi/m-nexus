// LevelPromoter: monitoriza la estabilidad FSRS del alumno en su nivel actual.
// Cuando el ratio de tarjetas estables supera el umbral Y la estabilidad media
// supera el mínimo, sugiere subir al siguiente nivel.

import { AcademicLevel, MNexusSettings } from "../types";
import { FSRSCardSnapshot } from "../analytics/metrics";
import { nextLevel, getLevelInfo } from "./taxonomy";
import { Logger } from "../utils/logger";

export interface PromotionSignal {
  currentLevel: AcademicLevel;
  suggestedLevel: AcademicLevel | null;
  /** Ratio de tarjetas en review con stability >= minStability. */
  stableRatio: number;
  /** Estabilidad media del nivel actual. */
  avgStability: number;
  /** Número de tarjetas en review. */
  reviewCount: number;
  /** Mensaje para el usuario. */
  message: string;
  /** Si la promoción es recomendada (cumple umbrales). */
  recommended: boolean;
}

export class LevelPromoter {
  constructor(private settings: MNexusSettings, private log: Logger) {}

  /**
   * Evalúa si el alumno está listo para subir de nivel.
   * Recibe las tarjetas de la materia asociada al nivel.
   */
  evaluate(cards: FSRSCardSnapshot[]): PromotionSignal {
    const current = this.settings.userLevel;
    const next = nextLevel(current);
    const inReview = cards.filter((c) => c.state === "review");
    const total = inReview.length;
    if (total === 0) {
      return {
        currentLevel: current,
        suggestedLevel: null,
        stableRatio: 0,
        avgStability: 0,
        reviewCount: 0,
        message: "Sin tarjetas en estado de repaso. Crea y madura algunas antes de subir de nivel.",
        recommended: false,
      };
    }
    const minStab = this.settings.levelPromotionStability;
    const stable = inReview.filter((c) => c.stability >= minStab);
    const stableRatio = stable.length / total;
    const avgStability = inReview.reduce((s, c) => s + c.stability, 0) / total;
    const meetsStability = avgStability >= minStab;
    const meetsRatio = stableRatio >= this.settings.levelPromotionMinRatio;
    const recommended = meetsStability && meetsRatio && next !== null;
    const currentInfo = getLevelInfo(current);
    const nextInfo = next ? getLevelInfo(next) : null;
    let message: string;
    if (recommended && nextInfo) {
      message = `🎓 ¡Listo para subir a ${nextInfo.label}! Has dominado el ${currentInfo.label}: ${Math.round(stableRatio * 100)}% de tarjetas estables (estab. media ${avgStability.toFixed(1)} días).`;
    } else if (meetsRatio && !meetsStability) {
      message = `Buen progreso: ${Math.round(stableRatio * 100)}% estables. Sigue repasando para subir la estabilidad media (actual: ${avgStability.toFixed(1)}d, objetivo: ${minStab}d).`;
    } else if (meetsStability && !meetsRatio) {
      message = `Estabilidad media buena (${avgStability.toFixed(1)}d), pero solo ${Math.round(stableRatio * 100)}% están consolidadas. Refuerza los temas con más lapsos.`;
    } else {
      message = `Vas por ${Math.round(stableRatio * 100)}% estables / ${avgStability.toFixed(1)}d de media. Objetivo: ${Math.round(this.settings.levelPromotionMinRatio * 100)}% y ${minStab}d.`;
    }
    return {
      currentLevel: current,
      suggestedLevel: recommended ? next : null,
      stableRatio,
      avgStability,
      reviewCount: total,
      message,
      recommended,
    };
  }
}

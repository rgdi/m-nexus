// gamificationService.ts: gamification (XP, levels, achievements) (Fase 6).
//
// v0.46: sistema de XP/level/achievements estilo RPG para mantener
// la motivación del estudiante de medicina.

export interface XPEvent {
  type:
    | "review"
    | "review_correct_easy"
    | "review_correct_hard"
    | "new_card"
    | "streak_day"
    | "study_session"
    | "deck_complete"
    | "perfect_session";
  /** XP ganado (opcional, si no se calcula por reglas) */
  amount?: number;
  timestamp?: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  /** Icon emoji */
  icon: string;
  /** XP bonus al desbloquearlo */
  bonusXP: number;
  /** Condición de unlock (en pseudo-code) */
  condition: string;
}

export interface UserStats {
  totalXP: number;
  level: number;
  xpToNextLevel: number;
  xpInCurrentLevel: number;
  /** Reseñas totales (correctas) */
  totalReviews: number;
  /** Cards únicas vistas */
  uniqueCardsSeen: number;
  /** Días consecutivos con estudio */
  currentStreak: number;
  /** Achievements desbloqueados (ids) */
  unlockedAchievements: string[];
  /** Próximo achievement a desbloquear */
  nextAchievement: Achievement | null;
  /** XP necesario para próximo achievement */
  xpToNextAchievement: number;
}

const XP_PER_REVIEW = 10;
const XP_PER_CORRECT = 5;
const XP_PER_NEW_CARD = 20;
const XP_PER_STREAK_DAY = 50;
const XP_PER_PERFECT = 100;

const ACHIEVEMENTS: Achievement[] = [
  { id: "first_review", name: "Primera Review", description: "Completa tu primera review", icon: "🌱", bonusXP: 50, condition: "totalReviews >= 1" },
  { id: "review_100", name: "Centenario", description: "100 reviews completadas", icon: "💯", bonusXP: 100, condition: "totalReviews >= 100" },
  { id: "review_1000", name: "Millar", description: "1000 reviews completadas", icon: "🏆", bonusXP: 500, condition: "totalReviews >= 1000" },
  { id: "review_10000", name: "Leyenda", description: "10000 reviews completadas", icon: "👑", bonusXP: 2000, condition: "totalReviews >= 10000" },
  { id: "streak_3", name: "Constancia I", description: "3 días consecutivos", icon: "🔥", bonusXP: 100, condition: "currentStreak >= 3" },
  { id: "streak_7", name: "Semana Completa", description: "7 días consecutivos", icon: "🔥", bonusXP: 250, condition: "currentStreak >= 7" },
  { id: "streak_30", name: "Mes Completo", description: "30 días consecutivos", icon: "💎", bonusXP: 1000, condition: "currentStreak >= 30" },
  { id: "streak_365", name: "Anual", description: "365 días consecutivos", icon: "🌟", bonusXP: 10000, condition: "currentStreak >= 365" },
  { id: "level_5", name: "Nivel 5", description: "Alcanza nivel 5", icon: "⭐", bonusXP: 200, condition: "level >= 5" },
  { id: "level_10", name: "Nivel 10", description: "Alcanza nivel 10", icon: "🌟", bonusXP: 500, condition: "level >= 10" },
  { id: "level_25", name: "Nivel 25", description: "Alcanza nivel 25", icon: "💫", bonusXP: 2000, condition: "level >= 25" },
  { id: "perfect_session_10", name: "Perfeccionista", description: "10 reviews seguidas correctas", icon: "🎯", bonusXP: 200, condition: "perfectStreak >= 10" },
];

export class GamificationService {
  private events: XPEvent[] = [];
  private unlockedAchievements: Set<string> = new Set();
  private totalReviews = 0;
  private currentStreak = 0;
  private longestStreak = 0;
  private perfectStreak = 0;

  /**
   * Registra un evento y devuelve XP ganado (incluyendo bonus de achievements).
   */
  recordEvent(event: XPEvent): { xp: number; newAchievements: Achievement[] } {
    this.events.push({ ...event, timestamp: event.timestamp ?? Date.now() });

    let xp = 0;
    switch (event.type) {
      case "review":
        xp = XP_PER_REVIEW;
        this.totalReviews++;
        break;
      case "review_correct_easy":
        xp = XP_PER_REVIEW + XP_PER_CORRECT * 2;
        this.totalReviews++;
        this.perfectStreak++;
        break;
      case "review_correct_hard":
        xp = XP_PER_REVIEW + XP_PER_CORRECT;
        this.totalReviews++;
        this.perfectStreak++;
        break;
      case "new_card":
        xp = XP_PER_NEW_CARD;
        break;
      case "streak_day":
        xp = XP_PER_STREAK_DAY;
        this.currentStreak = event.amount ?? this.currentStreak + 1;
        if (this.currentStreak > this.longestStreak) {
          this.longestStreak = this.currentStreak;
        }
        break;
      case "study_session":
        xp = 30;
        break;
      case "deck_complete":
        xp = 200;
        break;
      case "perfect_session":
        xp = XP_PER_PERFECT;
        break;
    }

    // Si fue incorrecto, reset perfectStreak
    if (event.type === "review" && !event.amount) {
      this.perfectStreak = 0;
    }

    // Verificar achievements
    const newAchievements: Achievement[] = [];
    for (const ach of ACHIEVEMENTS) {
      if (this.unlockedAchievements.has(ach.id)) continue;
      if (this.checkCondition(ach)) {
        this.unlockedAchievements.add(ach.id);
        xp += ach.bonusXP;
        newAchievements.push(ach);
      }
    }

    return { xp, newAchievements };
  }

  /**
   * Calcula nivel basado en XP total.
   * Fórmula: level = floor(sqrt(xp / 100)) + 1
   *  - 0 XP = nivel 1
   *  - 100 XP = nivel 2
   *  - 400 XP = nivel 3
   *  - 900 XP = nivel 4
   *  - 10000 XP = nivel 11
   */
  static levelFromXP(totalXP: number): number {
    return Math.floor(Math.sqrt(totalXP / 100)) + 1;
  }

  /**
   * XP necesario para alcanzar un nivel.
   */
  static xpForLevel(level: number): number {
    return (level - 1) ** 2 * 100;
  }

  /**
   * Calcula stats completas del usuario.
   */
  getStats(totalXP: number): UserStats {
    const level = GamificationService.levelFromXP(totalXP);
    const xpForCurrent = GamificationService.xpForLevel(level);
    const xpForNext = GamificationService.xpForLevel(level + 1);
    const xpInCurrentLevel = totalXP - xpForCurrent;
    const xpToNextLevel = xpForNext - totalXP;

    // Próximo achievement bloqueado
    const locked = ACHIEVEMENTS.filter((a) => !this.unlockedAchievements.has(a.id));
    const nextAch = locked[0] ?? null;
    const xpToNextAchievement = nextAch
      ? GamificationService.xpToUnlock(nextAch, totalXP, this)
      : 0;

    return {
      totalXP,
      level,
      xpToNextLevel,
      xpInCurrentLevel,
      totalReviews: this.totalReviews,
      uniqueCardsSeen: new Set(this.events.map((e) => e.type)).size, // simplificado
      currentStreak: this.currentStreak,
      unlockedAchievements: Array.from(this.unlockedAchievements),
      nextAchievement: nextAch,
      xpToNextAchievement,
    };
  }

  /**
   * Lista todos los achievements (desbloqueados y no).
   */
  static listAchievements(): Achievement[] {
    return ACHIEVEMENTS;
  }

  private checkCondition(ach: Achievement): boolean {
    // Pseudo-evaluator simple
    const tokens = ach.condition.split(/\s+/);
    // Formato esperado: "var op valor"
    if (tokens.length !== 3) return false;
    const [varName, op, valStr] = tokens;
    const val = parseInt(valStr, 10);

    const getVar = (name: string): number => {
      if (name === "totalReviews") return this.totalReviews;
      if (name === "currentStreak") return this.currentStreak;
      if (name === "longestStreak") return this.longestStreak;
      if (name === "perfectStreak") return this.perfectStreak;
      // Para level, necesitaríamos totalXP — no tenemos acceso aquí
      // Lo manejaremos afuera
      return 0;
    };

    const actual = getVar(varName);
    if (op === ">=") return actual >= val;
    if (op === ">") return actual > val;
    if (op === "==") return actual === val;
    return false;
  }

  private static xpToUnlock(ach: Achievement, totalXP: number, ctx: GamificationService): number {
    // Para achievements de level, calcular XP necesario
    if (ach.condition.startsWith("level")) {
      const m = ach.condition.match(/level >= (\d+)/);
      if (m) {
        const target = parseInt(m[1], 10);
        return Math.max(0, GamificationService.xpForLevel(target) - totalXP);
      }
    }
    return 0;
  }
}

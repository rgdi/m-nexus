// v0.21: ScheduleMatcher — detecta a qué clase/subject corresponde una grabación
// basándose en el horario configurado del usuario.
//
// Lógica:
//   1. El usuario configura su horario semanal (ClassSchedule[]).
//   2. Cuando llega una grabación (timestamp + duración), el matcher busca
//      qué clase estaba en curso en ese momento.
//   3. Devuelve un match con confidence 0..1.
//   4. Si confidence < threshold (default 0.5), devuelve null → "sin marcar".

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=domingo

export interface ClassSchedule {
  /** Nombre de la clase (e.g., "Anatomía II"). */
  subject: string;
  /** Día de la semana. */
  dayOfWeek: DayOfWeek;
  /** Hora de inicio en minutos desde medianoche (0-1439). */
  startMinute: number;
  /** Duración en minutos. */
  durationMinutes: number;
  /** Aula o ubicación (opcional). */
  location?: string;
  /** Color para UI (opcional). */
  color?: string;
  /** Notas adicionales. */
  notes?: string;
}

export interface ScheduleMatch {
  /** La clase que mejor coincide. */
  schedule: ClassSchedule;
  /** Confianza 0..1 (1 = match exacto). */
  confidence: number;
  /** Por qué se eligió (para UI). */
  reason: string;
  /** Inicio y fin estimados en ms. */
  startTimeMs: number;
  endTimeMs: number;
}

export interface MatchOptions {
  /** Umbral mínimo de confianza. Default 0.5. */
  minConfidence: number;
  /** Margen de tolerancia (minutos) antes/después de la clase. Default 30. */
  toleranceMinutes: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  minConfidence: 0.5,
  toleranceMinutes: 60, // 1 hora de tolerancia para llegar tarde a clase
};

export class ScheduleMatcher {
  private schedules: ClassSchedule[];
  private options: MatchOptions;

  constructor(schedules: ClassSchedule[], options: Partial<MatchOptions> = {}) {
    this.schedules = schedules;
    this.options = { ...DEFAULT_MATCH_OPTIONS, ...options };
  }

  /**
   * Busca la mejor clase para un momento dado.
   * @param recordingStartMs Timestamp de inicio de la grabación.
   * @param recordingDurationMs Duración de la grabación.
   * @returns El mejor match o null si ninguno supera el threshold.
   */
  match(recordingStartMs: number, recordingDurationMs: number): ScheduleMatch | null {
    if (!Number.isFinite(recordingStartMs) || !Number.isFinite(recordingDurationMs)) {
      return null;
    }
    if (recordingDurationMs < 0) return null;
    const recStart = recordingStartMs;
    const recEnd = recordingStartMs + recordingDurationMs;
    const recStartDate = new Date(recStart);
    const recDay = recStartDate.getDay() as DayOfWeek;
    const recStartMin = recStartDate.getHours() * 60 + recStartDate.getMinutes();
    const recDurationMin = recordingDurationMs / 60_000;

    let best: ScheduleMatch | null = null;

    for (const sched of this.schedules) {
      if (sched.dayOfWeek !== recDay) continue;

      const classStartMin = sched.startMinute;
      const classEndMin = classStartMin + sched.durationMinutes;
      const classStartMs = this.getClassTimeMs(recStartDate, classStartMin);
      const classEndMs = classStartMs + sched.durationMinutes * 60_000;

      // Calcular overlap entre grabación y clase
      const overlapStart = Math.max(recStart, classStartMs);
      const overlapEnd = Math.min(recEnd, classEndMs);
      const overlapMs = Math.max(0, overlapEnd - overlapStart);
      const overlapMin = overlapMs / 60_000;

      // ¿La grabación cubre el inicio de la clase? (peso 0.5)
      const startDiff = Math.abs(recStart - classStartMs) / 60_000;
      const startScore = Math.max(0, 1 - startDiff / this.options.toleranceMinutes);

      // ¿Qué porcentaje de la clase está cubierta? (peso 0.3)
      const coverageScore = overlapMin / sched.durationMinutes;

      // ¿Qué porcentaje de la grabación es de esta clase? (peso 0.2)
      const recCoverageScore = overlapMin / recDurationMin;

      const confidence = startScore * 0.5 + coverageScore * 0.3 + recCoverageScore * 0.2;

      if (best === null || confidence > best.confidence) {
        best = {
          schedule: sched,
          confidence,
          reason: this.explain(startScore, coverageScore, recCoverageScore),
          startTimeMs: classStartMs,
          endTimeMs: classEndMs,
        };
      }
    }

    if (best && best.confidence >= this.options.minConfidence) {
      return best;
    }
    return null;
  }

  /**
   * Devuelve todas las clases que estaban en curso en el momento (no solo la mejor).
   */
  matchAll(recordingStartMs: number, recordingDurationMs: number): ScheduleMatch[] {
    const recStart = recordingStartMs;
    const recEnd = recordingStartMs + recordingDurationMs;
    const recStartDate = new Date(recStart);
    const recDay = recStartDate.getDay() as DayOfWeek;

    const matches: ScheduleMatch[] = [];

    for (const sched of this.schedules) {
      if (sched.dayOfWeek !== recDay) continue;

      const classStartMs = this.getClassTimeMs(recStartDate, sched.startMinute);
      const classEndMs = classStartMs + sched.durationMinutes * 60_000;

      const overlapStart = Math.max(recStart, classStartMs);
      const overlapEnd = Math.min(recEnd, classEndMs);
      const overlapMs = Math.max(0, overlapEnd - overlapStart);
      if (overlapMs === 0) continue;

      const overlapMin = overlapMs / 60_000;
      const startDiff = Math.abs(recStart - classStartMs) / 60_000;
      const startScore = Math.max(0, 1 - startDiff / this.options.toleranceMinutes);
      const coverageScore = overlapMin / sched.durationMinutes;
      const recDurationMin = Math.max(0.001, recordingDurationMs / 60_000); // evitar NaN
      const recCoverageScore = overlapMin / recDurationMin;
      const confidence = startScore * 0.5 + coverageScore * 0.3 + recCoverageScore * 0.2;
      if (!Number.isFinite(confidence)) continue; // skip NaN/Infinity

      matches.push({
        schedule: sched,
        confidence,
        reason: this.explain(startScore, coverageScore, recCoverageScore),
        startTimeMs: classStartMs,
        endTimeMs: classEndMs,
      });
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Devuelve las próximas N clases a partir de un momento.
   */
  getUpcoming(fromMs: number = Date.now(), n = 5): Array<{ schedule: ClassSchedule; startsAtMs: number; endsAtMs: number }> {
    const from = new Date(fromMs);
    const results: Array<{ schedule: ClassSchedule; startsAtMs: number; endsAtMs: number }> = [];

    // Buscar en los próximos 7 días
    for (let dayOffset = 0; dayOffset < 7 && results.length < n; dayOffset++) {
      const day = new Date(from);
      day.setDate(day.getDate() + dayOffset);
      const dayOfWeek = day.getDay() as DayOfWeek;

      const daySchedules = this.schedules.filter((s) => s.dayOfWeek === dayOfWeek);
      for (const sched of daySchedules) {
        const startMs = this.getClassTimeMs(day, sched.startMinute);
        if (startMs < fromMs) continue;
        const endMs = startMs + sched.durationMinutes * 60_000;
        results.push({ schedule: sched, startsAtMs: startMs, endsAtMs: endMs });
        if (results.length >= n) break;
      }
    }

    return results.slice(0, n).sort((a, b) => a.startsAtMs - b.startsAtMs);
  }

  private getClassTimeMs(date: Date, startMinute: number): number {
    const d = new Date(date);
    d.setHours(Math.floor(startMinute / 60), startMinute % 60, 0, 0);
    return d.getTime();
  }

  private explain(startScore: number, coverageScore: number, recCoverageScore: number): string {
    const parts: string[] = [];
    if (startScore > 0.8) parts.push("inicio coincide");
    else if (startScore > 0.4) parts.push("inicio aproximado");
    else parts.push("inicio lejano");

    if (coverageScore > 0.8) parts.push("cubre casi toda la clase");
    else if (coverageScore > 0.4) parts.push("cubre parte de la clase");
    else parts.push("cubre poco de la clase");

    if (recCoverageScore > 0.8) parts.push("la grabación es mayormente esta clase");
    else if (recCoverageScore > 0.4) parts.push("la grabación incluye otras cosas");
    return parts.join(", ");
  }
}

/** Utilidades para parsear/serializar schedules. */
export const DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function formatSchedule(sched: ClassSchedule): string {
  const startH = Math.floor(sched.startMinute / 60);
  const startM = sched.startMinute % 60;
  const endMin = sched.startMinute + sched.durationMinutes;
  const endH = Math.floor(endMin / 60);
  const endM = endMin % 60;
  const dayName = DAY_NAMES_ES[sched.dayOfWeek].slice(0, 3);
  const loc = sched.location ? ` @ ${sched.location}` : "";
  return `${dayName} ${pad(startH)}:${pad(startM)}-${pad(endH)}:${pad(endM)} | ${sched.subject}${loc}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

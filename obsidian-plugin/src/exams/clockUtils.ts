// v0.18: Utilidades para manejo robusto de tiempo con detección de clock skew.
//
// El problema: si el usuario cambia la hora del sistema (viaje, DST, ajuste manual),
// las comparaciones de fechas basadas en strings "YYYY-MM-DD" se rompen porque
// la "fecha de hoy" salta arbitrariamente.
//
// Solución:
//   1. Usar timestamps absolutos (ms) internamente como fuente de verdad.
//   2. Convertir a fecha solo cuando se necesita (display, comparaciones de día).
//   3. Detectar clock skew: si el timestamp "ahora" salta >2h respecto al último
//      registrado, marcar como sospechoso y no romper la racha por el cambio.

/** Diferencia máxima (en ms) que consideramos "normal" entre dos ticks.
 *  Si el gap es mayor, asumimos clock skew. 2 horas = 7200000 ms. */
export const CLOCK_SKEW_THRESHOLD_MS = 2 * 3600 * 1000;

/** Resultado de una operación con tiempo. */
export interface TimeOperation<T> {
  result: T;
  /** Si se detectó clock skew, en qué dirección. */
  clockSkew: "forward" | "backward" | null;
  /** Cuánto se desvió (en ms). */
  skewAmount: number;
}

/** Devuelve la fecha (YYYY-MM-DD) en zona local para un timestamp. */
export function dateString(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Devuelve la fecha (YYYY-MM-DD) en zona local para "ahora". */
export function today(): string {
  return dateString(Date.now());
}

/** Diferencia en días entre dos fechas (YYYY-MM-DD), considerando solo la fecha (sin hora). */
export function dayDiff(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map((n) => parseInt(n, 10));
  const [ty, tm, td] = to.split("-").map((n) => parseInt(n, 10));
  const f = new Date(fy, fm - 1, fd);
  const t = new Date(ty, tm - 1, td);
  return Math.round((t.getTime() - f.getTime()) / 86_400_000);
}

/** Detecta si dos timestamps tienen clock skew. */
export function detectClockSkew(
  previousTimestamp: number | null | undefined,
  currentTimestamp: number,
  threshold: number = CLOCK_SKEW_THRESHOLD_MS
): { skewed: boolean; direction: "forward" | "backward" | null; amount: number } {
  // v0.18: tratar undefined igual que null (no hay timestamp previo)
  if (previousTimestamp === null || previousTimestamp === undefined) {
    return { skewed: false, direction: null, amount: 0 };
  }
  const diff = currentTimestamp - previousTimestamp;
  // Si diff no es número (NaN), no detectar skew
  if (Number.isNaN(diff)) {
    return { skewed: false, direction: null, amount: 0 };
  }
  const absDiff = Math.abs(diff);
  if (absDiff <= threshold) {
    return { skewed: false, direction: null, amount: absDiff };
  }
  return {
    skewed: true,
    direction: diff > 0 ? "forward" : "backward",
    amount: absDiff,
  };
}

/** Helper: día actual parseado a Date (local midnight). */
export function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Helper: parsea YYYY-MM-DD a Date (local midnight). */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

/** Formatea un Date a YYYY-MM-DD local. */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Wrapper de `now()` que detecta clock skew. */
export class ClockSkewDetector {
  private lastTick: number | null = null;
  private threshold: number;
  /** Eventos de skew detectados (para logging/UI). */
  public events: Array<{ at: number; direction: "forward" | "backward"; amount: number }> = [];

  constructor(threshold: number = CLOCK_SKEW_THRESHOLD_MS) {
    this.threshold = threshold;
  }

  /** Llama en cada tick. Devuelve info sobre skew si se detectó. */
  tick(now: number = Date.now()): { skewed: boolean; direction: "forward" | "backward" | null; amount: number } {
    const result = detectClockSkew(this.lastTick, now, this.threshold);
    this.lastTick = now;
    if (result.skewed) {
      this.events.push({ at: now, direction: result.direction!, amount: result.amount });
    }
    return result;
  }

  reset(): void {
    this.lastTick = null;
    this.events = [];
  }

  hasSkew(): boolean {
    return this.events.length > 0;
  }
}

/** Mensaje de felicitación por milestone de racha. */
export function getMilestoneMessage(milestone: number, streak: number): string {
  const messages: Record<number, string> = {
    3: "🔥 ¡3 días seguidos! Estás creando el hábito.",
    7: "🔥🔥 ¡Una semana entera! Increíble constancia.",
    14: "💪 ¡2 semanas! Tu cerebro te lo agradecerá en el examen.",
    30: "🏆 ¡UN MES! Eres imparable. Sigue así.",
    100: "🚀 ¡100 DÍAS! Leyenda. Tus apuntes están a salvo.",
    365: "👑 ¡UN AÑO! Eres un maestro de la constancia.",
  };
  return messages[milestone] ?? `🎉 ¡${milestone} días de racha! Llevas ${streak} días estudiando.`;
}

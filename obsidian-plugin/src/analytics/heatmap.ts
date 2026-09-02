// Heatmap: agregación de actividad diaria estilo GitHub.
// Input: lista de eventos (review, new card, study session).
// Output: matriz [fecha, count] para los últimos N días.

export type ActivityKind = "review" | "new-card" | "study" | "sync" | "backup" | "ocr";

export interface ActivityEvent {
  date: string; // ISO
  kind: ActivityKind;
  /** Métrica: minutos estudiados, # cards repasadas, etc. */
  weight: number;
}

export interface HeatmapDay {
  date: string; // YYYY-MM-DD
  count: number;
  byKind: Record<ActivityKind, number>;
}

export interface HeatmapData {
  days: HeatmapDay[];
  max: number;
  total: number;
  streak: number;
  /** Días activos en los últimos 30. */
  activeLast30: number;
}

export function buildHeatmap(events: ActivityEvent[], daysBack = 365): HeatmapData {
  const map = new Map<string, HeatmapDay>();
  const today = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    // Usar local time (no UTC) para evitar desfases por zona horaria.
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    map.set(key, {
      date: key,
      count: 0,
      byKind: { review: 0, "new-card": 0, study: 0, sync: 0, backup: 0, ocr: 0 },
    });
  }
  for (const e of events) {
    const day = e.date.slice(0, 10);
    const cell = map.get(day);
    if (!cell) continue;
    cell.count += e.weight;
    cell.byKind[e.kind] = (cell.byKind[e.kind] ?? 0) + e.weight;
  }
  const days = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);

  // Streak actual: contar días consecutivos hacia atrás con count > 0
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) streak++;
    else break;
  }

  const activeLast30 = days.slice(-30).filter((d) => d.count > 0).length;

  return { days, max, total, streak, activeLast30 };
}

/** Devuelve un color CSS (verde GitHub-like) según intensidad 0-1. */
export function heatmapColor(intensity: number): string {
  if (intensity <= 0) return "var(--background-secondary)";
  if (intensity < 0.25) return "rgba(63, 185, 80, 0.25)";
  if (intensity < 0.5) return "rgba(63, 185, 80, 0.5)";
  if (intensity < 0.75) return "rgba(63, 185, 80, 0.75)";
  return "rgba(63, 185, 80, 1)";
}

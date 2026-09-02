// Load forecast: predicción de carga diaria de repasos para los próximos N días.
// Combina:
//   1. Cards que ya están en cola y vencen pronto
//   2. Proyección FSRS: para cada card, calcular cuándo vence y agregarlo
//   3. Cap del usuario (dailyCap): avisa si se va a saturar

import { FSRSCardSnapshot } from "./metrics";

export interface ForecastDay {
  date: string;
  count: number;
  /** Por encima del cap, en cuántas unidades. */
  overflow: number;
  /** Carga relativa: 0 = vacío, 1 = al cap, >1 = saturado. */
  loadRatio: number;
}

export interface Forecast {
  days: ForecastDay[];
  peakLoad: number; // día más cargado
  peakDate: string;
  avgLoad: number;
  saturatedDays: number; // días con loadRatio > 1
}

export function forecastLoad(
  cards: FSRSCardSnapshot[],
  options: {
    daysAhead?: number;
    dailyCap?: number;
    /** ¿Incluir también cards en estado "new"? */
    includeNew?: boolean;
    /** Velocidad de "nuevas" cards por día (default = dailyCap/4). */
    newPerDay?: number;
  } = {}
): Forecast {
  const { daysAhead = 30, dailyCap = 20, includeNew = true, newPerDay = Math.max(1, Math.floor(dailyCap / 4)) } = options;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = new Map<string, number>();
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  // Sumar las due dates que caen dentro del horizonte
  for (const c of cards) {
    if (!includeNew && c.state === "new") continue;
    if (c.state === "new") continue; // las "new" se modelan con newPerDay
    const dueKey = c.dueDate.slice(0, 10);
    if (buckets.has(dueKey)) {
      buckets.set(dueKey, (buckets.get(dueKey) ?? 0) + 1);
    }
  }
  // Añadir "nuevas" tarjetas a un ritmo constante
  const newCount = cards.filter((c) => c.state === "new").length;
  for (let i = 0; i < Math.min(daysAhead, Math.ceil(newCount / Math.max(1, newPerDay))); i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + Math.min(newPerDay, newCount - i * newPerDay));
    }
  }
  const days: ForecastDay[] = Array.from(buckets.entries())
    .map(([date, count]) => ({
      date,
      count,
      overflow: Math.max(0, count - dailyCap),
      loadRatio: dailyCap > 0 ? count / dailyCap : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const peak = days.reduce((max, d) => (d.count > max.count ? d : max), days[0]);
  const avgLoad = days.reduce((s, d) => s + d.count, 0) / Math.max(1, days.length);
  const saturatedDays = days.filter((d) => d.loadRatio > 1).length;
  return {
    days,
    peakLoad: peak?.count ?? 0,
    peakDate: peak?.date ?? "",
    avgLoad,
    saturatedDays,
  };
}

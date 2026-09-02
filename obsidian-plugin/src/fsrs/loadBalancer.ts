// Load balancing: si un día acumula más de `softCap` tarjetas (o más de `dailyReviewCap`),
// redistribuye las menos prioritarias hacia los días colindantes.
// Reglas:
//   1. Mantener las tarjetas High priority donde están.
//   2. Mover Medium/Low hacia días con hueco, respetando la retención objetivo.
//   3. Si tras mover seguimos por encima del tope duro, marcar overflow=true y avisar.

import { DailyLoad, FlashcardDraft, PriorityLevel } from "../types";

const DAY_MS = 24 * 3600 * 1000;

export interface RebalanceInput {
  /** Tarjetas con su dueDate, prioridad y opcional FSRS para acortar/estirar. */
  cards: {
    card: FlashcardDraft;
    priority: PriorityLevel;
    stability?: number;
  }[];
  today: Date;
  daysWindow: number; // ej. 14
  dailyReviewCap: number;
  softCap: number;
}

export interface RebalanceOutput {
  /** Mapa yyyy-mm-dd → lista de tarjetas asignadas. */
  schedule: Map<string, FlashcardDraft[]>;
  /** Carga diaria resultante. */
  loads: DailyLoad[];
  overflow: boolean;
  movedCount: number;
}

export function rebalance(input: RebalanceInput): RebalanceOutput {
  const { cards, today, daysWindow, dailyReviewCap, softCap } = input;
  // Edge case: si daysWindow <= 0, tratar como 1 día (hoy)
  const safeDaysWindow = Math.max(1, daysWindow);
  const horizonEnd = new Date(today.getTime() + safeDaysWindow * DAY_MS);
  const buckets = new Map<string, FlashcardDraft[]>();
  const overflowTags = new Map<string, number>();

  // 1) Inicializar buckets por día del horizonte (incluyendo el último día)
  for (let i = 0; i < safeDaysWindow; i++) {
    const d = new Date(today.getTime() + i * DAY_MS);
    buckets.set(toKey(d), []);
  }
  const lastBucketKey = toKey(new Date(today.getTime() + (safeDaysWindow - 1) * DAY_MS));

  // 2) Colocar las High: si desbordan el cap del día, se mueven al siguiente
  //    (la regla anterior era "High no se mueve" pero eso rompe el tope duro)
  const high = cards.filter((c) => c.priority === "High");
  const rest = cards.filter((c) => c.priority !== "High");
  for (const c of high) {
    const dueKey = toKey(dueOf(c.card));
    if (!buckets.has(dueKey)) {
      // fuera de horizonte: meter en el último día
      buckets.get(lastBucketKey)!.push(c.card);
      overflowTags.set(dueKey, (overflowTags.get(dueKey) ?? 0) + 1);
      continue;
    }
    // Si el día está bajo el cap, meter aquí; si no, mover al siguiente
    if (buckets.get(dueKey)!.length < dailyReviewCap) {
      buckets.get(dueKey)!.push(c.card);
    } else {
      // buscar siguiente día con hueco
      let targetKey = dueKey;
      let overflowed = false;
      while (buckets.has(targetKey) && buckets.get(targetKey)!.length >= dailyReviewCap) {
        const next = shiftKey(targetKey, +1);
        if (!buckets.has(next)) {
          // No hay siguiente día: meter en el último día aunque esté lleno (overflow)
          targetKey = lastBucketKey;
          overflowed = true;
          break;
        }
        targetKey = next;
      }
      buckets.get(targetKey)!.push(c.card);
      if (overflowed) {
        overflowTags.set(targetKey, (overflowTags.get(targetKey) ?? 0) + 1);
      }
    }
  }

  // 3) Colocar Medium/Low; si desborda el día, mover al día siguiente
  let moved = 0;
  for (const c of rest) {
    let dueKey = toKey(dueOf(c.card));
    if (!buckets.has(dueKey)) {
      buckets.get(lastBucketKey)!.push(c.card);
      moved++;
      continue;
    }
    if (buckets.get(dueKey)!.length < softCap) {
      buckets.get(dueKey)!.push(c.card);
      continue;
    }
    // Día lleno: intentamos mover al siguiente
    let targetKey = dueKey;
    while (buckets.has(targetKey) && buckets.get(targetKey)!.length >= softCap) {
      const next = shiftKey(targetKey, +1);
      if (!buckets.has(next)) break;
      targetKey = next;
    }
    if (buckets.has(targetKey) && buckets.get(targetKey)!.length < softCap) {
      buckets.get(targetKey)!.push(c.card);
      moved++;
    } else if (buckets.get(dueKey)!.length < dailyReviewCap) {
      // No hay hueco bajo softCap pero cabe bajo dailyReviewCap
      buckets.get(dueKey)!.push(c.card);
    } else {
      // Overflow: lo dejamos donde estaba pero marcamos
      buckets.get(dueKey)!.push(c.card);
    }
  }

  // 4) Calcular cargas y overflow
  const loads: DailyLoad[] = [];
  let totalOverflow = false;
  for (const [key, list] of buckets.entries()) {
    const overflow = list.length > dailyReviewCap;
    if (overflow) totalOverflow = true;
    loads.push({
      date: key,
      cards: list.length,
      estimatedMinutes: Math.round(list.length * 0.5), // ~30s/tarjeta
      overflow,
    });
  }

  return { schedule: buckets, loads, overflow: totalOverflow, movedCount: moved };
}

function dueOf(card: FlashcardDraft): Date {
  return card.fsrs ? new Date(card.fsrs.dueDate) : new Date();
}

function toKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftKey(key: string, deltaDays: number): string {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return toKey(d);
}

function lastKey(d: Date): string {
  return toKey(d);
}

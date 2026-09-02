// v0.28: Integración del SnoozeManager con FSRS, Free Review y Knowledge Graph.
//
// Cuando un elemento (flashcard, recording, note, etc.) está snoozeado:
//   - FSRS no lo incluye en `dueCards` (no aparece en repasos)
//   - Free Review lo filtra automáticamente
//   - Knowledge Graph no lo propone como gap
//   - Examen scheduler lo skipea

import type { SnoozeManager } from "./snooze";
import type { FlashcardDraft } from "../types";

/** Filtra una lista de flashcards quitando las snoozeadas. */
export function filterSnoozedFlashcards(
  manager: SnoozeManager,
  cards: FlashcardDraft[],
): FlashcardDraft[] {
  return cards.filter((c) => !manager.isSnoozed("flashcard", c.id));
}

/** Filtra una lista de recordings (AudioRecord) por IDs. */
export function filterSnoozedRecordings<T extends { id: string }>(
  manager: SnoozeManager,
  recordings: T[],
): T[] {
  return recordings.filter((r) => !manager.isSnoozed("recording", r.id));
}

/** Filtra notas (por path) snoozeadas. */
export function filterSnoozedNotes<T extends { path: string }>(
  manager: SnoozeManager,
  notes: T[],
): T[] {
  return notes.filter((n) => !manager.isSnoozed("note", n.path));
}

/** Devuelve la lista de flashcards FSRS-due excluyendo las snoozeadas. */
export function getDueCardsExcludingSnoozed(
  manager: SnoozeManager,
  allCards: FlashcardDraft[],
  now: Date = new Date(),
): FlashcardDraft[] {
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return allCards.filter((c) => {
    if (manager.isSnoozed("flashcard", c.id)) return false;
    if (!c.fsrs) return false;
    const dueKey = c.fsrs.dueDate.slice(0, 10);
    return dueKey <= todayKey;
  });
}

/** Devuelve el conteo de cuántas cards se skipean por snooze. */
export function countSnoozedImpact(
  manager: SnoozeManager,
  allCards: FlashcardDraft[],
): { total: number; snoozed: number; active: number } {
  let snoozed = 0;
  for (const c of allCards) {
    if (manager.isSnoozed("flashcard", c.id)) snoozed++;
  }
  return { total: allCards.length, snoozed, active: allCards.length - snoozed };
}

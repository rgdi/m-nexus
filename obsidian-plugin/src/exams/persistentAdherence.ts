// v0.17: AdherenceStore persistente (en data.json del plugin).
// Reemplaza al InMemoryAdherenceStore de v0.15.

import type { ReviewEvent } from "./persistence.js";
import { computeAdherence, type AdherenceRecord, type AdherenceStore } from "./adherence.js";
import type { PluginDataStorage } from "./persistence.js";
import type { Exam } from "./types.js";

/** Adapter que deriva AdherenceRecord desde ReviewEvent persistido. */
export class PersistentAdherenceStore implements AdherenceStore {
  constructor(private storage: PluginDataStorage) {}

  // v0.28: AdherenceStore.load() ahora retorna ReviewEvent[] (consistente
  // con persistence.ts). Para obtener AdherenceRecord, usar loadForExam().
  load(): ReviewEvent[] {
    return this.storage.getReviews();
  }

  /** Carga los records de un examen específico. */
  loadForExam(exam: Exam, daysBack = 30): AdherenceRecord[] {
    if (!exam.schedule) return [];
    const reviews = this.storage.reviewsForExam(exam.id);
    return computeAdherence(exam, reviews, daysBack);
  }

  /** Reviews sin adherencia calculada (para otras funciones). */
  loadReviews(): ReviewEvent[] {
    return this.storage.getReviews();
  }

  /** Reviews de un examen. */
  loadReviewsForExam(examId: string): ReviewEvent[] {
    return this.storage.reviewsForExam(examId);
  }

  /** Reviews en un rango de fechas. */
  reviewsBetween(startDate: string, endDate: string): ReviewEvent[] {
    return this.storage.reviewsBetween(startDate, endDate);
  }

  /** Reviews desde un timestamp. */
  reviewsSince(timestamp: number): ReviewEvent[] {
    return this.storage.reviewsSince(timestamp);
  }

  save(_events: ReviewEvent[]): void {
    // No hace nada: los reviews ya están persistidos en storage.
    // Este método existe para satisfacer la interfaz AdherenceStore.
  }

  /** v0.28: append para satisfacer la interfaz AdherenceStore. */
  append(event: ReviewEvent): void {
    this.storage.appendReview(event);
  }

  /** Registra un repaso. */
  addReview(event: ReviewEvent): void {
    this.storage.addReview(event);
  }

  addReviewsBatch(events: ReviewEvent[]): void {
    this.storage.addReviewsBatch(events);
  }

  /** Acceso directo al storage (para tests). */
  getStorage(): PluginDataStorage {
    return this.storage;
  }
}

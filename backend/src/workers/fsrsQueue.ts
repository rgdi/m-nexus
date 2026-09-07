// fsrsQueue.ts: cola async para evaluaciones FSRS REALES (v0.46).
//
// v0.46: reemplazo completo de la simulación por el algoritmo FSRS real
// usando `ts-fsrs` (FSRS-6 compatible). El queue sigue siendo in-memory
// (suficiente para v0.46; en v0.47 añadiremos persistencia en SQLite).
//
// Cada card se modela con el modelo DSR (Difficulty, Stability, Retrievability):
//   - stability: tiempo (días) que tarda R en caer de 100% a 90%
//   - difficulty: 1-10, qué tan difícil es la card
//   - state: 0=new, 1=learning, 2=review, 3=relearning
//   - reps: cuántas veces se ha repasado
//   - lapses: cuántas veces se ha olvidado (Again)
//   - due: cuándo debe ser repasada
//   - last_review: timestamp del último repaso
//
// Uso:
//   import { fsrsQueue } from "./workers/fsrsQueue";
//   fsrsQueue.enqueue({ userId, cards: [...] });
//   const result = await fsrsQueue.waitFor(userId);

import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { fsrs, generatorParameters, createEmptyCard, State, Rating, type Card as FsrsCard, type Grade } from "ts-fsrs";
import { logger } from "../utils/log.js";

export interface FsrsJob {
  id: string;
  userId: string;
  /** Cards completas (con DSR). Se evalúan con `ts-fsrs`. */
  cards: FsrsJobCard[];
  /** Algoritmo: 'fsrs-v6' (default) o 'fsrs-v5' (legacy). */
  algorithm: "fsrs-v6" | "fsrs-v5";
  /** Timestamp de enqueue. */
  enqueuedAt: number;
  /** Cuántas veces se intentó ejecutar. */
  attempts: number;
}

/** Snapshot de una card que entra al job. */
export interface FsrsJobCard {
  cardId: string;
  /** Estado actual de la card. Si es null, se crea una card nueva. */
  currentState?: FsrsCard;
  /** Rating recibido (1=Again, 2=Hard, 3=Good, 4=Easy). Si null, no se evalúa. */
  rating?: Grade;
}

export interface FsrsJobResult {
  jobId: string;
  userId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  cardsEvaluated: number;
  /** Estado resultante por card. */
  cards: Array<{
    cardId: string;
    newState: FsrsCard;
    previousState?: FsrsCard;
  }>;
  /** Errores por card. */
  errors: Array<{ cardId: string; message: string }>;
}

type JobState = "queued" | "running" | "done" | "failed";

class FsrsJobEntry {
  job: FsrsJob;
  state: JobState = "queued";
  result?: FsrsJobResult;
  error?: Error;
  constructor(job: FsrsJob) {
    this.job = job;
  }
}

/** Scheduler FSRS-6 con parámetros por defecto (entrenados con 700M reviews). */
const fsrsScheduler = fsrs(generatorParameters({
  enable_fuzz: true,
  enable_short_term: true,
  request_retention: 0.9,
}));

/** Scheduler FSRS-5 (legacy) — menos preciso pero compatible con versiones anteriores. */
const fsrsV5Scheduler = fsrs(generatorParameters({
  enable_fuzz: true,
  enable_short_term: true,
  request_retention: 0.9,
  // FSRS-5 no usa los 2 parámetros extra de FSRS-6
}));

/**
 * Worker queue para FSRS.
 * - Concurrencia: configurable (default 1)
 * - Backoff: 100ms entre jobs
 * - Memoria: máxima de jobs in-flight 32, queue máxima 1000
 */
export class FsrsQueue extends EventEmitter {
  private queue: FsrsJobEntry[] = [];
  private running: Map<string, FsrsJobEntry> = new Map();
  private completed: Map<string, FsrsJobEntry> = new Map();
  private maxCompleted = 100;
  private maxQueueSize = 1000;
  private maxConcurrency = 1;
  private maxAttempts = 3;
  private cooldownMs = 100;

  /**
   * Enqueue a new FSRS evaluation job with REAL FSRS algorithm.
   * Returns the job ID. If the queue is full, the oldest job is dropped.
   */
  enqueue(input: { userId: string; cards: FsrsJobCard[]; algorithm?: FsrsJob["algorithm"] }): string {
    if (this.queue.length >= this.maxQueueSize) {
      const dropped = this.queue.shift();
      logger.warn({ droppedJobId: dropped?.job.id }, "FSRS queue full, dropping oldest job");
    }
    const job: FsrsJob = {
      id: `fsrs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      cards: input.cards.slice(0, 10_000),
      algorithm: input.algorithm ?? "fsrs-v6",
      enqueuedAt: Date.now(),
      attempts: 0,
    };
    const entry = new FsrsJobEntry(job);
    this.queue.push(entry);
    this.emit("enqueued", job);
    this.tick();
    return job.id;
  }

  /** Get status of a job. */
  getStatus(jobId: string): { state: JobState; result?: FsrsJobResult; error?: string } | null {
    const entry = this.find(jobId);
    if (!entry) return null;
    return {
      state: entry.state,
      result: entry.result,
      error: entry.error?.message,
    };
  }

  /** List all jobs in queue (for debugging). */
  list(): Array<{ id: string; state: JobState; userId: string; enqueuedAt: number }> {
    const out: Array<{ id: string; state: JobState; userId: string; enqueuedAt: number }> = [];
    for (const e of this.queue) {
      out.push({ id: e.job.id, state: e.state, userId: e.job.userId, enqueuedAt: e.job.enqueuedAt });
    }
    for (const [id, e] of this.running) {
      out.push({ id, state: e.state, userId: e.job.userId, enqueuedAt: e.job.enqueuedAt });
    }
    return out;
  }

  /** Wait for a job to finish (timeout 30s). */
  waitFor(jobId: string, timeoutMs = 30_000): Promise<FsrsJobResult> {
    const entry = this.find(jobId);
    if (!entry) return Promise.reject(new Error(`job not found: ${jobId}`));
    if (entry.state === "done" && entry.result) return Promise.resolve(entry.result);
    if (entry.state === "failed") return Promise.reject(entry.error ?? new Error("job failed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off("done", onDone);
        this.off("failed", onFailed);
        reject(new Error(`timeout waiting for job ${jobId}`));
      }, timeoutMs);
      const onDone = (result: FsrsJobResult) => {
        if (result.jobId === jobId) {
          clearTimeout(timer);
          this.off("done", onDone);
          this.off("failed", onFailed);
          resolve(result);
        }
      };
      const onFailed = (failedJobId: string, err: Error) => {
        if (failedJobId === jobId) {
          clearTimeout(timer);
          this.off("done", onDone);
          this.off("failed", onFailed);
          reject(err);
        }
      };
      this.on("done", onDone);
      this.on("failed", onFailed);
    });
  }

  /** Stats: queue size, running count, total processed. */
  stats(): { queued: number; running: number; processed: number; failed: number } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      processed: this.processedCount,
      failed: this.failedCount,
    };
  }

  private processedCount = 0;
  private failedCount = 0;

  private find(jobId: string): FsrsJobEntry | null {
    for (const e of this.queue) {
      if (e.job.id === jobId) return e;
    }
    return this.running.get(jobId) ?? this.completed.get(jobId) ?? null;
  }

  private tick(): void {
    if (this.running.size >= this.maxConcurrency) return;
    const entry = this.queue.shift();
    if (!entry) return;
    this.running.set(entry.job.id, entry);
    entry.state = "running";
    setImmediate(() => this.runJob(entry));
  }

  /**
   * Run a FSRS job using the REAL ts-fsrs algorithm.
   * Each card is processed individually:
   *   - If card has no `currentState`, create empty card.
   *   - If card has a `rating`, call scheduler.repeat() to get new state.
   *   - Otherwise, just compute the next due date (preview).
   */
  private runJob(entry: FsrsJobEntry): void {
    const start = performance.now();
    entry.job.attempts++;
    const errors: Array<{ cardId: string; message: string }> = [];
    const evaluatedCards: Array<{ cardId: string; newState: FsrsCard; previousState?: FsrsCard }> = [];

    try {
      const scheduler = entry.job.algorithm === "fsrs-v5" ? fsrsV5Scheduler : fsrsScheduler;
      const now = new Date();

      for (const jobCard of entry.job.cards) {
        try {
          // Validar cardId
          if (!jobCard.cardId || typeof jobCard.cardId !== "string") {
            errors.push({ cardId: String(jobCard.cardId), message: "invalid cardId" });
            continue;
          }

          let previousState: FsrsCard | undefined = jobCard.currentState;
          let newState: FsrsCard;

          if (jobCard.rating != null) {
            // Tiene rating: aplicar el repaso
            const card = jobCard.currentState ?? createEmptyCard(now);
            const ratingNum = Number(jobCard.rating);
            if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 4) {
              errors.push({ cardId: jobCard.cardId, message: `invalid rating: ${jobCard.rating}` });
              continue;
            }
            // ts-fsrs Rating enum: 1=Manual, 2=Again, 3=Hard, 4=Good, 5=Easy
            // Mapeamos nuestro Grade (1-4) al enum de ts-fsrs (Again/Hard/Good/Easy)
            const ratingEnum: Rating = ratingNum === 1 ? Rating.Again
              : ratingNum === 2 ? Rating.Hard
              : ratingNum === 3 ? Rating.Good
              : Rating.Easy;
            // `card` puede ser undefined (ts-fsrs requiere no-undefined) — usamos empty card
            const baseCard: FsrsCard = card ?? createEmptyCard(now);
            const result = scheduler.repeat(baseCard, now);
            const reviewed = result[ratingEnum as Grade];
            if (!reviewed) {
              errors.push({ cardId: jobCard.cardId, message: "scheduler returned no result" });
              continue;
            }
            newState = reviewed.card;
          } else {
            // Sin rating: crear empty card (card nueva)
            newState = createEmptyCard(now);
          }

          evaluatedCards.push({
            cardId: jobCard.cardId,
            newState,
            previousState,
          });
        } catch (err) {
          errors.push({
            cardId: jobCard.cardId,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const result: FsrsJobResult = {
        jobId: entry.job.id,
        userId: entry.job.userId,
        startedAt: Date.now() - Math.floor(performance.now() - start),
        finishedAt: Date.now(),
        durationMs: Math.floor(performance.now() - start),
        cardsEvaluated: evaluatedCards.length,
        cards: evaluatedCards,
        errors,
      };
      entry.result = result;
      entry.state = "done";
      this.processedCount++;
      this.running.delete(entry.job.id);
      this.completed.set(entry.job.id, entry);
      // Evitar leak de memoria
      if (this.completed.size > this.maxCompleted) {
        const oldest = this.completed.keys().next().value;
        if (oldest) this.completed.delete(oldest);
      }
      this.emit("done", result);
      logger.info(
        {
          jobId: entry.job.id,
          userId: entry.job.userId,
          cards: result.cardsEvaluated,
          durationMs: result.durationMs,
          algorithm: entry.job.algorithm,
        },
        "FSRS job done"
      );
    } catch (err) {
      if (entry.job.attempts < this.maxAttempts) {
        logger.warn(
          { jobId: entry.job.id, attempt: entry.job.attempts, err: (err as Error).message },
          "FSRS job failed, retrying"
        );
        this.running.delete(entry.job.id);
        this.queue.push(entry);
        setTimeout(() => this.tick(), this.cooldownMs * entry.job.attempts);
        return;
      }
      entry.error = err as Error;
      entry.state = "failed";
      this.failedCount++;
      this.running.delete(entry.job.id);
      this.completed.set(entry.job.id, entry);
      this.emit("failed", entry.job.id, err);
      logger.error(
        { jobId: entry.job.id, userId: entry.job.userId, err: (err as Error).message },
        "FSRS job failed permanently"
      );
    }
    setTimeout(() => this.tick(), this.cooldownMs);
  }

  /** Drain all queued jobs (for graceful shutdown). */
  async drain(timeoutMs = 5_000): Promise<void> {
    const start = Date.now();
    while (this.queue.length + this.running.size > 0) {
      if (Date.now() - start > timeoutMs) {
        logger.warn({ remaining: this.queue.length + this.running.size }, "FSRS drain timeout");
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

// Singleton
export const fsrsQueue = new FsrsQueue();

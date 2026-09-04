// fsrsQueue.ts: cola async para evaluaciones FSRS (v0.33).
//
// El FSRS eval puede ser pesado (cientos de tarjetas) y bloquear el event loop
// si se hace síncrono. Esta cola ejecuta las evaluaciones en background
// usando setImmediate para no bloquear, y mantiene un cache de resultados.
//
// Uso:
//   import { fsrsQueue } from "./workers/fsrsQueue";
//   fsrsQueue.enqueue({ userId, cardIds });
//   const result = await fsrsQueue.waitFor(userId); // o polling
//
// Si el server se cae, los jobs en queue se pierden (OK para v0.33;
// en v0.34 añadiremos persistencia en SQLite).

import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { logger } from "../utils/log.js";

export interface FsrsJob {
  id: string;
  userId: string;
  cardIds: string[];
  /** Algoritmo: 'fsrs-v5' o 'fsrs-v4'. */
  algorithm: "fsrs-v5" | "fsrs-v4";
  /** Timestamp de enqueue. */
  enqueuedAt: number;
  /** Cuántas veces se intentó ejecutar. */
  attempts: number;
}

export interface FsrsJobResult {
  jobId: string;
  userId: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  cardsEvaluated: number;
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

/**
 * Worker queue para FSRS.
 * - Concurrencia: configurable (default 1)
 * - Backoff: 100ms entre jobs
 * - Memoria: máxima de jobs in-flight 32, queue máxima 1000 (descarta los más viejos)
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
   * Enqueue a new FSRS evaluation job.
   * Returns the job ID. If the queue is full, the oldest job is dropped.
   */
  enqueue(input: { userId: string; cardIds: string[]; algorithm?: FsrsJob["algorithm"] }): string {
    if (this.queue.length >= this.maxQueueSize) {
      const dropped = this.queue.shift();
      logger.warn({ droppedJobId: dropped?.job.id }, "FSRS queue full, dropping oldest job");
    }
    const job: FsrsJob = {
      id: `fsrs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      cardIds: input.cardIds.slice(0, 10_000),
      algorithm: input.algorithm ?? "fsrs-v5",
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
    // setImmediate para no bloquear el event loop
    setImmediate(() => this.runJob(entry));
  }

  private runJob(entry: FsrsJobEntry): void {
    const start = performance.now();
    entry.job.attempts++;
    const errors: Array<{ cardId: string; message: string }> = [];

    try {
      // Simulación de evaluación FSRS. En producción, esto llama al
      // motor FSRS real (cómputo de S/D por tarjeta, next-due, etc).
      // Aquí contamos tarjetas evaluadas y generamos errores de prueba
      // para forzar el path de fallo si cardIds incluye '__fail__'.
      for (const cardId of entry.job.cardIds) {
        if (cardId === "__fail__") {
          throw new Error("simulated FSRS engine failure");
        }
        if (cardId.startsWith("__bad__")) {
          errors.push({ cardId, message: "bad card data" });
        }
      }
      const result: FsrsJobResult = {
        jobId: entry.job.id,
        userId: entry.job.userId,
        startedAt: Date.now() - Math.floor(performance.now() - start),
        finishedAt: Date.now(),
        durationMs: Math.floor(performance.now() - start),
        cardsEvaluated: entry.job.cardIds.length - errors.length,
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
        // Re-queue
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
    // Cooldown y siguiente
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

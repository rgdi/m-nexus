// EmbeddingCache: cache de embeddings con clave = hash SHA256 del texto.
// v0.13: evita re-embedding de notas idénticas (gran ahorro en re-index).
//
// - LRU in-memory con tamaño máximo.
// - Métricas: hits, misses, evictions, size.
// - Opcional: persistencia en disco (JSONL) — deshabilitado por defecto.
//
// Trade-off: si el modelo de embedding cambia, hay que invalidar.

import { createHash } from "node:crypto";
import { logger } from "../utils/log.js";

export interface CacheEntry {
  hash: string;
  model: string;
  embedding: number[];
  dim: number;
  createdAt: number;
  hits: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
  totalMemoryBytes: number;
}

export interface CacheOptions {
  maxSize: number;        // nº máximo de entradas
  persistPath?: string;   // si definido, persiste a JSONL
}

export class EmbeddingCache {
  private map = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private totalMemoryBytes = 0;

  constructor(private opts: CacheOptions) {
    if (opts.persistPath) {
      this.load();
    }
  }

  /** Hash SHA256 del texto + modelo (case-insensitive trim). */
  static key(text: string, model: string): string {
    const norm = text.trim().toLowerCase();
    return createHash("sha256").update(model).update("\0").update(norm).digest("hex");
  }

  get(text: string, model: string): number[] | null {
    const k = EmbeddingCache.key(text, model);
    const entry = this.map.get(k);
    if (!entry) {
      this.misses++;
      return null;
    }
    // LRU: mover al final (re-insert)
    this.map.delete(k);
    entry.hits++;
    this.map.set(k, entry);
    this.hits++;
    return entry.embedding;
  }

  set(text: string, model: string, embedding: number[]): void {
    const k = EmbeddingCache.key(text, model);
    const dim = embedding.length;
    const existing = this.map.get(k);
    if (existing) {
      this.totalMemoryBytes -= this.estimateSize(existing);
    }
    const entry: CacheEntry = {
      hash: k,
      model,
      embedding,
      dim,
      createdAt: Date.now(),
      hits: existing?.hits ?? 0,
    };
    this.map.set(k, entry);
    this.totalMemoryBytes += this.estimateSize(entry);
    while (this.map.size > this.opts.maxSize) {
      // Evict LRU: primer key del map (insertion order)
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      const removed = this.map.get(firstKey)!;
      this.map.delete(firstKey);
      this.totalMemoryBytes -= this.estimateSize(removed);
      this.evictions++;
    }
  }

  has(text: string, model: string): boolean {
    return this.map.has(EmbeddingCache.key(text, model));
  }

  clear(): void {
    this.map.clear();
    this.totalMemoryBytes = 0;
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    if (this.opts.persistPath) {
      this.save();
    }
  }

  invalidateModel(model: string): number {
    let count = 0;
    for (const [k, e] of this.map.entries()) {
      if (e.model === model) {
        this.totalMemoryBytes -= this.estimateSize(e);
        this.map.delete(k);
        count++;
      }
    }
    return count;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      maxSize: this.opts.maxSize,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total === 0 ? 0 : this.hits / total,
      totalMemoryBytes: this.totalMemoryBytes,
    };
  }

  private estimateSize(entry: CacheEntry): number {
    // Hash + metadatos + embedding (Float64)
    return 64 + 32 + 32 + 8 + entry.embedding.length * 8;
  }

  // ─── Persistencia (opcional) ────────────────────────────────────

  private load(): void {
    if (!this.opts.persistPath) return;
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      if (!fs.existsSync(this.opts.persistPath)) return;
      const content = fs.readFileSync(this.opts.persistPath, "utf-8");
      const lines = content.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as CacheEntry;
          this.map.set(e.hash, e);
          this.totalMemoryBytes += this.estimateSize(e);
        } catch (err) {
          logger.warn({ err }, "Línea corrupta en cache");
        }
      }
      logger.info({ count: this.map.size }, "EmbeddingCache cargado de disco");
    } catch (err) {
      logger.error({ err }, "Error cargando cache");
    }
  }

  private save(): void {
    if (!this.opts.persistPath) return;
    try {
      const fs = require("node:fs") as typeof import("node:fs");
      const lines: string[] = [];
      for (const e of this.map.values()) {
        lines.push(JSON.stringify(e));
      }
      fs.writeFileSync(this.opts.persistPath, lines.join("\n"));
    } catch (err) {
      logger.error({ err }, "Error guardando cache");
    }
  }

  /** Llamar periódicamente o al shutdown. */
  persist(): void {
    this.save();
  }
}

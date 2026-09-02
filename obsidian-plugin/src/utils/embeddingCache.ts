// Cache local de embeddings en el plugin (capa 0, antes de red).
// v0.13: ahorra round-trips al backend si el texto ya fue embebido.
//
// Estrategia: Map<hash, number[]> en memoria, persistido en data.json.
// Si el modelo cambia, hay que invalidar (la key incluye modelo).
//
// Diferencia con el cache del backend:
//   - Este cache evita pedirle al backend.
//   - El cache del backend (v0.13) evita calcular embeddings para todos los devices.

import { createHash } from "node:crypto";
import { Logger } from "./logger.js";

const logger = new Logger("[m-nexus-embed-cache]");

export interface EmbeddingCacheEntry {
  hash: string;
  model: string;
  embedding: number[];
  createdAt: number;
  hits: number;
}

export interface EmbeddingCacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  estimatedMemoryBytes: number;
}

export class LocalEmbeddingCache {
  private map = new Map<string, EmbeddingCacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(private model: string) {}

  /** Hash del texto + modelo (case-insensitive). */
  static key(text: string, model: string): string {
    const norm = text.trim().toLowerCase();
    return createHash("sha256").update(model).update("\0").update(norm).digest("hex");
  }

  get(text: string): number[] | null {
    const k = LocalEmbeddingCache.key(text, this.model);
    const entry = this.map.get(k);
    if (!entry) {
      this.misses++;
      return null;
    }
    entry.hits++;
    this.hits++;
    return entry.embedding;
  }

  set(text: string, embedding: number[]): void {
    const k = LocalEmbeddingCache.key(text, this.model);
    this.map.set(k, {
      hash: k,
      model: this.model,
      embedding,
      createdAt: Date.now(),
      hits: 0,
    });
  }

  invalidateModel(newModel: string): void {
    if (newModel === this.model) return;
    this.map.clear();
    this.model = newModel;
    logger.info(`Cache invalidado por cambio de modelo: ${newModel}`);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size(): number {
    return this.map.size;
  }

  stats(): EmbeddingCacheStats {
    const total = this.hits + this.misses;
    const mem = Array.from(this.map.values()).reduce((sum, e) => sum + e.embedding.length * 8, 0);
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      estimatedMemoryBytes: mem,
    };
  }

  toJSON(): EmbeddingCacheEntry[] {
    return Array.from(this.map.values());
  }

  static fromJSON(entries: EmbeddingCacheEntry[], model: string): LocalEmbeddingCache {
    const cache = new LocalEmbeddingCache(model);
    for (const e of entries) {
      cache.map.set(e.hash, e);
    }
    return cache;
  }
}

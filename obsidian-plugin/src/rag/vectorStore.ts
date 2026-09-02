// VectorStore: almacenamiento en memoria de chunks + embeddings, con persistencia
// en data.json del plugin. Soporta búsqueda por coseno y rebuild incremental.

import { Plugin } from "obsidian";
import { RAGChunk, RAGSearchResult } from "../types";
import { hashText } from "./chunker";
import { Logger } from "../utils/logger";

const STORAGE_KEY = "rag_index_v1";

export class VectorStore {
  private chunks = new Map<string, RAGChunk>();

  constructor(private plugin: Plugin, private log: Logger) {}

  /** Carga el índice desde disco. */
  async load(): Promise<void> {
    const all = (await this.plugin.loadData()) as Record<string, unknown> | null;
    const raw = (all?.ragIndex as RAGChunk[] | undefined) ?? [];
    this.chunks.clear();
    for (const c of raw) this.chunks.set(c.id, c);
    this.log.info(`RAG: cargados ${this.chunks.size} chunks.`);
  }

  /** Persiste el índice. */
  async persist(): Promise<void> {
    const all = ((await this.plugin.loadData()) as Record<string, unknown>) ?? {};
    all.ragIndex = Array.from(this.chunks.values());
    await this.plugin.saveData(all);
  }

  size(): number {
    return this.chunks.size;
  }

  clear(): void {
    this.chunks.clear();
  }

  get(id: string): RAGChunk | undefined {
    return this.chunks.get(id);
  }

  add(chunk: RAGChunk): void {
    this.chunks.set(chunk.id, chunk);
  }

  /** Quita todos los chunks de una nota. */
  removeByNote(notePath: string): number {
    let removed = 0;
    for (const [id, c] of this.chunks) {
      if (c.notePath === notePath) {
        this.chunks.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Quita los chunks cuyo hash no esté en `currentHashes`. */
  pruneStale(currentHashes: Set<string>): number {
    let removed = 0;
    for (const [id, c] of this.chunks) {
      if (!currentHashes.has(c.id)) {
        this.chunks.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Lista chunks por nota. */
  listByNote(notePath: string): RAGChunk[] {
    return Array.from(this.chunks.values()).filter((c) => c.notePath === notePath);
  }

  /** Búsqueda por coseno. Devuelve top-k ordenado por score desc. */
  search(queryVec: number[], topK = 5, filter?: (c: RAGChunk) => boolean): RAGSearchResult[] {
    const all = Array.from(this.chunks.values()).filter((c) => !filter || filter(c));
    const scored: RAGSearchResult[] = [];
    for (const c of all) {
      const score = cosine(queryVec, c.embedding);
      scored.push({ chunk: c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Hash determinístico para una chunk (notePath + chunkIndex + texto). */
  static idFor(notePath: string, chunkIndex: number, text: string): string {
    return `${notePath}::${chunkIndex}::${hashText(text)}`;
  }
}

/** Cosine similarity entre dos vectores (asumimos misma dimensión). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

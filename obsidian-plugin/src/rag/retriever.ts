// RAG Retriever: toma una query, la embebe, busca los chunks más relevantes.

import { RAGSearchResult } from "../types";
import { EmbeddingProvider } from "./embeddings";
import { VectorStore } from "./vectorStore";
import { Logger } from "../utils/logger";

export interface RetrieveOptions {
  topK: number;
  /** Score mínimo (0-1) para incluir un chunk. */
  minScore: number;
  /** Filtrar por nota(s) específica(s). */
  noteFilter?: string[];
}

const DEFAULT_OPTS: RetrieveOptions = { topK: 5, minScore: 0.6 };

export class Retriever {
  constructor(
    private embeddings: EmbeddingProvider,
    private store: VectorStore,
    private log: Logger
  ) {}

  async retrieve(query: string, options: Partial<RetrieveOptions> = {}): Promise<RAGSearchResult[]> {
    const opts: RetrieveOptions = { ...DEFAULT_OPTS, ...options };
    if (this.store.size() === 0) {
      this.log.warn("RAG: índice vacío. Ejecuta 'Indexar vault' primero.");
      return [];
    }
    const qVec = await this.embeddings.embed(query);
    const filter = opts.noteFilter
      ? (c: { notePath: string }) => opts.noteFilter!.includes(c.notePath)
      : undefined;
    let results = this.store.search(qVec, opts.topK * 2, filter);
    results = results.filter((r) => r.score >= opts.minScore).slice(0, opts.topK);
    this.log.info(`RAG: query "${query.slice(0, 60)}…" → ${results.length} chunks relevantes.`);
    return results;
  }

  /** Construye el prompt de contexto para el LLM a partir de los resultados. */
  buildContext(results: RAGSearchResult[]): string {
    if (results.length === 0) return "(No se encontró contexto relevante en tus notas.)";
    const parts: string[] = [];
    parts.push("CONTEXTO DE TUS NOTAS (usar solo si aplica a la pregunta):\n");
    results.forEach((r, i) => {
      const c = r.chunk;
      parts.push(`[${i + 1}] (score=${r.score.toFixed(2)}) ${c.noteTitle}${c.section ? " › " + c.section : ""} (${c.notePath})`);
      parts.push(c.text);
      parts.push("");
    });
    return parts.join("\n");
  }
}

// RemoteEmbeddings: EmbeddingProvider que habla con el backend.
// v0.8: el plugin NO calcula embeddings localmente. Solo pasa textos al server.
// v0.13: cache local (L0) antes de pedir al backend; el backend tiene su propio LRU (L1).

import { RemoteClient } from "../server/remoteClient";
import { EmbeddingProvider } from "./embeddings";
import { Logger } from "../utils/logger.js";
import { LocalEmbeddingCache } from "../utils/embeddingCache.js";

export class RemoteEmbeddings implements EmbeddingProvider {
  readonly id = "remote";
  readonly name = "Backend M-NEXUS (remoto)";
  readonly model: string;
  dimensions: number = 1024;
  private cache: LocalEmbeddingCache;

  constructor(
    private remote: RemoteClient,
    private getModel: () => string,
    private log: Logger
  ) {
    this.model = getModel();
    this.cache = new LocalEmbeddingCache(this.model);
  }

  isConfigured(): boolean {
    return this.remote.hasBackend();
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.embedBatch([text]);
    return res[0] ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // L0: cache local
    const result: (number[] | null)[] = new Array(texts.length);
    const misses: number[] = [];
    for (let i = 0; i < texts.length; i++) {
      const hit = this.cache.get(texts[i]);
      result[i] = hit;
      if (!hit) misses.push(i);
    }

    if (misses.length > 0) {
      // L1: pedir al backend (que tiene su propio cache)
      const toSend = misses.map((i) => texts[i]);
      const resp = await this.remote.embed({ texts: toSend, model: this.model });
      for (let j = 0; j < misses.length; j++) {
        const idx = misses[j];
        const emb = resp.embeddings[j];
        result[idx] = emb;
        this.cache.set(texts[idx], emb);
      }
      if (resp.dim && this.dimensions === 1024) this.dimensions = resp.dim;
    }

    return result.map((r) => r ?? []);
  }

  getCacheStats() {
    return this.cache.stats();
  }

  clearCache() {
    this.cache.clear();
  }

  /** Llamar si cambia el modelo en settings. */
  updateModel(model: string) {
    if (model !== this.model) {
      (this as { model: string }).model = model;
      this.cache.invalidateModel(model);
    }
  }
}

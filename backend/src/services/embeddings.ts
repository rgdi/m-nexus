// EmbeddingsService: usa Ollama o un endpoint OpenAI-compatible.
// v0.13: integración con EmbeddingCache (LRU con hash SHA256 del texto).
//
// Flujo:
//   1. Para cada texto, buscar en cache.
//   2. Si hit, usar el embedding cacheado.
//   3. Si miss, llamar al provider y cachear el resultado.

import { config } from "../config.js";
import { logger, logNetwork, logOp, logError } from "../utils/log.js";
import { EmbeddingCache } from "./embeddingCache.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  dim: number;
  /** Métricas de uso del cache (v0.13). */
  cacheStats?: {
    hits: number;
    misses: number;
    cached: number;
  };
}

export class EmbeddingsService {
  /** Cache compartido entre instancias. Singleton vía getter. */
  private static _cache: EmbeddingCache | null = null;
  private get cache(): EmbeddingCache {
    if (!EmbeddingsService._cache) {
      const maxSize = config.embeddingCacheSize;
      const persistPath = config.embeddingCachePath;
      EmbeddingsService._cache = new EmbeddingCache({ maxSize, persistPath });
      logger.info({ maxSize, persistPath }, "EmbeddingCache inicializado");
    }
    return EmbeddingsService._cache;
  }

  async isAvailable(): Promise<boolean> {
    if (process.env.MOCK_OLLAMA === "1") return true;
    const r = await safeCallAsync<boolean>({
      component: "emb",
      code: "EC-EMB-001",
      message: "embeddings isAvailable check failed",
      context: { baseUrl: config.ollamaBaseUrl },
      op: async () => {
        const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        logNetwork("GET", `${config.ollamaBaseUrl}/api/tags`, { statusCode: res.status });
        return res.ok;
      },
    });
    return r.value ?? false;
  }

  /** Permite a tests resetear el cache entre casos. */
  static resetCache(): void {
    EmbeddingsService._cache?.clear();
    EmbeddingsService._cache = null;
  }

  /** Permite al admin invalidar el cache (por cambio de modelo). */
  invalidateCache(model?: string): number {
    if (!EmbeddingsService._cache) return 0;
    if (model) return EmbeddingsService._cache.invalidateModel(model);
    EmbeddingsService._cache.clear();
    return -1;
  }

  getCacheStats() {
    return this.cache.stats();
  }

  async embed(texts: string[], model?: string): Promise<EmbeddingResponse> {
    const r = await safeCallAsync<EmbeddingResponse>({
      component: "emb",
      code: "EC-EMB-002",
      message: "embed failed",
      context: { count: texts.length, model: model ?? config.embeddingModel },
      op: async () => {
        const useModel = model ?? config.embeddingModel;
        const cache = this.cache;

        // 1) Buscar en cache
        const result: (number[] | null)[] = new Array(texts.length);
        const misses: number[] = [];
        for (let i = 0; i < texts.length; i++) {
          const hit = cache.get(texts[i], useModel);
          result[i] = hit;
          if (!hit) misses.push(i);
        }
        const hits = texts.length - misses.length;
        const initialMisses = misses.length;

        // 2) Calcular los misses en batch
        if (misses.length > 0) {
          const textsToEmbed = misses.map((i) => texts[i]);
          const computed = process.env.MOCK_OLLAMA === "1"
            ? this.mockEmbed(textsToEmbed, useModel)
            : await this.realEmbed(textsToEmbed, useModel);
          for (let j = 0; j < misses.length; j++) {
            const idx = misses[j];
            const emb = computed.embeddings[j];
            result[idx] = emb;
            cache.set(texts[idx], useModel, emb);
          }
        }

        const embeddings = result.map((r) => r ?? []);
        const dim = embeddings[0]?.length ?? 0;
        logOp("emb", "embed", true, { count: texts.length, hits, misses: initialMisses, dim });
        return {
          embeddings,
          model: useModel,
          dim,
          cacheStats: { hits, misses: initialMisses, cached: cache.stats().size },
        };
      },
    });
    if (!r.success || !r.value) throw r.error ?? new Error("embed failed");
    return r.value;
  }

  private async realEmbed(texts: string[], model: string): Promise<EmbeddingResponse> {
    const r = await safeCallAsync<EmbeddingResponse>({
      component: "emb",
      code: "EC-EMB-003",
      message: "realEmbed failed",
      context: { model, count: texts.length, baseUrl: config.ollamaBaseUrl },
      op: async () => {
        const start = Date.now();
        const res = await fetch(`${config.ollamaBaseUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: texts }),
        });
        const durationMs = Date.now() - start;
        logNetwork("POST", `${config.ollamaBaseUrl}/api/embeddings`, {
          statusCode: res.status, durationMs,
        });
        if (!res.ok) {
          throw E.emb("EC-EMB-004", "Ollama embeddings error", {
            context: { status: res.status, model, body: (await res.text()).substring(0, 500), durationMs },
            hint: "Check Ollama is running and model is available",
          });
        }
        const data = (await res.json()) as { embeddings: number[][] };
        if (!data.embeddings || data.embeddings.length === 0) {
          throw E.emb("EC-EMB-005", "Embeddings empty response", {
            context: { model, count: texts.length },
            hint: "Model returned no embeddings; check input text",
          });
        }
        return {
          embeddings: data.embeddings,
          model,
          dim: data.embeddings[0].length,
        };
      },
    });
    if (!r.success || !r.value) throw r.error ?? new Error("realEmbed failed");
    return r.value;
  }

  private mockEmbed(texts: string[], model: string): EmbeddingResponse {
    const dim = 1024;
    const embeddings = texts.map((t) => {
      const vec = new Array<number>(dim);
      let seed = 0;
      for (let i = 0; i < t.length; i++) seed = ((seed << 5) - seed + t.charCodeAt(i)) | 0;
      for (let i = 0; i < dim; i++) {
        seed = (seed * 1103515245 + 12345) | 0;
        vec[i] = ((seed >>> 0) / 4294967295) * 2 - 1;
      }
      return vec;
    });
    return { embeddings, model, dim };
  }
}

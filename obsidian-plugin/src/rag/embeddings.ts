// Embeddings: convierte texto en vectores.
// Soporta OpenAI (text-embedding-3-small) y un stub para Ollama/local.

import { requestUrl } from "obsidian";
import { MNexusSettings } from "../types";
import { Logger } from "../utils/logger";

export interface EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  isConfigured(): boolean;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly id = "openai";
  readonly name = "OpenAI embeddings";
  readonly dimensions = 1536;
  constructor(private settings: MNexusSettings, private log: Logger) {}

  isConfigured(): boolean {
    return Boolean(this.settings.openrouterApiKey?.trim());
  }

  async embed(text: string): Promise<number[]> {
    const r = await this.embedBatch([text]);
    return r[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.isConfigured()) throw new Error("OpenRouter API key no configurada (se reutiliza para embeddings).");
    // OpenRouter expone /embeddings compatible con OpenAI
    const baseUrl = this.settings.openrouterBaseUrl?.replace(/\/+$/, "") || "https://openrouter.ai/api/v1";
    const res = await requestUrl({
      url: `${baseUrl}/embeddings`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openrouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: texts,
      }),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Embeddings ${res.status}: ${res.text.slice(0, 300)}`);
    }
    const json = res.json as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

/** Stub para embeddings locales (Ollama nomic-embed, sentence-transformers, etc.). */
export class LocalEmbeddings implements EmbeddingProvider {
  readonly id = "local";
  readonly name = "Embeddings locales (Ollama)";
  readonly dimensions = 768;
  constructor(private settings: MNexusSettings, private log: Logger) {}

  isConfigured(): boolean {
    return Boolean(this.settings.ollamaBaseUrl?.trim());
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error("Embeddings locales aún no implementados. Usa OpenRouter o implementa el provider.");
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error("Embeddings locales aún no implementados.");
  }
}

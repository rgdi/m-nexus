// Ollama provider (stub para implementación futura).
// Ollama expone una API OpenAI-compatible en http://localhost:11434/v1/chat/completions
// Para activarlo basta con implementar los métodos y registrarlo en manager.ts.

import { requestUrl } from "obsidian";
import { LLMMessage, CompletionOptions, LLMStatus, ModelInfo, MNexusSettings } from "../types";
import { OLLAMA_DEFAULT_BASE } from "../constants";
import { LLMProvider } from "./provider";
import { Logger } from "../utils/logger";

export class OllamaProvider implements LLMProvider {
  readonly id = "ollama" as const;
  readonly name = "Ollama (local)";

  constructor(
    private settings: MNexusSettings,
    private log: Logger
  ) {}

  isConfigured(): boolean {
    return Boolean(this.settings.ollamaBaseUrl?.trim());
  }

  async getStatus(): Promise<LLMStatus> {
    if (!this.isConfigured()) {
      return { provider: "ollama", configured: false, error: "URL de Ollama no configurada" };
    }
    // Ping rápido a /api/tags para ver si responde
    try {
      const res = await requestUrl({
        url: `${this.baseUrl()}/api/tags`,
        method: "GET",
        throw: false,
      });
      if (res.status === 200) {
        return { provider: "ollama", configured: true, model: this.settings.llmModel };
      }
      return { provider: "ollama", configured: false, error: `Ollama devolvió ${res.status}` };
    } catch (e) {
      return { provider: "ollama", configured: false, error: `No se puede conectar: ${(e as Error).message}` };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Implementación futura: GET /api/tags
    return [
      { id: "llama3.1", name: "Llama 3.1 8B (local)", provider: "ollama", contextWindow: 128000, supportsJson: true, costTier: "free" },
      { id: "qwen2.5", name: "Qwen 2.5 (local)", provider: "ollama", contextWindow: 32000, supportsJson: true, costTier: "free" },
      { id: "mistral", name: "Mistral 7B (local)", provider: "ollama", contextWindow: 32000, supportsJson: true, costTier: "free" },
      { id: "gemma2", name: "Gemma 2 (local)", provider: "ollama", contextWindow: 8000, supportsJson: true, costTier: "free" },
    ];
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  async chat(messages: LLMMessage[], options?: CompletionOptions): Promise<string> {
    this.log.warn("OllamaProvider: implementación en progreso. Usa OpenRouter por ahora.");
    throw new Error(
      "Ollama provider aún no está implementado. Para activarlo, abre src/llm/ollama.ts y completa los métodos."
    );
  }

  async *streamChat(messages: LLMMessage[], options?: CompletionOptions): AsyncIterable<string> {
    throw new Error("Ollama provider aún no está implementado.");
  }

  async completeJson<T = unknown>(prompt: string, options?: CompletionOptions): Promise<T> {
    const raw = await this.complete(prompt, { ...options, responseFormat: "json" });
    return JSON.parse(raw) as T;
  }

  async chatJson<T = unknown>(messages: LLMMessage[], options?: CompletionOptions): Promise<T> {
    const raw = await this.chat(messages, { ...options, responseFormat: "json" });
    return JSON.parse(raw) as T;
  }

  private baseUrl(): string {
    return this.settings.ollamaBaseUrl?.replace(/\/+$/, "") || OLLAMA_DEFAULT_BASE;
  }
}

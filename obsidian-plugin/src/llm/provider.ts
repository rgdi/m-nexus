// Interfaz LLMProvider: abstracción sobre cualquier backend (OpenRouter, Ollama, OpenAI...).
// Para añadir un provider nuevo, implementa esta interfaz y regístralo en manager.ts.

import { CompletionOptions, LLMMessage, ModelInfo, LLMStatus, LLMProviderId } from "../types";

export interface LLMProvider {
  readonly id: LLMProviderId;
  readonly name: string;

  /** ¿El provider está listo para usar? (api key configurada, server alcanzable, etc.) */
  isConfigured(): boolean;

  /** Devuelve estado detallado (útil para el panel). */
  getStatus(): Promise<LLMStatus>;

  /** Lista modelos disponibles (puede ser estática o hacer fetch). */
  listModels(): Promise<ModelInfo[]>;

  /** Llamada simple: prompt → texto. */
  complete(prompt: string, options?: CompletionOptions): Promise<string>;

  /** Chat con historial de mensajes. */
  chat(messages: LLMMessage[], options?: CompletionOptions): Promise<string>;

  /** Chat con streaming. Devuelve un AsyncIterable que emite tokens. */
  streamChat(messages: LLMMessage[], options?: CompletionOptions): AsyncIterable<string>;

  /** Llamada que fuerza JSON. Devuelve el objeto parseado. Lanza si no se puede parsear. */
  completeJson<T = unknown>(prompt: string, options?: CompletionOptions): Promise<T>;
  chatJson<T = unknown>(messages: LLMMessage[], options?: CompletionOptions): Promise<T>;
}

/** Registry para que el manager pueda resolver un provider por id. */
export type ProviderFactory = () => LLMProvider;

// RemoteLLMProvider: LLMProvider que habla con el backend.
// v0.8: el plugin NO ejecuta Ollama localmente. Solo pasa mensajes al server.

import { RemoteClient } from "../server/remoteClient";
import { CompletionOptions, LLMMessage, LLMProviderId, LLMStatus, ModelInfo } from "../types";
import { LLMProvider } from "./provider";
import { Logger } from "../utils/logger";

export class RemoteLLMProvider implements LLMProvider {
  id: LLMProviderId = "remote";
  name = "Backend M-NEXUS (remoto)";

  constructor(
    private remote: RemoteClient,
    private getDefaultModel: () => string,
    private log: Logger
  ) {}

  isConfigured(): boolean {
    return this.remote.hasBackend();
  }

  async getStatus(): Promise<LLMStatus> {
    if (!this.isConfigured()) {
      return { provider: this.id, configured: false, error: "Backend no configurado" };
    }
    try {
      const h = await this.remote.health();
      return {
        provider: this.id,
        configured: true,
        model: this.getDefaultModel(),
        ollamaAvailable: h.providers.ollama === "available",
        openrouterAvailable: h.providers.openrouter === "available",
      };
    } catch (e) {
      return { provider: this.id, configured: false, error: (e as Error).message };
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured()) return [];
    try {
      return await this.remote.chat({ messages: [] }).then(() => [] as ModelInfo[]).catch(() => []);
    } catch {
      return [];
    }
  }

  async complete(prompt: string, options: CompletionOptions = {}): Promise<string> {
    const messages: LLMMessage[] = [];
    if (options.systemPrompt) messages.push({ role: "system", content: options.systemPrompt });
    messages.push({ role: "user", content: prompt });
    const res = await this.remote.chat({
      messages,
      model: options.model ?? this.getDefaultModel(),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      responseFormat: options.responseFormat,
    });
    return res.content;
  }

  async chat(messages: LLMMessage[], options: CompletionOptions = {}): Promise<string> {
    const res = await this.remote.chat({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      model: options.model ?? this.getDefaultModel(),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      responseFormat: options.responseFormat,
    });
    return res.content;
  }

  async *streamChat(messages: LLMMessage[], options: CompletionOptions = {}): AsyncIterable<string> {
    // El backend no implementa streaming aún; fallback a no-stream
    const res = await this.chat(messages, options);
    yield res;
  }

  async completeJson<T = unknown>(prompt: string, options: CompletionOptions = {}): Promise<T> {
    const text = await this.complete(prompt, { ...options, responseFormat: "json" });
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }

  async chatJson<T = unknown>(messages: LLMMessage[], options: CompletionOptions = {}): Promise<T> {
    const text = await this.chat(messages, { ...options, responseFormat: "json" });
    try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
  }
}

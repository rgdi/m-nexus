// OpenRouter provider.
// OpenRouter expone una API OpenAI-compatible: https://openrouter.ai/api/v1/chat/completions
// Documentación: https://openrouter.ai/docs

import { requestUrl } from "obsidian";
import { LLMMessage, CompletionOptions, LLMStatus, ModelInfo, MNexusSettings } from "../types";
import { OPENROUTER_DEFAULT_BASE, OPENROUTER_POPULAR_MODELS } from "../constants";
import { LLMProvider } from "./provider";
import { Logger } from "../utils/logger";

export class OpenRouterProvider implements LLMProvider {
  readonly id = "openrouter" as const;
  readonly name = "OpenRouter";

  constructor(
    private settings: MNexusSettings,
    private log: Logger
  ) {}

  isConfigured(): boolean {
    return Boolean(this.settings.openrouterApiKey?.trim());
  }

  async getStatus(): Promise<LLMStatus> {
    if (!this.isConfigured()) {
      return { provider: "openrouter", configured: false, error: "Falta API key" };
    }
    return { provider: "openrouter", configured: true, model: this.settings.llmModel };
  }

  async listModels(): Promise<ModelInfo[]> {
    // OpenRouter expone /models. Si falla, devolvemos la lista popular local.
    try {
      const res = await requestUrl({
        url: `${this.baseUrl()}/models`,
        method: "GET",
        headers: { Authorization: `Bearer ${this.settings.openrouterApiKey}` },
        throw: false,
      });
      if (res.status === 200) {
        const json = res.json as { data: { id: string; name?: string; context_length?: number }[] };
        return json.data.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          provider: "openrouter" as const,
          contextWindow: m.context_length,
          supportsJson: true,
        }));
      }
      this.log.warn(`OpenRouter /models devolvió ${res.status}, usando lista local.`);
    } catch (e) {
      this.log.warn(`OpenRouter /models falló: ${(e as Error).message}, usando lista local.`);
    }
    return OPENROUTER_POPULAR_MODELS.map((m) => ({ ...m, provider: "openrouter" as const }));
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<string> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  async chat(messages: LLMMessage[], options?: CompletionOptions): Promise<string> {
    if (!this.isConfigured()) throw new Error("OpenRouter: API key no configurada.");
    const model = options?.model ?? this.settings.llmModel;
    const body = {
      model,
      messages,
      temperature: options?.temperature ?? this.settings.llmTemperature,
      max_tokens: options?.maxTokens ?? this.settings.llmMaxTokens,
      ...(options?.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
      ...(options?.stop ? { stop: options.stop } : {}),
    };
    const res = await requestUrl({
      url: `${this.baseUrl()}/chat/completions`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md/plugin/m-nexus",
        "X-Title": "M-NEXUS",
      },
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      const err = (res.json as { error?: { message?: string } })?.error?.message ?? res.text;
      throw new Error(`OpenRouter ${res.status}: ${err}`);
    }
    const json = res.json as { choices: { message: { content: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "";
    return content;
  }

  /**
   * Chat con streaming SSE. Emite tokens a medida que llegan.
   * Formato OpenRouter: { choices: [{ delta: { content: "..." } }] } por chunk.
   */
  async *streamChat(messages: LLMMessage[], options?: CompletionOptions): AsyncIterable<string> {
    if (!this.isConfigured()) throw new Error("OpenRouter: API key no configurada.");
    const model = options?.model ?? this.settings.llmModel;
    const body = {
      model,
      messages,
      temperature: options?.temperature ?? this.settings.llmTemperature,
      max_tokens: options?.maxTokens ?? this.settings.llmMaxTokens,
      stream: true,
    };
    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openrouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md/plugin/m-nexus",
        "X-Title": "M-NEXUS",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) throw new Error("OpenRouter: response sin body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Procesar líneas SSE (terminan en \n\n)
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          if (!data) continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // línea no parseable, seguir
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async completeJson<T = unknown>(prompt: string, options?: CompletionOptions): Promise<T> {
    const raw = await this.complete(prompt, { ...options, responseFormat: "json" });
    return this.extractJson<T>(raw);
  }

  async chatJson<T = unknown>(messages: LLMMessage[], options?: CompletionOptions): Promise<T> {
    const raw = await this.chat(messages, { ...options, responseFormat: "json" });
    return this.extractJson<T>(raw);
  }

  private baseUrl(): string {
    return this.settings.openrouterBaseUrl?.replace(/\/+$/, "") || OPENROUTER_DEFAULT_BASE;
  }

  /** Extrae JSON de una respuesta que puede traerlo envuelto en markdown o con preámbulo. */
  private extractJson<T>(raw: string): T {
    const trimmed = raw.trim();
    // 1) JSON directo
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      /* sigue */
    }
    // 2) JSON envuelto en ```json ... ```
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim()) as T;
      } catch {
        /* sigue */
      }
    }
    // 3) JSON embebido: primer array u objeto balanceado
    const arrStart = trimmed.indexOf("[");
    const objStart = trimmed.indexOf("{");
    let start = -1;
    let end = -1;
    if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
      start = arrStart;
      end = trimmed.lastIndexOf("]");
    } else if (objStart >= 0) {
      start = objStart;
      end = trimmed.lastIndexOf("}");
    }
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as T;
      } catch {
        /* sigue */
      }
    }
    throw new Error(`OpenRouter: no se pudo parsear JSON. Respuesta cruda: ${raw.slice(0, 300)}…`);
  }
}

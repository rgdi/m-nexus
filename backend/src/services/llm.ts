// LLMService: proxy a Ollama local o OpenRouter. Selecciona por disponibilidad
// y por el campo "model" del request.

import { config } from "../config.js";
import { logger } from "../utils/log.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class LLMService {
  async ollamaAvailable(): Promise<boolean> {
    if (process.env.MOCK_OLLAMA === "1") return true;
    try {
      const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async openrouterAvailable(): Promise<boolean> {
    if (process.env.MOCK_OPENROUTER === "1") return true;
    return Boolean(config.openrouterApiKey);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (process.env.MOCK_OLLAMA === "1" || process.env.MOCK_OPENROUTER === "1") {
      return this.mockChat(req);
    }
    // Heurística: si el modelo contiene ":" o "/", probablemente es OpenRouter
    const useOpenRouter = req.model?.includes("/") && config.openrouterApiKey;
    if (useOpenRouter) {
      return this.openrouterChat(req);
    }
    // Por defecto Ollama
    if (await this.ollamaAvailable()) {
      return this.ollamaChat(req);
    }
    // Fallback a OpenRouter
    if (config.openrouterApiKey) {
      return this.openrouterChat(req);
    }
    throw new Error("Ningún provider LLM disponible. Configura OLLAMA_BASE_URL o OPENROUTER_API_KEY.");
  }

  private mockChat(req: ChatRequest): ChatResponse {
    const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
    if (req.responseFormat === "json") {
      return {
        content: JSON.stringify({
          mock: true,
          echo: lastUser.slice(0, 200),
          note: "Esta es una respuesta mock del backend M-NEXUS (MOCK_OLLAMA=1 o MOCK_OPENROUTER=1).",
        }),
        model: req.model ?? "mock-llm",
      };
    }
    return {
      content: `[MOCK LLM] Has preguntado: "${lastUser.slice(0, 200)}". Esta es una respuesta simulada del backend M-NEXUS para tests.`,
      model: req.model ?? "mock-llm",
    };
  }

  private async ollamaChat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model ?? "llama3",
        messages: req.messages,
        stream: false,
        options: {
          temperature: req.temperature ?? 0.7,
          num_predict: req.maxTokens ?? 2048,
        },
        format: req.responseFormat === "json" ? "json" : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { message: { content: string }; model: string };
    return { content: data.message.content, model: data.model };
  }

  private async openrouterChat(req: ChatRequest): Promise<ChatResponse> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openrouterApiKey}`,
        "HTTP-Referer": "https://mnexus.app",
      },
      body: JSON.stringify({
        model: req.model ?? "meta-llama/llama-3-8b-instruct",
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
        response_format: req.responseFormat === "json" ? { type: "json_object" } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter error: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      model: string;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const content = data.choices[0]?.message.content ?? "";
    return {
      content,
      model: data.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }
}

// LLMService: proxy a Ollama local o OpenRouter. Selecciona por disponibilidad
// y por el campo "model" del request.

import { config } from "../config.js";
import { logger, logNetwork, logOp, logError } from "../utils/log.js";
import { E, ErrorCategory } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";

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
  /** v0.51: provider explicito. Si no, se autodetecta del model name. */
  provider?: "ollama" | "openai" | "anthropic" | "openrouter";
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class LLMService {
  async ollamaAvailable(): Promise<boolean> {
    if (process.env.MOCK_OLLAMA === "1") return true;
    return await safeCallOrNull<boolean>({
      component: "llm",
      code: "EC-LLM-001",
      message: "ollamaAvailable check failed",
      context: { baseUrl: config.ollamaBaseUrl },
      op: async () => {
        const res = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
        logNetwork("GET", `${config.ollamaBaseUrl}/api/tags`, { statusCode: res.status, durationMs: 0 });
        return res.ok;
      },
    }) ?? false;
  }

  async openrouterAvailable(): Promise<boolean> {
    if (process.env.MOCK_OPENROUTER === "1") return true;
    return Boolean(config.openrouterApiKey);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const r = await safeCallAsync<ChatResponse>({
      component: "llm",
      code: "EC-LLM-002",
      message: "chat failed",
      context: { model: req.model, messageCount: req.messages.length, responseFormat: req.responseFormat },
      op: async () => {
        if (process.env.MOCK_OLLAMA === "1" || process.env.MOCK_OPENROUTER === "1" || process.env.MOCK_LLM === "1") {
          return this.mockChat(req);
        }
        // v0.51: dispatch por provider explicito o por convencion de model name
        const provider = req.provider ?? this.detectProvider(req.model);
        if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
          return await this.anthropicChat(req);
        }
        if (provider === "openai" && process.env.OPENAI_API_KEY) {
          return await this.openaiChat(req);
        }
        if (provider === "openrouter" && config.openrouterApiKey) {
          return await this.openrouterChat(req);
        }
        // Fallback chain
        const useOpenRouter = req.model?.includes("/") && config.openrouterApiKey;
        if (useOpenRouter) {
          return await this.openrouterChat(req);
        }
        if (await this.ollamaAvailable()) {
          return await this.ollamaChat(req);
        }
        if (config.openrouterApiKey) {
          return await this.openrouterChat(req);
        }
        throw E.llm("EC-LLM-003", "No LLM provider available", {
          context: { hasOllama: !!config.ollamaBaseUrl, hasOpenRouter: !!config.openrouterApiKey, hasAnthropic: !!process.env.ANTHROPIC_API_KEY, hasOpenAI: !!process.env.OPENAI_API_KEY },
          hint: "Configure OLLAMA_BASE_URL, OPENROUTER_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY env vars",
        });
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  }

  /** v0.51: detecta provider por convencion de model name */
  private detectProvider(model?: string): "ollama" | "openai" | "anthropic" | "openrouter" {
    if (!model) return "ollama";
    if (model.startsWith("claude-") || model.startsWith("claude3")) return "anthropic";
    if (model.startsWith("gpt-") || model.startsWith("o1")) return "openai";
    if (model.includes("/")) return "openrouter";
    return "ollama";
  }

  /** v0.51: cliente OpenAI */
  private async openaiChat(req: ChatRequest): Promise<ChatResponse> {
    return await safeCallAsync<ChatResponse>({
      component: "llm",
      code: "EC-LLM-008",
      message: "openaiChat failed",
      context: { model: req.model, baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com" },
      op: async () => {
        const start = Date.now();
        const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: req.model ?? "gpt-4o-mini",
            messages: req.messages,
            temperature: req.temperature ?? 0.7,
            max_tokens: req.maxTokens ?? 2048,
            response_format: req.responseFormat === "json" ? { type: "json_object" } : undefined,
          }),
        });
        const durationMs = Date.now() - start;
        logNetwork("POST", `${base}/v1/chat/completions`, { statusCode: res.status, durationMs });
        if (!res.ok) {
          const t = await res.text();
          throw E.llm("EC-LLM-009", "OpenAI error", {
            context: { status: res.status, body: t.substring(0, 500), durationMs },
            hint: "Check OPENAI_API_KEY and model name",
          });
        }
        const data = (await res.json()) as {
          choices: { message: { content: string } }[];
          model: string;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        const content = data.choices[0]?.message.content ?? "";
        logOp("llm", "openai ok", true, { model: data.model, durationMs, contentLen: content.length });
        return {
          content,
          model: data.model,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
        };
      },
    }).then((r) => {
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    });
  }

  /** v0.51: cliente Anthropic Messages API */
  private async anthropicChat(req: ChatRequest): Promise<ChatResponse> {
    return await safeCallAsync<ChatResponse>({
      component: "llm",
      code: "EC-LLM-010",
      message: "anthropicChat failed",
      context: { model: req.model },
      op: async () => {
        const start = Date.now();
        // Anthropic usa system message aparte
        const systemMsg = req.messages.find((m) => m.role === "system")?.content;
        const rest = req.messages.filter((m) => m.role !== "system");
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: req.model ?? "claude-3-5-sonnet-20241022",
            max_tokens: req.maxTokens ?? 2048,
            system: systemMsg ?? undefined,
            messages: rest,
            temperature: req.temperature ?? 0.7,
          }),
        });
        const durationMs = Date.now() - start;
        logNetwork("POST", "https://api.anthropic.com/v1/messages", { statusCode: res.status, durationMs });
        if (!res.ok) {
          const t = await res.text();
          throw E.llm("EC-LLM-011", "Anthropic error", {
            context: { status: res.status, body: t.substring(0, 500), durationMs },
            hint: "Check ANTHROPIC_API_KEY and model name",
          });
        }
        const data = (await res.json()) as {
          content: { text: string; type: string }[];
          model: string;
          usage?: { input_tokens: number; output_tokens: number };
        };
        const content = data.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
        logOp("llm", "anthropic ok", true, { model: data.model, durationMs, contentLen: content.length });
        return {
          content,
          model: data.model,
          usage: data.usage ? {
            promptTokens: data.usage.input_tokens,
            completionTokens: data.usage.output_tokens,
            totalTokens: data.usage.input_tokens + data.usage.output_tokens,
          } : undefined,
        };
      },
    }).then((r) => {
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    });
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

  // TODO(FASE-4-streaming): add chatStream(req) → AsyncIterable<{delta: string}>
  // using Ollama's stream:true mode (NDJSON over /api/chat). Wire to Fastify
  // reply.raw for SSE. Keep LLMService.chat() non-streaming as default so
  // existing call sites stay stable. See FASE 4 prep in .hermes/plans.
  private async ollamaChat(req: ChatRequest): Promise<ChatResponse> {
    const r = await safeCallAsync<ChatResponse>({
      component: "llm",
      code: "EC-LLM-004",
      message: "ollamaChat failed",
      context: { model: req.model ?? "llama3", baseUrl: config.ollamaBaseUrl },
      op: async () => {
        const start = Date.now();
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
        const durationMs = Date.now() - start;
        logNetwork("POST", `${config.ollamaBaseUrl}/api/chat`, {
          statusCode: res.status, durationMs,
        });
        if (!res.ok) {
          const text = await res.text();
          throw E.llm("EC-LLM-005", "Ollama API error", {
            context: { status: res.status, body: text.substring(0, 500), durationMs },
            hint: "Check Ollama is running, model is available, and request format is valid",
          });
        }
        const data = (await res.json()) as { message: { content: string }; model: string };
        logOp("llm", "ollama ok", true, { model: data.model, durationMs, contentLen: data.message.content.length });
        return { content: data.message.content, model: data.model };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  }

  private async openrouterChat(req: ChatRequest): Promise<ChatResponse> {
    const r = await safeCallAsync<ChatResponse>({
      component: "llm",
      code: "EC-LLM-006",
      message: "openrouterChat failed",
      context: { model: req.model ?? "meta-llama/llama-3-8b-instruct" },
      op: async () => {
        const start = Date.now();
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
        const durationMs = Date.now() - start;
        logNetwork("POST", "https://openrouter.ai/api/v1/chat/completions", {
          statusCode: res.status, durationMs,
        });
        if (!res.ok) {
          const text = await res.text();
          throw E.llm("EC-LLM-007", "OpenRouter API error", {
            context: { status: res.status, body: text.substring(0, 500), durationMs },
            hint: "Check OPENROUTER_API_KEY, model availability, and rate limits",
          });
        }
        const data = (await res.json()) as {
          choices: { message: { content: string } }[];
          model: string;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };
        const content = data.choices[0]?.message.content ?? "";
        logOp("llm", "openrouter ok", true, {
          model: data.model, durationMs,
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
        });
        return {
          content,
          model: data.model,
          usage: data.usage ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          } : undefined,
        };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  }
}

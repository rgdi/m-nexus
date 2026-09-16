// AI provider factory.
// v2.6.0: real, swappable providers — Ollama / OpenRouter / OpenAI-compatible / Mock.
// Stored config: data/ai-config.json (gitignored, 0600).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logOp, logError } from "../utils/log.js";

export type AIProvider = "ollama" | "openrouter" | "openai" | "mock";

export interface AIConfig {
  provider: AIProvider;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  enabledAt: number;
}

export interface GenOpts {
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}

function configFile(): string {
  return join(dataDir(), "ai-config.json");
}

export async function getAIConfig(): Promise<AIConfig> {
  const f = configFile();
  if (!existsSync(f)) {
    return { provider: "mock", model: "mock-1", enabledAt: Date.now() };
  }
  try {
    return JSON.parse(await readFile(f, "utf8"));
  } catch (e) {
    logError("ai", { code: "EC-AI-001", category: "AI", message: "ai-config.json corrupt", context: { error: (e as Error).message } });
    return { provider: "mock", model: "mock-1", enabledAt: Date.now() };
  }
}

export async function setAIConfig(cfg: AIConfig): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(configFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  logOp("ai", `ai-config saved: provider=${cfg.provider} model=${cfg.model}`, true, {});
}

export async function generateCompletion(prompt: string, opts?: GenOpts): Promise<string> {
  const cfg = await getAIConfig();
  return generateWith(prompt, cfg, opts);
}

async function generateWith(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  switch (cfg.provider) {
    case "ollama":     return ollamaComplete(prompt, cfg, opts);
    case "openrouter": return openRouterComplete(prompt, cfg, opts);
    case "openai":     return openAIComplete(prompt, cfg, opts);
    case "mock":       return mockComplete(prompt);
  }
}

async function ollamaComplete(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  const url = `${(cfg.baseUrl || "http://localhost:11434").replace(/\/$/, "")}/api/generate`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      stream: false,
      options: {
        temperature: opts?.temperature ?? cfg.temperature ?? 0.7,
        num_predict: opts?.maxTokens ?? cfg.maxTokens ?? 2048,
      },
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json() as { response?: string };
  return data.response ?? "";
}

async function openRouterComplete(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  return chatCompletion(prompt, "https://openrouter.ai/api/v1/chat/completions", cfg, opts);
}

async function openAIComplete(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  if (!cfg.baseUrl) throw new Error("OpenAI-compatible needs baseUrl");
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  return chatCompletion(prompt, url, cfg, opts);
}

async function chatCompletion(prompt: string, url: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        ...(opts?.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt },
      ],
      temperature: opts?.temperature ?? cfg.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? cfg.maxTokens ?? 2048,
    }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
  const data = await r.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

async function mockComplete(prompt: string): Promise<string> {
  return `[mock AI] You asked: "${prompt.slice(0, 80)}". Configure a real provider in Settings to get real answers.`;
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getAIConfig();
  try {
    const out = await generateWith("ping", cfg, { maxTokens: 16 });
    return { ok: true, message: `Provider ${cfg.provider} responded: "${out.slice(0, 80)}"` };
  } catch (e) {
    return { ok: false, message: `${cfg.provider} failed: ${(e as Error).message}` };
  }
}

export const AI_PROVIDERS: { value: AIProvider; label: string; needsBaseUrl?: boolean; needsApiKey?: boolean }[] = [
  { value: "mock", label: "Skip (mock — no real AI)" },
  { value: "ollama", label: "Ollama (local, private, free)", needsBaseUrl: true },
  { value: "openrouter", label: "OpenRouter (pay-per-use, many models)", needsApiKey: true },
  { value: "openai", label: "OpenAI-compatible (LM Studio, vLLM, etc.)", needsBaseUrl: true, needsApiKey: true },
];

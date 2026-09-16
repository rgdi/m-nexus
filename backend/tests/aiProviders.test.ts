import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let origFetch: typeof globalThis.fetch;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ai-test-"));
  process.env.DATA_DIR = tmp;
  origFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
  rmSync(tmp, { recursive: true, force: true });
});

describe("aiProviders", () => {
  it("defaults to mock provider", async () => {
    const { getAIConfig, generateCompletion } = await import("../src/services/aiProviders.js");
    expect((await getAIConfig()).provider).toBe("mock");
    const out = await generateCompletion("hello");
    expect(out).toContain("[mock AI]");
  });

  it("ollama calls /api/generate with model + prompt", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: "hi from llama" }),
    })) as any;
    globalThis.fetch = fetchMock;
    const { generateCompletion, setAIConfig, getAIConfig } = await import("../src/services/aiProviders.js");
    await setAIConfig({ provider: "ollama", baseUrl: "http://x:11434", model: "llama3", enabledAt: 0 });
    const out = await generateCompletion("test");
    expect(out).toBe("hi from llama");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x:11434/api/generate");
    expect(JSON.parse(init.body).model).toBe("llama3");
    expect(JSON.parse(init.body).stream).toBe(false);
    expect(JSON.parse(init.body).prompt).toBe("test");
  });

  it("openrouter uses Bearer + openrouter.ai host", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "or reply" } }] }),
    })) as any;
    globalThis.fetch = fetchMock;
    const { generateCompletion, setAIConfig } = await import("../src/services/aiProviders.js");
    await setAIConfig({ provider: "openrouter", apiKey: "sk-or-1", model: "meta/llama", enabledAt: 0 });
    const out = await generateCompletion("test");
    expect(out).toBe("or reply");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-or-1");
    expect(JSON.parse(init.body).model).toBe("meta/llama");
  });

  it("openai-compatible uses custom baseUrl", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "local" } }] }),
    })) as any;
    globalThis.fetch = fetchMock;
    const { generateCompletion, setAIConfig } = await import("../src/services/aiProviders.js");
    await setAIConfig({ provider: "openai", baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio", model: "local", enabledAt: 0 });
    await generateCompletion("test");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
  });

  it("openai-compatible without apiKey omits Authorization header", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "x" } }] }),
    })) as any;
    globalThis.fetch = fetchMock;
    const { generateCompletion, setAIConfig } = await import("../src/services/aiProviders.js");
    await setAIConfig({ provider: "openai", baseUrl: "http://localhost:1234/v1", model: "x", enabledAt: 0 });
    await generateCompletion("test");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("testConnection returns ok on success", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: "pong" }),
    })) as any;
    const { testConnection, setAIConfig } = await import("../src/services/aiProviders.js");
    await setAIConfig({ provider: "ollama", baseUrl: "http://x", model: "y", enabledAt: 0 });
    const r = await testConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("ollama");
  });

  it("testConnection returns error on failure", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
    })) as any;
    const { testConnection, setAIConfig } = await import("../src/services/aiProviders.js");
    await setAIConfig({ provider: "ollama", baseUrl: "http://x", model: "y", enabledAt: 0 });
    const r = await testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("500");
  });
});

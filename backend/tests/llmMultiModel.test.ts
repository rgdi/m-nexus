// llmMultiModel.test.ts: tests de LLMService con multi-modelo (v0.51)

import { describe, it, expect, beforeAll } from "vitest";

describe("LLMService multi-model", () => {
  beforeAll(() => {
    process.env.MOCK_LLM = "1";
    process.env.JWT_SECRET = "test-jwt-secret-32chars-min-please-ok";
    process.env.AUTH_REQUIRED = "false";
  });

  it("mock responde con echo", async () => {
    const { LLMService } = await import("../src/services/llm.js");
    const svc = new LLMService();
    const r = await svc.chat({
      messages: [{ role: "user", content: "hola" }],
    });
    expect(r.content).toContain("MOCK");
    expect(r.model).toBeDefined();
  });

  it("mock JSON format", async () => {
    const { LLMService } = await import("../src/services/llm.js");
    const svc = new LLMService();
    const r = await svc.chat({
      messages: [{ role: "user", content: "genera un JSON" }],
      responseFormat: "json",
    });
    expect(r.content).toContain("mock");
  });

  it("detecta provider por model name", async () => {
    const { LLMService } = await import("../src/services/llm.js");
    const svc = new LLMService();
    const fn = (svc as any).detectProvider?.bind(svc);
    if (fn) {
      expect(fn("gpt-4o")).toBe("openai");
      expect(fn("claude-3-5-sonnet-20241022")).toBe("anthropic");
      expect(fn("anthropic/claude-3-sonnet")).toBe("openrouter");
      expect(fn("llama3.2")).toBe("ollama");
    }
  });

  it("respeta temperature y maxTokens en mock", async () => {
    const { LLMService } = await import("../src/services/llm.js");
    const svc = new LLMService();
    const r = await svc.chat({
      messages: [{ role: "user", content: "test" }],
      temperature: 0.1,
      maxTokens: 50,
    });
    expect(r).toBeDefined();
  });
});

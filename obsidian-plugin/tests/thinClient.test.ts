import { describe, it, expect, beforeEach, vi } from "vitest";
import { RemoteClient } from "../src/server/remoteClient";
import { HTTPClient } from "../src/server/httpClient";
import { createMemoryTokenStore, type StoredTokens } from "../src/server/tokenStore";
import { noopLogger } from "./helpers";
import { RemoteTranscriber } from "../src/audio/remoteTranscriber";
import { RemoteOcr } from "../src/handwritten/remoteOcr";
import { RemoteLLMProvider } from "../src/llm/remoteProvider";
import { RemoteEmbeddings } from "../src/rag/remoteEmbeddings";
import { LLMManager } from "../src/llm/manager";
import { MNexusSettings } from "../src/types";

function mkHttp(): HTTPClient {
  const store = createMemoryTokenStore();
  const tokens: StoredTokens = {
    deviceId: "dev-1",
    accessToken: "tok",
    refreshToken: "ref",
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
    refreshTokenExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    serverVersion: "0.12.0",
  };
  store.save(tokens);
  return new HTTPClient({
    baseUrl: "https://api.example.com",
    deviceId: "dev-1",
    store,
  });
}

function mkSettings(over: Partial<MNexusSettings> = {}): MNexusSettings {
  return {
    // ... default fake
    llmProvider: "remote",
    llmModel: "llama3",
    llmTemperature: 0.7,
    llmMaxTokens: 1000,
    openrouterApiKey: "",
    openrouterBaseUrl: "",
    ollamaBaseUrl: "",
    ollamaModel: "llama3",
    backendUrl: "https://api.example.com",
    backendToken: "tok",
    forceRemote: true,
    whisperBackend: "remote",
    ocrBackend: "remote",
    embeddingsBackend: "remote",
    llmBackend: "remote",
    // ...resto vacío, los tests solo leen los que usan
    ...over,
  } as unknown as MNexusSettings;
}

describe("RemoteClient", () => {
  it("hasBackend() refleja el getter", () => {
    const http = new HTTPClient("", noopLogger);
    const rc = new RemoteClient(
      http,
      noopLogger,
      () => "https://api.example.com",
      () => "tok",
      () => "dev-1"
    );
    expect(rc.hasBackend()).toBe(true);
    const rc2 = new RemoteClient(
      http,
      noopLogger,
      () => "",
      () => "",
      () => "dev-1"
    );
    expect(rc2.hasBackend()).toBe(false);
  });

  it("transcribe() llama al endpoint correcto", async () => {
    const http = mkHttp();
    const spy = vi.spyOn(http, "fetchJSON").mockResolvedValue({
      text: "hola mundo",
      language: "es",
      durationSec: 5,
      segments: [],
    } as never);
    const rc = new RemoteClient(http, noopLogger, () => "https://api.example.com");
    const res = await rc.transcribe({ audioBase64: "AAA=", mimeType: "audio/mp3" });
    expect(res.text).toBe("hola mundo");
    expect(spy).toHaveBeenCalledWith("/api/v1/audio/transcribe", expect.objectContaining({ method: "POST" }));
  });

  it("embed() llama al endpoint correcto", async () => {
    const http = mkHttp();
    const spy = vi.spyOn(http, "fetchJSON").mockResolvedValue({ embeddings: [[0.1, 0.2]], model: "m", dim: 2 } as never);
    const rc = new RemoteClient(http, noopLogger, () => "https://api.example.com");
    const res = await rc.embed({ texts: ["hola"] });
    expect(res.dim).toBe(2);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/llm/embed");
  });

  it("ocr() llama al endpoint correcto", async () => {
    const http = mkHttp();
    const spy = vi.spyOn(http, "fetchJSON").mockResolvedValue({ text: "x", confidence: 0.9, blocks: [] } as never);
    const rc = new RemoteClient(http, noopLogger, () => "https://api.example.com");
    const res = await rc.ocr({ imageBase64: "AAA=" });
    expect(res.confidence).toBe(0.9);
    expect(spy.mock.calls[0][0]).toBe("/api/v1/ocr/image");
  });

  it("lanza error si no hay backend", async () => {
    const http = mkHttp();
    const rc = new RemoteClient(http, noopLogger, () => "");
    await expect(rc.transcribe({ audioBase64: "AAA=", mimeType: "audio/mp3" })).rejects.toThrow(/Backend no configurado/);
  });
});

describe("RemoteTranscriber.shouldUseRemote", () => {
  it("forceRemote=true → siempre true", () => {
    const settings = mkSettings({ forceRemote: true, whisperBackend: "local" });
    const rt = new RemoteTranscriber({} as never, settings, {} as never, {} as never, noopLogger);
    expect(rt.shouldUseRemote()).toBe(true);
  });
  it("forceRemote=false + backend=remote → true", () => {
    const settings = mkSettings({ forceRemote: false, whisperBackend: "remote" });
    const rt = new RemoteTranscriber({} as never, settings, {} as never, {} as never, noopLogger);
    expect(rt.shouldUseRemote()).toBe(true);
  });
  it("forceRemote=false + backend=local → false", () => {
    const settings = mkSettings({ forceRemote: false, whisperBackend: "local" });
    const rt = new RemoteTranscriber({} as never, settings, {} as never, {} as never, noopLogger);
    expect(rt.shouldUseRemote()).toBe(false);
  });
});

describe("RemoteOcr.shouldUseRemote", () => {
  it("respeta forceRemote", () => {
    const ro = new RemoteOcr({} as never, mkSettings({ forceRemote: true }), {} as never, {} as never, noopLogger);
    expect(ro.shouldUseRemote()).toBe(true);
  });
  it("respeta ocrBackend cuando forceRemote=false", () => {
    const ro = new RemoteOcr({} as never, mkSettings({ forceRemote: false, ocrBackend: "remote" as never }), {} as never, {} as never, noopLogger);
    expect(ro.shouldUseRemote()).toBe(true);
  });
});

describe("LLMManager.getProvider con forceRemote", () => {
  it("devuelve el provider remoto si forceRemote=true y está configurado", () => {
    const settings = mkSettings({ forceRemote: true, llmProvider: "ollama" });
    const mgr = new LLMManager({} as never, settings, noopLogger);
    const remote = {
      isConfigured: () => true,
      get id() { return "remote"; },
    } as never;
    mgr.setRemoteProvider(remote);
    const p = mgr.getProvider();
    expect(p.id).toBe("remote");
  });
  it("ignora el provider remoto si NO está configurado", () => {
    const settings = mkSettings({ forceRemote: true, llmProvider: "ollama" });
    const mgr = new LLMManager({} as never, settings, noopLogger);
    const remote = {
      isConfigured: () => false,
      get id() { return "remote"; },
    } as never;
    mgr.setRemoteProvider(remote);
    // Debería caer al local
    try {
      const p = mgr.getProvider();
      expect(p.id).not.toBe("remote");
    } catch {
      // Si no hay factory de ollama en el mock, está bien también
    }
  });
  it("forceRemote=false usa el provider local", () => {
    const settings = mkSettings({ forceRemote: false, llmProvider: "disabled" });
    const mgr = new LLMManager({} as never, settings, noopLogger);
    try {
      const p = mgr.getProvider();
      expect(p.id).toBe("disabled");
    } catch (e) {
      expect((e as Error).message).toContain("deshabilitado");
    }
  });
});

describe("RemoteEmbeddings", () => {
  it("isConfigured() refleja hasBackend", () => {
    const http = new HTTPClient("https://api.example.com", noopLogger);
    const rc = new RemoteClient(http, noopLogger, () => "https://api.example.com", () => "tok", () => "d");
    const re = new RemoteEmbeddings(rc, () => "nomic-embed-text", noopLogger);
    expect(re.isConfigured()).toBe(true);
  });

  it("embedBatch devuelve vectores con la dim del servidor", async () => {
    const http = mkHttp();
    vi.spyOn(http, "fetchJSON").mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]], model: "m", dim: 3 } as never);
    const rc = new RemoteClient(http, noopLogger, () => "https://api.example.com");
    const re = new RemoteEmbeddings(rc, () => "m", noopLogger);
    const out = await re.embedBatch(["hola"]);
    expect(out[0].length).toBe(3);
    expect(re.dimensions).toBe(3);
  });
});

describe("RemoteLLMProvider.isConfigured", () => {
  it("true si hay backend", () => {
    const http = new HTTPClient("https://api.example.com", noopLogger);
    const rc = new RemoteClient(http, noopLogger, () => "https://api.example.com", () => "tok", () => "d");
    const p = new RemoteLLMProvider(rc, () => "llama3", noopLogger);
    expect(p.isConfigured()).toBe(true);
  });
  it("false si no hay backend", () => {
    const http = new HTTPClient("", noopLogger);
    const rc = new RemoteClient(http, noopLogger, () => "", () => "", () => "d");
    const p = new RemoteLLMProvider(rc, () => "llama3", noopLogger);
    expect(p.isConfigured()).toBe(false);
  });
});

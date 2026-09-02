// RemoteClient: thin-client estricto que habla SOLO con el backend.
// v0.12: usa el nuevo HTTPClient con auto-refresh de JWT.

import { Logger } from "../utils/logger";
import { HTTPClient } from "./httpClient";

export interface BackendHealth {
  status: "ok" | "degraded" | "down";
  version: string;
  providers: {
    whisper: "available" | "unavailable";
    ollama: "available" | "unavailable";
    openrouter: "available" | "unavailable";
    tesseract: "available" | "unavailable";
    embeddings: "available" | "unavailable";
  };
  uptimeSec: number;
  mock?: { whisper?: boolean; ollama?: boolean; openrouter?: boolean; tesseract?: boolean };
}

export interface TranscribeRequest {
  audioBase64: string;
  mimeType: string;
  language?: string;
  prompt?: string;
  model?: string;
}

export interface TranscribeResponse {
  text: string;
  language: string;
  durationSec: number;
  segments: { start: number; end: number; text: string }[];
}

export interface LLMChatRequest {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  stream?: boolean;
}

export interface LLMChatResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
}

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  dim: number;
}

export interface OCRRequest {
  imageBase64: string;
  language?: string;
  preprocess?: boolean;
}

export interface OCRResponse {
  text: string;
  confidence: number;
  blocks: { text: string; bbox: { x: number; y: number; w: number; h: number }; confidence: number }[];
}

export class RemoteClient {
  constructor(
    private http: HTTPClient,
    private log: Logger,
    private getUrl: () => string
  ) {}

  hasBackend(): boolean {
    return Boolean(this.getUrl());
  }

  // ─── Health ────────────────────────────────────────────────────────

  async health(): Promise<BackendHealth> {
    if (!this.hasBackend()) throw new Error("Backend no configurado");
    return this.http.fetchJSON<BackendHealth>("/api/v1/health");
  }

  // ─── Whisper ───────────────────────────────────────────────────────

  async transcribe(req: TranscribeRequest): Promise<TranscribeResponse> {
    if (!this.hasBackend()) throw new Error("Backend no configurado");
    return this.http.fetchJSON<TranscribeResponse>("/api/v1/audio/transcribe", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ─── LLM ──────────────────────────────────────────────────────────

  async chat(req: LLMChatRequest): Promise<LLMChatResponse> {
    if (!this.hasBackend()) throw new Error("Backend no configurado");
    return this.http.fetchJSON<LLMChatResponse>("/api/v1/llm/chat", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ─── Embeddings ───────────────────────────────────────────────────

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.hasBackend()) throw new Error("Backend no configurado");
    return this.http.fetchJSON<EmbeddingResponse>("/api/v1/llm/embed", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ─── OCR ──────────────────────────────────────────────────────────

  async ocr(req: OCRRequest): Promise<OCRResponse> {
    if (!this.hasBackend()) throw new Error("Backend no configurado");
    return this.http.fetchJSON<OCRResponse>("/api/v1/ocr/image", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ─── Flashcards ──────────────────────────────────────────────────

  async generateFlashcards(req: { topic: string; count?: number; level?: string }): Promise<{ cards: { front: string; back: string; tags: string[] }[] }> {
    return this.http.fetchJSON("/api/v1/flashcards/generate", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ─── PDF diff ────────────────────────────────────────────────────

  async diffPdf(req: { pathA: string; pathB: string; opts?: { contextChars?: number } }): Promise<{ changes: { kind: string; before: string; after: string; line: number }[] }> {
    return this.http.fetchJSON("/api/v1/pdf/diff", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  // ─── WebSocket streaming ────────────────────────────────────────

  /** Abre WS al endpoint de streaming con JWT. Devuelve la URL completa. */
  buildStreamUrl(): string {
    const base = this.getUrl().replace(/\/+$/, "");
    const token = this.http.getAccessToken();
    return `${base}/api/v1/audio/transcribe/stream?token=${encodeURIComponent(token ?? "")}`;
  }

  // ─── Audit ──────────────────────────────────────────────────────

  async getAudit(limit = 50): Promise<{ entries: Array<{ id: string; action: string; timestamp: number; allowed: boolean }> }> {
    return this.http.fetchJSON(`/api/v1/audit?limit=${limit}`);
  }

  // ─── Auth management ───────────────────────────────────────────

  async revoke(): Promise<void> {
    return this.http.revoke();
  }
}

// v0.28: Cliente HTTP para el backend AI (thin client).
// Toda la lógica pesada (vault eval, proposals, knowledge graph, quiz, FSRS, cross-relevance)
// se ejecuta en el backend. El plugin solo:
//   1) Recolecta snapshots del vault
//   2) Envía al backend
//   3) Recibe y muestra resultados
//
// Si el backend está caído, hay fallbacks locales (offline-first).

import { Notice, requestUrl, type App } from "obsidian";
import type { NoteSnapshot } from "../ai/vaultEvaluator.js";
import type { VaultEvaluation } from "../ai/vaultEvaluator.js";
import type { Proposal } from "../ai/contentProposals.js";
import { KnowledgeGraph, createConcept, type KnowledgeLayer } from "../study/knowledgeLayers.js";

export interface AIRequestOptions {
  /** Si el backend falla, usar fallback local. */
  fallbackToLocal: boolean;
  /** Timeout en ms. */
  timeoutMs: number;
}

const DEFAULT_OPTIONS: AIRequestOptions = {
  fallbackToLocal: true,
  timeoutMs: 8000,
};

export interface BackendConfig {
  url: string;
  authToken: string;
}

/** Resuelve la config del backend desde los settings del plugin. */
export function getBackendConfig(app: App): BackendConfig | null {
  // Lee de app.loadData si existe; si no, fallback a localStorage/env
  try {
    const data = (app as any).loadData?.() ?? {};
    const url = data.backendUrl ?? "http://localhost:4321";
    const authToken = data.authToken ?? "";
    return { url, authToken };
  } catch {
    return null;
  }
}

async function call<T = any>(
  config: BackendConfig,
  method: string,
  path: string,
  body?: any,
  options: Partial<AIRequestOptions> = {},
): Promise<T | null> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await requestUrl({
      url: `${config.url}${path}`,
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: config.authToken ? `Bearer ${config.authToken}` : "",
      },
      body: body ? JSON.stringify(body) : undefined,
      throw: false,
    });
    clearTimeout(timeoutHandle);
    if (res.status >= 200 && res.status < 300) {
      return res.json as T;
    }
    throw new Error(`Backend ${method} ${path} → ${res.status}`);
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (opts.fallbackToLocal) {
      new Notice(`⚠️ Backend no disponible, usando fallback local: ${(err as Error).message}`);
    } else {
      new Notice(`❌ Error de backend: ${(err as Error).message}`);
    }
    return null;
  }
}

// ── API del cliente ──

/** Evalúa el vault enviando snapshots al backend. */
export async function backendEvalVault(
  config: BackendConfig,
  snapshots: NoteSnapshot[],
): Promise<VaultEvaluation | null> {
  return call<VaultEvaluation>(config, "POST", "/api/v1/ai/vault/eval", { snapshots });
}

/** Genera proposals en el backend. */
export async function backendGenerateProposals(
  config: BackendConfig,
  evaluation: VaultEvaluation,
  snapshots: NoteSnapshot[],
  configOpts: { autoGenerateTypes: string[]; minScore: number; maxPendingProposals: number },
): Promise<{ proposals: Proposal[]; stats: { generated: number; byType: Record<string, number> } } | null> {
  return call(config, "POST", "/api/v1/ai/proposals/generate", {
    evaluation,
    snapshots,
    config: configOpts,
  });
}

/** Actualiza mastery de un concept. */
export async function backendUpdateMastery(
  config: BackendConfig,
  userId: string,
  conceptId: string,
  layer: KnowledgeLayer,
  correct: boolean,
  confidence: number,
): Promise<{ ok: boolean } | null> {
  return call(config, "POST", `/api/v1/ai/knowledge/${encodeURIComponent(userId)}/mastery`, {
    conceptId, layer, correct, confidence,
  });
}

/** Obtiene la siguiente pregunta del quiz. */
export async function backendNextQuestion(
  config: BackendConfig,
  userId: string,
  sessionConfig?: any,
): Promise<{ question: any; session: any } | null> {
  return call(config, "POST", `/api/v1/ai/quiz/${encodeURIComponent(userId)}/session`, { config: sessionConfig });
}

/** Envía respuesta a una pregunta. */
export async function backendAnswerQuestion(
  config: BackendConfig,
  userId: string,
  answer: string,
  confidence: number,
  timeMs: number,
): Promise<{ result: any; session: any } | null> {
  return call(config, "POST", `/api/v1/ai/quiz/${encodeURIComponent(userId)}/answer`, {
    answer, confidence, timeMs,
  });
}

/** Analiza cross-relevance. */
export async function backendCrossRelevance(
  config: BackendConfig,
  source: { path: string; content: string },
  candidates: Array<{ path: string; content: string }>,
  minSimilarity = 0.3,
): Promise<{ matches: Array<{ path: string; similarity: number; sharedTerms: string[] }> } | null> {
  return call(config, "POST", "/api/v1/ai/cross-relevance/analyze", {
    source, candidates, minSimilarity,
  });
}

/** Aplica review FSRS en el backend. */
export async function backendFsrsReview(
  config: BackendConfig,
  card: { stability: number; difficulty: number; reps: number; lapses: number; lastRating?: number; lastReview?: number },
  rating: 1 | 2 | 3 | 4,
): Promise<{ card: any; intervalDays: number } | null> {
  return call(config, "POST", "/api/v1/ai/fsrs/review", { card, rating });
}

// ── Fallbacks locales (offline-first) ──
// Si el backend está caído, devolvemos null. Las clases locales del plugin
// (VaultEvaluator, StudyOrchestrator, etc.) siguen existiendo como respaldo,
// pero por defecto se intenta el backend primero.

/** Evalúa el vault: backend primero, fallback local si falla. */
export async function evalVaultWithFallback(
  app: App,
  snapshots: NoteSnapshot[],
): Promise<VaultEvaluation> {
  const config = getBackendConfig(app);
  if (config) {
    const result = await backendEvalVault(config, snapshots);
    if (result) return result;
  }
  // Fallback: usar el VaultEvaluator local (offline)
  const { VaultEvaluator } = await import("../ai/vaultEvaluator.js");
  return new VaultEvaluator().evaluate(snapshots);
}

/** Genera proposals: backend primero, fallback local si falla. */
export async function generateProposalsWithFallback(
  app: App,
  evaluation: VaultEvaluation,
  snapshots: NoteSnapshot[],
  configOpts: { autoGenerateTypes: string[]; minScore: number; maxPendingProposals: number },
): Promise<{ proposals: Proposal[]; stats: { generated: number; byType: Record<string, number> } }> {
  const config = getBackendConfig(app);
  if (config) {
    const result = await backendGenerateProposals(config, evaluation, snapshots, configOpts);
    if (result) return result;
  }
  // Fallback: el StudyOrchestrator local (degraded, sin HTTP)
  const { StudyOrchestrator } = await import("../ai/studyOrchestrator.js");
  const orch = new StudyOrchestrator(app as any, configOpts as any);
  await orch.runAnalysis();
  const proposals = orch.getProposals().list({ status: "pending" });
  return { proposals, stats: { generated: proposals.length, byType: {} } };
}

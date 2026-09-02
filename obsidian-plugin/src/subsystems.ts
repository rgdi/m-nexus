// v0.28: Subsistemas lazy — se cargan bajo demanda para mantener el bundle ligero.
//
// ANTES: main.ts importaba directamente ~30 módulos pesados (RAG, LLM, calendar,
// embeddings, vector store, flashcards, drawing, etc.) totalizando >500KB.
//
// AHORA: main.ts solo importa el HTTP client. Cada subsistema se carga dinámicamente
// cuando el usuario invoca una acción que lo necesita. Esto reduce el bundle inicial
// en ~80%.

import type { App } from "obsidian";
import type { MNexusSettings } from "./types";
import { Logger } from "./utils/logger";

type LazySubsystem<T> = () => Promise<T>;

const log = new Logger("lazy");

/** Carga perezosa con cache. */
function lazy<T>(name: string, loader: () => Promise<T>): LazySubsystem<T> {
  let cached: T | null = null;
  return async () => {
    if (cached) return cached;
    log.info(`Cargando subsistema lazy: ${name}…`);
    try {
      cached = await loader();
      log.info(`Subsistema lazy cargado: ${name}`);
      return cached;
    } catch (err) {
      log.error(`Error cargando subsistema lazy: ${name}`, { error: err as Error });
      throw err;
    }
  };
}

// ── Subsistemas (lazy) ───────────────────────────────────

export const loadWhisperInstaller = lazy("WhisperInstaller", () => import("./audio/whisperInstaller").then(m => m.WhisperInstaller));

export const loadFlashcardGenerator = lazy("FlashcardGenerator", () => import("./flashcards/generator").then(m => m.FlashcardGenerator));

export const loadTemplateManager = lazy("TemplateManager", () => import("./flashcards/templates").then(m => m.TemplateManager));

export const loadCoverageAuditor = lazy("CoverageAuditor", () => import("./coverage/auditor").then(m => m.CoverageAuditor));

export const loadHandwrittenOcr = lazy("HandwrittenOcr", () => import("./handwritten/ocr").then(m => m.HandwrittenOcr));

export const loadFSRS = lazy("FSRS", () => import("./fsrs/scheduler").then(m => ({ review: m.review, newCard: m.newCard })));

export const loadLoadBalancer = lazy("LoadBalancer", () => import("./fsrs/loadBalancer").then(m => m.rebalance));

export const loadLLMManager = lazy("LLMManager", () => import("./llm/manager").then(m => m.LLMManager));

export const loadCalendarSync = lazy("CalendarSync", () => import("./calendar/sync").then(m => m.CalendarSync));

export const loadDrawingManager = lazy("DrawingManager", () => import("./drawing/manager").then(m => m.DrawingManager));

export const loadRAG = lazy("RAG", () => Promise.all([
  import("./rag/indexer"),
  import("./rag/embeddings"),
  import("./rag/vectorStore"),
  import("./rag/retriever"),
  import("./rag/chat"),
]).then(([indexer, emb, vs, ret, chat]) => ({
  Indexer: indexer.Indexer,
  OpenAIEmbeddings: emb.OpenAIEmbeddings,
  VectorStore: vs.VectorStore,
  Retriever: ret.Retriever,
  RAGChat: chat.RAGChat,
})));

export const loadSyncManager = lazy("SyncManager", () => import("./sync/manager").then(m => m.SyncManager));

export const loadHTRManager = lazy("HTRManager", () => import("./htr/manager").then(m => m.HTRManager));

export const loadStudyOrchestrator = lazy("StudyOrchestrator", () => import("./ai/studyOrchestrator").then(m => m.StudyOrchestrator));

export const loadVaultEvaluator = lazy("VaultEvaluator", () => import("./ai/vaultEvaluator").then(m => m.VaultEvaluator));

export const loadKnowledgeGraph = lazy("KnowledgeGraph", () => import("./study/knowledgeLayers").then(m => ({ KnowledgeGraph: m.KnowledgeGraph, createConcept: m.createConcept })));

export const loadAdaptiveQuiz = lazy("AdaptiveQuiz", () => import("./study/adaptiveQuiz").then(m => ({ AdaptiveQuizEngine: m.AdaptiveQuizEngine, createQuizSession: m.createQuizSession })));

export const loadExamScheduler = lazy("ExamScheduler", () => import("./exams/scheduler").then(m => m.ExamScheduler));

/** Tamaño aproximado de cada subsistema para debugging. */
export const SUBSYSTEM_SIZES: Record<string, string> = {
  WhisperInstaller: "~3KB",
  FlashcardGenerator: "~12KB",
  TemplateManager: "~8KB",
  CoverageAuditor: "~4KB",
  HandwrittenOcr: "~8KB",
  FSRS: "~6KB",
  LoadBalancer: "~6KB",
  LLMManager: "~4KB",
  CalendarSync: "~8KB",
  DrawingManager: "~20KB",
  RAG: "~37KB (pesado)",
  SyncManager: "~10KB",
  HTRManager: "~21KB",
  StudyOrchestrator: "~22KB (en backend)",
  VaultEvaluator: "~7KB (en backend)",
  KnowledgeGraph: "~9KB (en backend)",
  AdaptiveQuiz: "~13KB (en backend)",
  CrossRelevance: "~10KB (en backend)",
  ExamScheduler: "~15KB",
};

// v0.28: Rutas HTTP para AI (vault eval, proposals, knowledge graph, quiz).
// v0.46: proposalsV2 usa LLM real (Ollama/OpenRouter) con fallback heurístico.
// v0.46: /fsrs/review usa ts-fsrs real (no la implementación con W hardcoded).
// v0.48: /ai/tutor endpoint que conecta AITutorService (RAG) con el frontend.

import { FastifyInstance } from "fastify";
import { evaluateVault, type NoteSnapshotInput, type VaultEvaluationResult } from "../services/vaultEval.js";
import { generateProposalsV2, type GenerateProposalsInput, type GenerateProposalsResult, clearProposalCache } from "../services/proposalsV2.js";
import { AITutorService, type TutorContext } from "../services/aiTutorService.js";
import { LazySearchService } from "../services/lazySearchService.js";
import { SearchService } from "../services/searchService.js";
import { LLMService } from "../services/llm.js";
import type { Proposal } from "../services/proposalsTypes.js";
import {
  KnowledgeGraph, addConcept, getConcept, findByTerm, allConcepts,
  updateMastery, markShown, findGaps, nextQuestion, answerQuestion,
  newSession, sessionResult, type QuizSession, type QuizQuestion,
  type AnswerResult, type SessionResult, type KnowledgeLayer,
  type KnowledgeConcept, createConcept,
} from "../services/adaptiveQuiz.js";
import { fsrs, generatorParameters, createEmptyCard, Rating, type Card as FsrsCard, type Grade } from "ts-fsrs";
import { logger, logOp } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";

// Store en memoria de sesiones y graphs por usuario
// En producción, esto debería estar en Redis o similar para multi-instancia
const userGraphs = new Map<string, KnowledgeGraph>();
const userSessions = new Map<string, QuizSession>();

function getOrCreateGraph(userId: string): KnowledgeGraph {
  let g = userGraphs.get(userId);
  if (!g) {
    g = { concepts: new Map(), byTerm: new Map() };
    userGraphs.set(userId, g);
  }
  return g;
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // ── Vault evaluation ────────────────────────────────
  app.post<{ Body: { snapshots?: NoteSnapshotInput[] } }>(
    "/vault/eval",
    async (req) => {
      const { snapshots } = req.body;
      const r = await safeCallAsync({
        component: "eval",
        code: "EC-EVAL-010",
        message: "vault eval endpoint failed",
        context: { snapshotCount: snapshots?.length ?? 0 },
        op: async () => {
          if (!snapshots) {
            throw E.val("EC-EVAL-011", "snapshots requerido", {
              context: { bodyKeys: Object.keys(req.body ?? {}) },
              hint: "Send { snapshots: [...] }",
            });
          }
          const result = evaluateVault(snapshots);
          logOp("eval", "vault eval", true, { snapshotCount: snapshots.length, totalNotes: result.totalNotes });
          return result;
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // ── Proposals (v0.46: usa LLM real con fallback heurístico) ───
  app.post<{ Body: GenerateProposalsInput }>(
    "/proposals/generate",
    async (req) => {
      const r = await safeCallAsync({
        component: "prop",
        code: "EC-PROP-010",
        message: "proposals generate failed",
        context: { snapshotCount: req.body?.snapshots?.length ?? 0 },
        op: async () => {
          const result = await generateProposalsV2(req.body);
          logOp("prop", "generate", true, { total: result.stats.generated, source: result.stats.source ?? "llm" });
          return result;
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // POST /api/v1/ai/proposals/cache/clear - forzar regeneracion
  app.post("/proposals/cache/clear", async () => {
    clearProposalCache();
    return { ok: true, cleared: true };
  });

  // ── Knowledge graph: state operations ────────────────
  app.get<{ Params: { userId: string } }>(
    "/knowledge/:userId",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      return {
        concepts: allConcepts(g),
        stats: {
          total: allConcepts(g).length,
          byMastery: {
            low: allConcepts(g).filter((c) => (Object.values(c.layers) as Array<{ mastery: number }>).some((l) => l.mastery < 0.4)).length,
            mid: allConcepts(g).filter((c) => (Object.values(c.layers) as Array<{ mastery: number }>).some((l) => l.mastery >= 0.4 && l.mastery < 0.8)).length,
            high: allConcepts(g).filter((c) => (Object.values(c.layers) as Array<{ mastery: number }>).every((l) => l.mastery >= 0.8)).length,
          },
        },
      };
    },
  );

  app.post<{
    Params: { userId: string };
    Body: { id: string; term: string; aliases?: string[]; category?: string; tags?: string[] };
  }>(
    "/knowledge/:userId/concept",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const { id, term, ...rest } = req.body;
      const concept = createConcept(id, term, rest);
      addConcept(g, concept);
      return { ok: true, concept };
    },
  );

  app.post<{
    Params: { userId: string };
    Body: { conceptId: string; layer: KnowledgeLayer; correct: boolean; confidence?: number };
  }>(
    "/knowledge/:userId/mastery",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const { conceptId, layer, correct, confidence } = req.body;
      updateMastery(g, conceptId, layer, correct, confidence ?? 1);
      return { ok: true, concept: getConcept(g, conceptId) };
    },
  );

  app.get<{ Params: { userId: string }; Querystring: { limit?: string } }>(
    "/knowledge/:userId/gaps",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const limit = parseInt(req.query.limit ?? "20", 10);
      return { gaps: findGaps(g, limit) };
    },
  );

  // ── Quiz sessions ───────────────────────────────────
  app.post<{ Params: { userId: string }; Body: { config?: Partial<QuizSession["config"]> } }>(
    "/quiz/:userId/session",
    async (req) => {
      const session = newSession(req.body.config ?? {});
      userSessions.set(req.params.userId, session);
      return session;
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/quiz/:userId/next",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const session = userSessions.get(req.params.userId);
      if (!session) return { error: "no active session" };
      const q = nextQuestion(g, session);
      return { question: q, session };
    },
  );

  app.post<{
    Params: { userId: string };
    Body: { answer: string; confidence?: number; timeMs?: number };
  }>(
    "/quiz/:userId/answer",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const session = userSessions.get(req.params.userId);
      if (!session) return { error: "no active session" };
      const result = answerQuestion(g, session, req.body.answer, req.body.confidence ?? 1, req.body.timeMs ?? 0);
      return { result, session };
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/quiz/:userId/result",
    async (req) => {
      const session = userSessions.get(req.params.userId);
      if (!session) return { error: "no active session" };
      return { result: sessionResult(session) };
    },
  );

  // ── Cross-relevance (delegated) ─────────────────────
  app.post<{
    Body: { source: { path: string; content: string }; candidates: Array<{ path: string; content: string }>; minSimilarity?: number };
  }>(
    "/cross-relevance/analyze",
    async (req) => {
      const { source, candidates, minSimilarity = 0.3 } = req.body;
      const tokenize = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/\W+/)
          .filter((t) => t.length > 3);
      const aSet = new Set(tokenize(source.content));
      const matches: Array<{ path: string; similarity: number; sharedTerms: string[] }> = [];
      for (const c of candidates) {
        if (c.path === source.path) continue;
        const bSet = new Set(tokenize(c.content));
        const inter = new Set([...aSet].filter((x) => bSet.has(x)));
        const union = new Set([...aSet, ...bSet]);
        if (union.size === 0) continue;
        const sim = inter.size / union.size;
        if (sim >= minSimilarity) {
          matches.push({ path: c.path, similarity: sim, sharedTerms: Array.from(inter).slice(0, 10) });
        }
      }
      matches.sort((a, b) => b.similarity - a.similarity);
      return { matches: matches.slice(0, 10) };
    },
  );

  // ── FSRS review (v0.46: usa ts-fsrs real, NO weights hardcoded) ──
  const fsrsScheduler = fsrs(generatorParameters({
    enable_fuzz: false,  // en API deshabilitamos fuzz para resultados deterministas
    enable_short_term: true,
    request_retention: 0.9,
  }));

  app.post<{
    Body: {
      card?: Partial<FsrsCard>;
      rating: 1 | 2 | 3 | 4;  // 1=Again, 2=Hard, 3=Good, 4=Easy
    };
  }>(
    "/fsrs/review",
    async (req) => {
      const r = await safeCallAsync({
        component: "fsrs",
        code: "EC-FSRS-001",
        message: "fsrs review failed",
        context: { rating: req.body?.rating, hasCard: !!req.body?.card },
        op: async () => {
          const { card, rating } = req.body;
          if (!rating || rating < 1 || rating > 4) {
            throw E.val("EC-FSRS-002", "rating must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy)", {
              context: { rating },
            });
          }
          // Construir card base (existente o nueva)
          const now = new Date();
          const baseCard: FsrsCard = card ? { ...createEmptyCard(now), ...card } : createEmptyCard(now);
          // Mapear rating
          const ratingEnum: Rating = rating === 1 ? Rating.Again
            : rating === 2 ? Rating.Hard
            : rating === 3 ? Rating.Good
            : Rating.Easy;
          const result = fsrsScheduler.repeat(baseCard, now);
          const reviewed = result[ratingEnum as Grade];
          if (!reviewed) {
            throw E.llm("EC-FSRS-003", "FSRS scheduler returned no result", {});
          }
          logOp("fsrs", "review", true, {
            rating,
            newState: reviewed.card.state,
            newStability: reviewed.card.stability,
            intervalDays: reviewed.card.scheduled_days,
          });
          return {
            card: reviewed.card,
            intervalDays: reviewed.card.scheduled_days,
            log: reviewed.log,
          };
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // ── v0.48: AI Tutor (RAG sobre notas) ────────────────────────
  // Endpoint usado por el frontend Flutter (ai_tutor_client.dart).
  // Estrategia:
  //   1. Recibe { question, context?, history? }
  //   2. Si hay context (cliente ya buscó notas relevantes), usa directo
  //   3. Si no, intenta SearchService → falla rápido si no hay vault
  //   4. Llama a LLMService (Ollama local) con el contexto
  //   5. Si falla → fallback extractivo
  app.post<{ Body: { question: string; context?: string; history?: Array<{ role: string; content: string }> } }>(
    "/tutor",
    async (req) => {
      const { question, context } = req.body;
      if (!question || typeof question !== "string" || question.trim().length === 0) {
        throw E.val("EC-TUTOR-001", "question es requerido", {
          context: { bodyKeys: Object.keys(req.body ?? {}) },
          hint: "Send { question: 'tu pregunta' }",
        });
      }
      const r = await safeCallAsync({
        component: "tutor",
        code: "EC-TUTOR-002",
        message: "tutor endpoint failed",
        context: { questionLen: question.length, hasContext: !!context },
        op: async () => {
          // Construir contexto. Prioridad: client-provided context > vault search
          let snippets: Array<{ path: string; snippet: string; score: number }> = [];
          let relevantNotes: string[] = [];
          if (context && context.trim().length > 0) {
            // El cliente (LocalTutorService) ya buscó y envió el contexto.
            // Lo usamos como "best snippet" para el fallback extractivo.
            snippets = [{ path: "(client-provided context)", snippet: context, score: 1.0 }];
            relevantNotes = ["(client-provided context)"];
          } else {
            // Sin contexto del cliente → intentar RAG local con el vault del backend.
            // Esto solo funciona si el backend tiene acceso al vault, lo cual
            // típicamente NO es el caso (vault está en el dispositivo). Por eso
            // devolvemos "empty" y el cliente cae al LocalTutorService.
            snippets = [];
            relevantNotes = [];
          }
          const ctx: TutorContext = {
            query: question,
            relevantNotes,
            snippets,
          };
          const response = await new AITutorService(
            // v0.48: LazySearchService no crashea si better-sqlite3 falla.
            // Si falla → returns []. El flujo con context forneado por el cliente
            // funciona igual (snippets del cliente, no del backend search).
            new LazySearchService() as unknown as SearchService,
            new LLMService(),
          ).askWithContext(question, ctx);
          logOp("tutor", "ask", true, {
            questionLen: question.length,
            sourceCount: response.sources.length,
            confidence: response.confidence,
            source: response.source,
          });
          return response;
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // v0.51: chat multi-modelo. Acepta provider explicito o autodetect por model.
  app.post<{
    Body: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      model?: string;
      provider?: "ollama" | "openai" | "anthropic" | "openrouter";
      temperature?: number;
      maxTokens?: number;
    };
  }>(
    "/llm/chat",
    async (req) => {
      const { messages, model, provider, temperature, maxTokens } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        throw E.val("EC-LLM-CHAT-001", "messages es requerido", {
          hint: "Send { messages: [{role:'user', content:'hola'}] }",
        });
      }
      const r = await safeCallAsync({
        component: "llm-chat",
        code: "EC-LLM-CHAT-002",
        message: "llm chat failed",
        context: { provider, model, messageCount: messages.length },
        op: async () => {
          const llm = new LLMService();
          const resp = await llm.chat({ messages, model, provider, temperature, maxTokens });
          return { content: resp.content, model: resp.model, usage: resp.usage };
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );

  // v0.51: lista los providers disponibles (configurados con API keys)
  app.get("/llm/providers", async () => {
    return {
      providers: [
        {
          id: "ollama",
          name: "Ollama (local)",
          available: process.env.OLLAMA_BASE_URL != null,
          models: ["llama3.2", "llama3.2:70b", "qwen2.5:7b", "mistral", "phi3", "gemma2:9b"],
        },
        {
          id: "openai",
          name: "OpenAI",
          available: process.env.OPENAI_API_KEY != null,
          models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1-preview"],
        },
        {
          id: "anthropic",
          name: "Anthropic",
          available: process.env.ANTHROPIC_API_KEY != null,
          models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
        },
        {
          id: "openrouter",
          name: "OpenRouter",
          available: process.env.OPENROUTER_API_KEY != null,
          models: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o", "google/gemini-pro-1.5", "meta-llama/llama-3.1-405b-instruct"],
        },
      ],
    };
  });

  // v0.49.11: AI summarize + extract flashcards from attachment text (PDF/PPT)
  app.post<{ Body: { text?: string; fileName?: string; maxCards?: number; maxSummaryLen?: number } }>(
    "/summarize",
    async (req) => {
      const { text, fileName, maxCards = 10, maxSummaryLen = 800 } = req.body ?? {};
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        throw E.val("EC-AI-201", "text is required", {
          hint: "Send { text: 'extracted PDF/PPT text', fileName: 'clase1.pdf' }",
        });
      }

      const r = await safeCallAsync({
        component: "ai-summarize",
        code: "EC-AI-202",
        message: "summarize failed",
        context: { textLen: text.length, fileName, maxCards, maxSummaryLen },
        op: async () => {
          // Try LLM first; fall back to extractive.
          let summary = "";
          let cards: Array<{ front: string; back: string }> = [];

          try {
            const llm = new LLMService();
            const prompt = `Resume el siguiente texto en maximo ${maxSummaryLen} caracteres, en espanol, en 3-5 puntos clave con viñetas.\n\nTEXTO:\n${text.slice(0, 4000)}`;
            const llmResp = await llm.chat({
              messages: [{ role: "user", content: prompt }],
              temperature: 0.2,
              maxTokens: 600,
            });
            summary = llmResp.content;

            const cardsPrompt = `Del siguiente texto, genera hasta ${maxCards} pares pregunta/respuesta de estudio en formato JSON estricto: [{"front":"pregunta","back":"respuesta"},...]. Las preguntas deben cubrir los conceptos mas importantes. Sin explicaciones extra, solo el JSON.\n\nTEXTO:\n${text.slice(0, 4000)}`;
            const cardsResp = await llm.chat({
              messages: [{ role: "user", content: cardsPrompt }],
              temperature: 0.3,
              maxTokens: 1000,
            });
            // Extract JSON
            const m = /\[.*\]/s.exec(cardsResp.content);
            if (m) {
              try {
                cards = JSON.parse(m[0]);
              } catch {
                cards = [];
              }
            }
          } catch (e) {
            // LLM no disponible → fallback extractivo
            summary = _extractiveSummary(text, maxSummaryLen);
            cards = _extractiveFlashcards(text, maxCards);
          }

          if (!summary) summary = _extractiveSummary(text, maxSummaryLen);
          if (cards.length === 0) cards = _extractiveFlashcards(text, maxCards);

          return {
            fileName: fileName ?? null,
            summary,
            cards,
            source: "ai",
            stats: {
              inputLen: text.length,
              summaryLen: summary.length,
              cardCount: cards.length,
            },
          };
        },
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    },
  );
}

/**
 * v0.49.11: extractive summary (fallback cuando LLM no esta disponible).
 * Devuelve las N primeras frases, hasta maxLen caracteres.
 */
function _extractiveSummary(text: string, maxLen: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
  const out: string[] = [];
  let total = 0;
  for (const s of sentences) {
    if (total + s.length > maxLen) break;
    out.push(s);
    total += s.length;
  }
  return out.join(' ').trim() || text.slice(0, maxLen);
}

/**
 * v0.49.11: extractive flashcards: busca frases con '?', o construye
 * Q/A de las primeras oraciones.
 */
function _extractiveFlashcards(text: string, max: number): Array<{ front: string; back: string }> {
  const out: Array<{ front: string; back: string }> = [];
  // Patrón 1: preguntas con ?
  const questions = text.split(/(?<=[?])\s+/).filter(s => s.includes('?') && s.length < 200);
  for (const q of questions.slice(0, max)) {
    // La respuesta = la frase siguiente (si esta en la lista)
    out.push({ front: q.trim(), back: '(revisar texto fuente)' });
  }
  // Patrón 2: si no hay preguntas, hacer "Que dice X?" de la primera frase
  if (out.length === 0) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    for (let i = 0; i < Math.min(max, sentences.length - 1); i += 2) {
      out.push({
        front: `Resume: ${sentences[i].slice(0, 80)}...?`,
        back: sentences[i + 1] || sentences[i],
      });
    }
  }
  return out;
}

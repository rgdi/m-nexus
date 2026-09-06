// v0.28: Rutas HTTP para AI (vault eval, proposals, knowledge graph, quiz).
// Toda la lógica pesada está aquí — el plugin solo envía datos y recibe resultados.

import { FastifyInstance } from "fastify";
import { evaluateVault, type NoteSnapshotInput, type VaultEvaluationResult } from "../services/vaultEval.js";
import { generateProposals, type GenerateProposalsInput, type GenerateProposalsResult } from "../services/proposals.js";
import type { Proposal } from "../services/proposalsTypes.js";
import {
  KnowledgeGraph, addConcept, getConcept, findByTerm, allConcepts,
  updateMastery, markShown, findGaps, nextQuestion, answerQuestion,
  newSession, sessionResult, type QuizSession, type QuizQuestion,
  type AnswerResult, type SessionResult, type KnowledgeLayer,
  type KnowledgeConcept, createConcept,
} from "../services/adaptiveQuiz.js";
import { logger } from "../utils/log.js";

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
  app.post<{ Body: { snapshots: NoteSnapshotInput[] } }>(
    "/api/v1/ai/vault/eval",
    async (req) => {
      const { snapshots } = req.body;
      const result = evaluateVault(snapshots);
      return result;
    },
  );

  // ── Proposals ────────────────────────────────────────
  app.post<{ Body: GenerateProposalsInput }>(
    "/api/v1/ai/proposals/generate",
    async (req) => {
      const result = generateProposals(req.body);
      return result;
    },
  );

  // ── Knowledge graph: state operations ────────────────
  app.get<{ Params: { userId: string } }>(
    "/api/v1/ai/knowledge/:userId",
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
    "/api/v1/ai/knowledge/:userId/concept",
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
    "/api/v1/ai/knowledge/:userId/mastery",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const { conceptId, layer, correct, confidence } = req.body;
      updateMastery(g, conceptId, layer, correct, confidence ?? 1);
      return { ok: true, concept: getConcept(g, conceptId) };
    },
  );

  app.get<{ Params: { userId: string }; Querystring: { limit?: string } }>(
    "/api/v1/ai/knowledge/:userId/gaps",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const limit = parseInt(req.query.limit ?? "20", 10);
      return { gaps: findGaps(g, limit) };
    },
  );

  // ── Quiz sessions ───────────────────────────────────
  app.post<{ Params: { userId: string }; Body: { config?: Partial<QuizSession["config"]> } }>(
    "/api/v1/ai/quiz/:userId/session",
    async (req) => {
      const session = newSession(req.body.config ?? {});
      userSessions.set(req.params.userId, session);
      return session;
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/api/v1/ai/quiz/:userId/next",
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
    "/api/v1/ai/quiz/:userId/answer",
    async (req) => {
      const g = getOrCreateGraph(req.params.userId);
      const session = userSessions.get(req.params.userId);
      if (!session) return { error: "no active session" };
      const result = answerQuestion(g, session, req.body.answer, req.body.confidence ?? 1, req.body.timeMs ?? 0);
      return { result, session };
    },
  );

  app.get<{ Params: { userId: string } }>(
    "/api/v1/ai/quiz/:userId/result",
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
    "/api/v1/ai/cross-relevance/analyze",
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

  // ── FSRS review (delegated) ─────────────────────────
  app.post<{
    Body: {
      card: { stability: number; difficulty: number; reps: number; lapses: number; lastRating?: number; lastReview?: number };
      rating: 1 | 2 | 3 | 4;
    };
  }>(
    "/api/v1/ai/fsrs/review",
    async (req) => {
      const W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.5330, 0.1192, 1.0006, 1.9395, 0.1100, 0.2939, 2.0078, 0.2315, 2.9466];
      const { card, rating } = req.body;
      const DAY = 24 * 3600 * 1000;
      const elapsedDays = card.lastReview ? Math.max(0, (Date.now() - card.lastReview) / DAY) : 0;
      const r = card.stability > 0 ? Math.pow(1 + elapsedDays / (9 * card.stability), -1) : 0;
      let s = card.stability;
      let d = card.difficulty;
      let newLapses = card.lapses;
      if (rating === 1) {
        newLapses += 1;
        s = Math.max(W[2], 0.1);
      } else {
        const increment = Math.exp(W[8]) * (11 - d) * Math.pow(Math.max(s, 0.1), -W[9]) * (Math.exp(W[10] * (1 - r)) - 1);
        s = s * (1 + increment) * (rating === 4 ? W[16] : 1) * (rating === 2 ? W[15] : 1);
        d = Math.min(10, Math.max(1, d - W[6] * (rating - 3)));
      }
      if (card.reps === 0) s = W[rating - 1];
      const intervalDays = Math.max(1, 9 * s * (1 / 0.9 - 1));
      return {
        card: { stability: Math.round(s * 100) / 100, difficulty: Math.round(d * 100) / 100, reps: card.reps + 1, lapses: newLapses, lastReview: Date.now(), lastRating: rating, dueDate: Date.now() + intervalDays * DAY },
        intervalDays: Math.round(intervalDays * 10) / 10,
      };
    },
  );
}

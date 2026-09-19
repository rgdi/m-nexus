// studyPlanner.ts — HTTP routes for v2.8.0 study planner (v2.8.0).
//
// POST /api/v1/study/diagnostic/run      → compute profile from answers
// POST /api/v1/study/diagnostic/generate → generate heuristic questions
// POST /api/v1/study/scheduler/plan      → build study plan from exams + diagnostics
// GET  /api/v1/study/generation/pending  → list pending AI candidates
// POST /api/v1/study/generation/decide   → approve/reject candidate

import type { FastifyPluginAsync } from "fastify";
import {
  computeProfile,
  generateHeuristicQuestions,
  type DiagnosticQuestion,
  type DiagnosticAnswer,
} from "../services/knowledgeDiagnostic.js";
import { planStudy, type Exam, type SchedulerConfig } from "../services/examScheduler.js";
import {
  addCandidate,
  listCandidates,
  decide,
  getCandidate,
  type ApprovalCandidate,
} from "../services/generationApprovals.js";

export const studyPlannerRoutes: FastifyPluginAsync = async (app) => {
  // Generate diagnostic questions from a syllabus text
  app.post("/study/diagnostic/generate", async (req) => {
    const body = (req.body as any) || {};
    if (!body.topicId || !body.syllabus) {
      return { ok: false, error: "topicId and syllabus required" };
    }
    const questions = generateHeuristicQuestions(body.topicId, body.syllabus, body.maxQuestions || 10);
    return { ok: true, questions };
  });

  // Run the diagnostic and compute FSRS profile
  app.post("/study/diagnostic/run", async (req) => {
    const body = (req.body as any) || {};
    const { topicId, questions, answers } = body as {
      topicId: string;
      questions: DiagnosticQuestion[];
      answers: DiagnosticAnswer[];
    };
    if (!topicId || !questions || !answers) {
      return { ok: false, error: "topicId, questions, answers required" };
    }
    const result = computeProfile(topicId, questions, answers);
    return { ok: true, result };
  });

  // Build a study plan
  app.post("/study/scheduler/plan", async (req) => {
    const body = (req.body as any) || {};
    const { exams, diagnostics, config, fromDate } = body as {
      exams: Exam[];
      diagnostics: Record<string, any>;
      config: SchedulerConfig;
      fromDate?: string;
    };
    if (!exams) {
      return { ok: false, error: "exams required" };
    }
    const sessions = planStudy(
      exams,
      diagnostics || {},
      fromDate ? new Date(fromDate) : new Date(),
      config || { dailyMinutes: 60, targetRetention: 0.9 },
    );
    return { ok: true, sessions, totalSessions: sessions.length };
  });

  // AI candidates: pending list
  app.get("/study/generation/pending", async (req) => {
    const topicId = (req.query as any)?.topicId;
    const items = await listCandidates(topicId, "pending");
    return { ok: true, candidates: items };
  });

  // AI candidates: all
  app.get("/study/generation/all", async (req) => {
    const topicId = (req.query as any)?.topicId;
    const items = await listCandidates(topicId);
    return { ok: true, candidates: items };
  });

  // AI candidates: approve or reject
  app.post("/study/generation/decide", async (req, reply) => {
    const body = (req.body as any) || {};
    if (!body.id || !body.status) {
      return reply.code(400).send({ ok: false, error: "id and status required" });
    }
    const updated = await decide(body.id, body.status, body.reason);
    if (!updated) {
      return reply.code(404).send({ ok: false, error: "candidate not found" });
    }
    // v2.10.0: when status === "approved" and kind is "cloze" or "flashcard",
    // auto-create the flashcard via the flashcards service so the 1-click
    // approval is enough — no manual second step.
    let createdFlashcard: Record<string, unknown> | null = null;
    if (updated.status === "approved" && (updated.kind === "cloze" || updated.kind === "flashcard")) {
      // v2.11.0 + v2.12.0: auto-tagging — heuristic first, then LLM if heuristic
      // returned < 2 tags. LLM uses the same aiProviders pipeline (Ollama,
      // OpenRouter, OpenAI-compatible). Falls back to heuristic-only on failure.
      let autoTags: string[] = [];
      try {
        const { aiTagsForFlashcard } = await import("../services/aiTagger.js");
        const payloadObj = (updated.payload || {}) as { front?: string; back?: string };
        autoTags = await aiTagsForFlashcard(
          updated.preview || payloadObj.front || "",
          updated.answer || payloadObj.back || "",
          [updated.kind],
          { llmTimeoutMs: 3000, maxLlmTags: 3 },
        );
      } catch (e) { /* no-op if helper unavailable */ }
      // Write directly to data/flashcards.json — the canonical flashcard store.
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const fp = path.resolve(process.cwd(), "data", "flashcards.json");
        const raw = await fs.readFile(fp, "utf-8").catch(() => "[]");
        const list: Record<string, unknown>[] = JSON.parse(raw);
        const id = "fc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        const payload = (updated.payload || {}) as {
          front?: string; back?: string; subject?: string; tags?: string[];
        };
        const card = {
          id,
          front: updated.preview || payload.front || "",
          back: updated.answer || payload.back || "",
          subject: payload.subject || updated.topicId,
          tags: payload.tags && payload.tags.length ? payload.tags : (autoTags.length ? autoTags : [updated.kind]),
          sourceNoteId: updated.sourceNoteId,
          sourceExcerpt: (updated.preview || "").slice(0, 80),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          state: "new",
          stability: 1,
          difficulty: 5,
          due: Date.now(),
          reps: 0,
          lapses: 0,
        };
        list.push(card);
        await fs.writeFile(fp, JSON.stringify(list, null, 2));
        createdFlashcard = card;
      } catch (e) {
        console.warn("[decide] flashcard create failed:", e);
      }
    }
    return { ok: true, candidate: updated, flashcard: createdFlashcard };
  });

  // AI candidates: add a new one (used by AI integration or test)
  app.post("/study/generation/add", async (req) => {
    const body = (req.body as any) || {};
    const c = await addCandidate({
      topicId: body.topicId,
      sourceNoteId: body.sourceNoteId,
      kind: body.kind || "flashcard",
      payload: body.payload || {},
      preview: body.preview || "",
      answer: body.answer || "",
      confidence: body.confidence ?? 0.8,
    });
    return { ok: true, candidate: c };
  });

  // v2.9.0: day-by-day FSRS simulator
  app.post("/study/fsrs/simulate", async (req) => {
    const { simulate } = await import("../services/fsrsSimulator.js");
    const body = (req.body as any) || {};
    const config = body.config || body;
    if (!config.cards || !Array.isArray(config.cards)) {
      return { ok: false, error: "config.cards required" };
    }
    const result = simulate(config);
    return { ok: true, ...result };
  });
};

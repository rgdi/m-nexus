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
    const items = listCandidates(topicId, "pending");
    return { ok: true, candidates: items };
  });

  // AI candidates: all
  app.get("/study/generation/all", async (req) => {
    const topicId = (req.query as any)?.topicId;
    const items = listCandidates(topicId);
    return { ok: true, candidates: items };
  });

  // AI candidates: approve or reject
  app.post("/study/generation/decide", async (req) => {
    const body = (req.body as any) || {};
    if (!body.id || !body.status) {
      return { ok: false, error: "id and status required" };
    }
    const updated = decide(body.id, body.status, body.reason);
    if (!updated) {
      return { ok: false, error: "candidate not found" };
    }
    return { ok: true, candidate: updated };
  });

  // AI candidates: add a new one (used by AI integration or test)
  app.post("/study/generation/add", async (req) => {
    const body = (req.body as any) || {};
    const c = addCandidate({
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
};

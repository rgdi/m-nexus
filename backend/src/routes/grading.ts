// routes/grading.ts — Answer evaluation endpoints (v2.36.0).
//
//   POST /api/v1/grade/typed   { userAnswer, expected, context?, useLlm? }
//   POST /api/v1/grade/mcq     { cardId, chosenIndex }
//
// Both are public-path friendly: the deterministic grader needs no
// user data, and the MCQ grader re-reads the card from storage so a
// tampered client cannot fake a correct answer.

import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gradeTypedAnswer, gradeMultipleChoice } from "../services/grading.js";
import { logOp } from "../utils/log.js";

const DATA = join(process.cwd(), "data", "flashcards.json");

async function loadCards(): Promise<any[]> {
  try {
    const raw = await readFile(DATA, "utf-8");
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

export function registerGradingRoutes(app: FastifyInstance): void {
  // ---- POST /api/v1/grade/typed ----
  app.post<{
    Body: { userAnswer?: string; expected?: string; context?: string; useLlm?: boolean };
  }>("/api/v1/grade/typed", async (req) => {
    const t0 = Date.now();
    const { userAnswer = "", expected = "", context, useLlm = true } = req.body ?? {};
    if (typeof expected !== "string" || expected.trim() === "") {
      return { error: "expected is required", code: "EC-GRADE-001" };
    }
    const grade = await gradeTypedAnswer(userAnswer, expected, context, { useLlm });
    logOp("grading", "typed", true, {
      gradedBy: grade.gradedBy,
      score: grade.score,
      durationMs: Date.now() - t0,
    });
    return grade;
  });

  // ---- POST /api/v1/grade/mcq ----
  app.post<{
    Body: { cardId?: string; options?: string[]; correctIndex?: number; chosenIndex?: number; explanation?: string };
  }>("/api/v1/grade/mcq", async (req) => {
    const body = req.body ?? {};
    // Prefer reading the card from storage: it is the source of truth.
    if (body.cardId) {
      const cards = await loadCards();
      const card = cards.find((c) => c?.id === body.cardId);
      if (!card) {
        return { error: "card not found", code: "EC-GRADE-002" };
      }
      const options: string[] = Array.isArray(card.options) ? card.options : [];
      if (options.length < 2) {
        return { error: "card has no options", code: "EC-GRADE-003" };
      }
      return gradeMultipleChoice(
        options,
        typeof card.correctIndex === "number" ? card.correctIndex : 0,
        typeof body.chosenIndex === "number" ? body.chosenIndex : -1,
        typeof card.explanation === "string" ? card.explanation : "",
      );
    }
    // Fallback: the caller supplies the full question (used by the
    // generation preview before the card is persisted).
    if (Array.isArray(body.options) && typeof body.correctIndex === "number") {
      return gradeMultipleChoice(
        body.options,
        body.correctIndex,
        typeof body.chosenIndex === "number" ? body.chosenIndex : -1,
        typeof body.explanation === "string" ? body.explanation : "",
      );
    }
    return { error: "cardId or options+correctIndex required", code: "EC-GRADE-004" };
  });
}

// routes/grading.ts — Answer evaluation endpoints (v2.36.0, hardened v2.37.0).
//
//   POST /api/v1/grade/typed   { userAnswer, expected, context?, useLlm? }
//   POST /api/v1/grade/mcq     { cardId, chosenIndex }  |  { options, correctIndex, chosenIndex }
//
// ── v2.37.0 security pass ──────────────────────────────────────────
// The v2.36.0 comment here said "Both are public-path friendly: the
// deterministic grader needs no user data, and the MCQ grader re-reads
// the card from storage". The first half was true. The second was the
// problem: re-reading the card *and returning the verdict* means any
// anonymous caller could walk `/api/v1/grade/mcq` with a cardId and read
// out the answer key for every card in the store.
//
// Three changes:
//
//   1. The `cardId` branch requires a bearer token. The
//      `options + correctIndex` branch stays open because the caller
//      already supplied the answer key themselves — that is the
//      generation preview, and authenticating it buys nothing.
//   2. `useLlm: true` is the expensive path (it can reach a paid
//      provider), so it is rate limited and requires auth. The
//      deterministic grader stays open: it is pure string math and
//      costs nothing.
//   3. MCQ grading is rate limited too, since it reads and parses the
//      whole card store on every call.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gradeTypedAnswer, gradeMultipleChoice } from "../services/grading.js";
import { logOp } from "../utils/log.js";

const DATA = join(process.cwd(), "data", "flashcards.json");

/** Sliding window per caller key. Small, in-process, and bounded. */
const buckets = new Map<string, { n: number; resetAt: number }>();
const MAX_BUCKETS = 5000;

function rateLimit(key: string, perMinute: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }
  let b = buckets.get(key);
  if (!b || b.resetAt < now) {
    b = { n: 0, resetAt: now + 60_000 };
    buckets.set(key, b);
  }
  if (b.n >= perMinute) {
    return { ok: false, retryAfterMs: b.resetAt - now };
  }
  b.n++;
  return { ok: true, retryAfterMs: 0 };
}

export function __resetGradingBuckets(): void {
  buckets.clear();
}

/**
 * Caller identity for rate limiting: the authenticated subject when
 * present, otherwise the peer address. Prefixing keeps "user:abc" and
 * "ip:1.2.3.4" from colliding in the same bucket map.
 */
function callerKey(req: FastifyRequest): string {
  const sub = (req as any).auth?.sub;
  if (sub) return `user:${sub}`;
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return `ip:${ip}`;
}

function isAuthed(req: FastifyRequest): boolean {
  return !!(req as any).auth?.sub;
}

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
  }>("/api/v1/grade/typed", async (req, reply) => {
    const t0 = Date.now();
    const { userAnswer = "", expected = "", context, useLlm = true } = req.body ?? {};
    if (typeof expected !== "string" || expected.trim() === "") {
      return { error: "expected is required", code: "EC-GRADE-001" };
    }

    // The LLM branch can spend money. Anonymous callers get the
    // deterministic grade only, which is the useful path for an offline
    // or pre-login preview anyway.
    const wantsLlm = useLlm === true;
    if (wantsLlm) {
      if (!isAuthed(req)) {
        return {
          error: "LLM grading requires authentication",
          code: "EC-GRADE-005",
          hint: "send Authorization: Bearer <access token>, or omit useLlm for deterministic grading",
        };
      }
      const rl = rateLimit(callerKey(req), 30);
      if (!rl.ok) {
        logOp("grading", "typed rate limited", false, { retryAfterMs: rl.retryAfterMs });
        reply.header("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
        reply.code(429);
        return { error: "Rate limit exceeded", code: "EC-GRADE-006", retryAfterMs: rl.retryAfterMs };
      }
    }

    const grade = await gradeTypedAnswer(userAnswer, expected, context, { useLlm: wantsLlm });
    logOp("grading", "typed", true, {
      gradedBy: grade.gradedBy,
      score: grade.score,
      llm: wantsLlm,
      authed: isAuthed(req),
      durationMs: Date.now() - t0,
    });
    return grade;
  });

  // ---- POST /api/v1/grade/mcq ----
  app.post<{
    Body: { cardId?: string; options?: string[]; correctIndex?: number; chosenIndex?: number; explanation?: string };
  }>("/api/v1/grade/mcq", async (req, reply) => {
    const body = req.body ?? {};

    const rl = rateLimit(callerKey(req), 120);
    if (!rl.ok) {
      reply.header("Retry-After", Math.ceil(rl.retryAfterMs / 1000).toString());
      reply.code(429);
      return { error: "Rate limit exceeded", code: "EC-GRADE-006", retryAfterMs: rl.retryAfterMs };
    }

    if (body.cardId) {
      // Reading a card by id discloses its options and its answer key.
      if (!isAuthed(req)) {
        logOp("grading", "mcq unauth cardId", false, { cardId: body.cardId });
        return {
          error: "cardId grading requires authentication",
          code: "EC-GRADE-007",
        };
      }
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

    // Fallback: the caller supplies the full question. They already know
    // the key, so this discloses nothing — it is the preview path used
    // before a generated card is persisted.
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

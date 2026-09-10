// perUserRateLimit.ts: rate limit por usuario (no solo IP).
//
// v0.60 (P3.2): @fastify/rate-limit es por IP. Aqui implementamos
// un middleware que limita por userId (extraido de JWT/header).
// Default: 100 req/min por usuario, 10 req/s burst.

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { logOp } from "../utils/log.js";

interface UserBucket {
  count: number;
  resetAt: number;
  burst: number;
  burstResetAt: number;
}

export interface PerUserRateLimitOptions {
  perMinute: number;
  burstPerSecond: number;
  getUserId: (req: FastifyRequest) => string | null;
}

const buckets = new Map<string, UserBucket>();

function checkBucket(userId: string, opts: PerUserRateLimitOptions): { allowed: boolean; resetIn: number } {
  const now = Date.now();
  let b = buckets.get(userId);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + 60_000, burst: 0, burstResetAt: now + 1_000 };
    buckets.set(userId, b);
  }
  if (b.burstResetAt < now) {
    b.burst = 0;
    b.burstResetAt = now + 1_000;
  }
  if (b.burst >= opts.burstPerSecond) {
    return { allowed: false, resetIn: b.burstResetAt - now };
  }
  if (b.count >= opts.perMinute) {
    return { allowed: false, resetIn: b.resetAt - now };
  }
  b.count++;
  b.burst++;
  return { allowed: true, resetIn: 0 };
}

export function registerPerUserRateLimit(app: FastifyInstance, opts: PerUserRateLimitOptions) {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = opts.getUserId(req);
    if (!userId) return; // no user = no limit
    const r = checkBucket(userId, opts);
    if (!r.allowed) {
      reply.header("Retry-After", Math.ceil(r.resetIn / 1000).toString());
      reply.code(429);
      logOp("rate", "limit hit", false, { userId, resetMs: r.resetIn });
      reply.send({ error: "Rate limit exceeded", retryAfterMs: r.resetIn });
    }
  });
  // v0.60: cleanup periodico de buckets inactivos
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt < now - 5 * 60_000) buckets.delete(k);
    }
  }, 5 * 60_000);
}

/// Para tests: resetear buckets.
export function __resetBuckets() { buckets.clear(); }

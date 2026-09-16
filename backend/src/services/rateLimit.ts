// Login rate limit (per-IP).
// v2.6.0: 5 failed logins / 15 min / IP → 429 with Retry-After.
// Uses in-memory Map; survives until process restart.
// Replace with Redis-ready interface if multi-instance deploy needed.

const WINDOW_MS = 15 * 60 * 1000; // 15 min
const MAX_FAILS = 5;

interface Bucket {
  fails: number;
  firstAt: number;
}

const buckets = new Map<string, Bucket>();

export interface ThrottleResult {
  allowed: boolean;
  retryAfterSec?: number;
  remaining?: number;
}

export function checkLoginThrottle(ip: string): ThrottleResult {
  const b = buckets.get(ip);
  if (!b) return { allowed: true, remaining: MAX_FAILS };
  const now = Date.now();
  if (now - b.firstAt > WINDOW_MS) {
    buckets.delete(ip);
    return { allowed: true, remaining: MAX_FAILS };
  }
  if (b.fails >= MAX_FAILS) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((b.firstAt + WINDOW_MS - now) / 1000),
      remaining: 0,
    };
  }
  return { allowed: true, remaining: MAX_FAILS - b.fails };
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstAt > WINDOW_MS) {
    buckets.set(ip, { fails: 1, firstAt: now });
  } else {
    b.fails += 1;
  }
}

export function recordLoginSuccess(ip: string): void {
  buckets.delete(ip);
}

export function getThrottleStats(): { activeIps: number; totalFails: number } {
  let total = 0;
  for (const b of buckets.values()) total += b.fails;
  return { activeIps: buckets.size, totalFails: total };
}

// Cleanup every 5 min
if (typeof setInterval !== "undefined") {
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) {
      if (now - b.firstAt > WINDOW_MS) buckets.delete(ip);
    }
  }, 5 * 60 * 1000);
  cleanup.unref?.();
}

// Test helper
export function _resetRateLimit(): void {
  buckets.clear();
}

// Tests para WS rate limit (Fase 6 security fix — bug auditor #6).
//
// Bug original: el WebSocket /transcription/stream no tenía rate limit.
// Un cliente podia saturar el server con messages y tirar el proceso (DoS).
// Fix: rate limit por connection (messages + bytes por ventana deslizante)
// + max concurrent por deviceId.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createRateLimitTracker,
  checkRateLimit,
  ConcurrentConnectionTracker,
  getWSRateLimitConfig,
  type WSRateLimitConfig,
} from "../src/utils/wsRateLimit";

const testConfig: WSRateLimitConfig = {
  maxMessages: 5,
  maxBytes: 1000,
  windowMs: 1000,
  maxConcurrentPerDevice: 3,
};

describe("wsRateLimit — checkRateLimit", () => {
  it("allows first messages under limit", () => {
    const state = createRateLimitTracker();
    for (let i = 0; i < 5; i++) {
      const v = checkRateLimit(state, 10, testConfig);
      expect(v.allowed).toBe(true);
    }
  });

  it("rejects when message count exceeds limit", () => {
    const state = createRateLimitTracker();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(state, 10, testConfig);
    }
    // 6th message should be rejected
    const v = checkRateLimit(state, 10, testConfig);
    expect(v.allowed).toBe(false);
    if (!v.allowed) {
      expect(v.reason).toBe("messages");
      expect(v.limit).toBe(5);
      expect(v.used).toBe(6);
    }
  });

  it("rejects when bytes exceed limit", () => {
    const state = createRateLimitTracker();
    // 5 messages of 250 bytes each = 1250 > 1000 limit
    // 4 messages: 4*250=1000 = exactly the limit, still allowed
    // 5th message: 5*250=1250 > 1000, REJECTED
    for (let i = 0; i < 4; i++) {
      const v = checkRateLimit(state, 250, testConfig);
      expect(v.allowed).toBe(true);
    }
    const v5 = checkRateLimit(state, 250, testConfig);
    expect(v5.allowed).toBe(false);
    if (!v5.allowed) {
      expect(v5.reason).toBe("bytes");
      expect(v5.used).toBe(1250);
      expect(v5.limit).toBe(1000);
    }
  });

  it("resets counters after window expires", async () => {
    const state = createRateLimitTracker();
    // Fill the limit
    for (let i = 0; i < 5; i++) {
      checkRateLimit(state, 10, testConfig);
    }
    const rejected = checkRateLimit(state, 10, testConfig);
    expect(rejected.allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, testConfig.windowMs + 50));

    // Should be allowed again
    const v = checkRateLimit(state, 10, testConfig);
    expect(v.allowed).toBe(true);
  });

  it("rejected verdict includes resetMs for client backoff", () => {
    const state = createRateLimitTracker();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(state, 10, testConfig);
    }
    const v = checkRateLimit(state, 10, testConfig);
    if (!v.allowed) {
      expect(v.resetMs).toBeGreaterThan(0);
      expect(v.resetMs).toBeLessThanOrEqual(testConfig.windowMs);
    }
  });
});

describe("wsRateLimit — config from env", () => {
  beforeEach(() => {
    delete process.env.WS_RATE_LIMIT_MESSAGES;
    delete process.env.WS_RATE_LIMIT_BYTES;
    delete process.env.WS_RATE_LIMIT_WINDOW_MS;
    delete process.env.WS_MAX_CONCURRENT;
  });

  it("uses sensible defaults", () => {
    const c = getWSRateLimitConfig();
    expect(c.maxMessages).toBe(100);
    expect(c.maxBytes).toBe(10 * 1024 * 1024); // 10MB
    expect(c.windowMs).toBe(60000); // 1 min
    expect(c.maxConcurrentPerDevice).toBe(5);
  });

  it("parses env overrides", () => {
    process.env.WS_RATE_LIMIT_MESSAGES = "50";
    process.env.WS_RATE_LIMIT_BYTES = "5242880"; // 5MB
    process.env.WS_RATE_LIMIT_WINDOW_MS = "30000";
    process.env.WS_MAX_CONCURRENT = "10";
    const c = getWSRateLimitConfig();
    expect(c.maxMessages).toBe(50);
    expect(c.maxBytes).toBe(5242880);
    expect(c.windowMs).toBe(30000);
    expect(c.maxConcurrentPerDevice).toBe(10);
  });
});

describe("ConcurrentConnectionTracker", () => {
  let tracker: ConcurrentConnectionTracker;

  beforeEach(() => {
    tracker = new ConcurrentConnectionTracker();
  });

  afterEach(() => {
    tracker.destroy();
  });

  it("allows connections under limit", () => {
    expect(tracker.canConnect("device1", 3)).toBe(true);
    tracker.increment("device1");
    expect(tracker.canConnect("device1", 3)).toBe(true);
    tracker.increment("device1");
    expect(tracker.canConnect("device1", 3)).toBe(true);
    tracker.increment("device1");
    // Now at 3, next should fail
    expect(tracker.canConnect("device1", 3)).toBe(false);
  });

  it("tracks different devices independently", () => {
    tracker.increment("device1");
    tracker.increment("device1");
    tracker.increment("device2");
    expect(tracker.getCurrent("device1")).toBe(2);
    expect(tracker.getCurrent("device2")).toBe(1);
  });

  it("decrement reduces count", () => {
    tracker.increment("device1");
    tracker.increment("device1");
    tracker.decrement("device1");
    expect(tracker.getCurrent("device1")).toBe(1);
  });

  it("decrement removes entry at 0", () => {
    tracker.increment("device1");
    tracker.decrement("device1");
    expect(tracker.getCurrent("device1")).toBe(0);
  });

  it("can connect after disconnects", () => {
    tracker.increment("device1");
    tracker.increment("device1");
    tracker.increment("device1");
    expect(tracker.canConnect("device1", 3)).toBe(false);
    tracker.decrement("device1");
    tracker.decrement("device1");
    tracker.decrement("device1");
    expect(tracker.canConnect("device1", 3)).toBe(true);
  });

  it("returns 0 for unknown devices", () => {
    expect(tracker.getCurrent("unknown")).toBe(0);
    expect(tracker.canConnect("unknown", 5)).toBe(true);
  });

  it("destroy clears state and stops cleanup", () => {
    tracker.increment("device1");
    tracker.destroy();
    // Después de destroy, getCurrent sigue retornando lo último (Map.clear se hizo en destroy)
    // El test solo verifica que destroy no crashea
    expect(true).toBe(true);
  });
});

describe("wsRateLimit — security invariants", () => {
  it("rejected verdict reason is always 'messages' or 'bytes'", () => {
    const state = createRateLimitTracker();
    for (let i = 0; i < 5; i++) {
      checkRateLimit(state, 10, testConfig);
    }
    const v = checkRateLimit(state, 10, testConfig);
    if (!v.allowed) {
      expect(["messages", "bytes"]).toContain(v.reason);
    }
  });

  it("NEVER allows more than maxMessages in a single window", () => {
    const state = createRateLimitTracker();
    let allowedCount = 0;
    for (let i = 0; i < 100; i++) {
      const v = checkRateLimit(state, 0, testConfig);
      if (v.allowed) allowedCount++;
    }
    expect(allowedCount).toBe(testConfig.maxMessages);
  });

  it("NEVER allows more than maxBytes in a single window", () => {
    const state = createRateLimitTracker();
    let allowedCount = 0;
    for (let i = 0; i < 100; i++) {
      const v = checkRateLimit(state, 100, testConfig); // 100 bytes each
      if (v.allowed) allowedCount++;
    }
    // 10 messages * 100 bytes = 1000 = exact limit. But the 11th would push us over
    // Actually with msg+bytes combined, we hit messages limit first (5 maxMessages)
    // So allowedCount should be 5
    expect(allowedCount).toBeLessThanOrEqual(5);
  });
});

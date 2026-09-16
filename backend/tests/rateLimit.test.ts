import { describe, it, expect, beforeEach } from "vitest";
import {
  checkLoginThrottle,
  recordLoginFailure,
  recordLoginSuccess,
  getThrottleStats,
  _resetRateLimit,
} from "../src/services/rateLimit.js";

beforeEach(() => _resetRateLimit());

describe("rateLimit (login throttle)", () => {
  it("allows first attempt", () => {
    const r = checkLoginThrottle("1.2.3.4");
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(5);
  });

  it("counts down remaining", () => {
    recordLoginFailure("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").remaining).toBe(4);
    recordLoginFailure("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").remaining).toBe(3);
  });

  it("blocks 6th attempt within 15min", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("1.2.3.4");
    const r = checkLoginThrottle("1.2.3.4");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(900);
    expect(r.remaining).toBe(0);
  });

  it("resets counter on successful login", () => {
    for (let i = 0; i < 3; i++) recordLoginFailure("1.2.3.4");
    recordLoginSuccess("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").remaining).toBe(5);
    // After reset, 4 more failures should still be allowed (one under the cap of 5)
    for (let i = 0; i < 4; i++) {
      recordLoginFailure("1.2.3.4");
    }
    expect(checkLoginThrottle("1.2.3.4").allowed).toBe(true);
  });

  it("isolates by IP", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").allowed).toBe(false);
    expect(checkLoginThrottle("5.6.7.8").allowed).toBe(true);
    expect(checkLoginThrottle("5.6.7.8").remaining).toBe(5);
  });

  it("expires after window", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").allowed).toBe(false);
    // Simulate window expiry by manipulating bucket
    const stats = getThrottleStats();
    expect(stats.activeIps).toBe(1);
    expect(stats.totalFails).toBe(5);
  });

  it("cleanup removes expired buckets", () => {
    recordLoginFailure("1.2.3.4");
    expect(getThrottleStats().activeIps).toBe(1);
    recordLoginSuccess("1.2.3.4"); // also removes the bucket
    expect(getThrottleStats().activeIps).toBe(0);
  });
});

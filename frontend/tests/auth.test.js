/* ============================================================
 * auth.test.js — Tests for token storage + helpers (v2.6.0)
 * ============================================================ */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { auth } from "../src/services/auth.js";

beforeEach(() => {
  // Use isolated storage so the test environment is clean
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
});

describe("auth service", () => {
  it("starts empty", () => {
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.getRefreshToken()).toBeNull();
    expect(auth.isAuthed()).toBe(false);
  });

  it("saves and reads access token", () => {
    auth.saveTokens({ accessToken: "at-123", refreshToken: "rt-456" });
    expect(auth.getAccessToken()).toBe("at-123");
    expect(auth.getRefreshToken()).toBe("rt-456");
    expect(auth.isAuthed()).toBe(true);
    expect(auth.hasRefreshToken()).toBe(true);
  });

  it("clearTokens removes both", () => {
    auth.saveTokens({ accessToken: "at-1", refreshToken: "rt-1" });
    auth.clearTokens();
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.getRefreshToken()).toBeNull();
    expect(auth.isAuthed()).toBe(false);
    expect(auth.hasRefreshToken()).toBe(false);
  });

  it("isAuthed returns true with only refresh token (degraded session)", () => {
    localStorage.setItem("mnexus.auth.refresh", "rt-only");
    expect(auth.hasRefreshToken()).toBe(true);
    expect(auth.isAuthed()).toBe(true);
  });

  it("isAuthed returns true with only access token (active session)", () => {
    sessionStorage.setItem("mnexus.auth.access", "at-only");
    expect(auth.getAccessToken()).toBe("at-only");
    expect(auth.hasRefreshToken()).toBe(false);
    expect(auth.isAuthed()).toBe(true);
  });

  it("saveTokens with partial update preserves existing", () => {
    auth.saveTokens({ accessToken: "at-1", refreshToken: "rt-1" });
    auth.saveTokens({ accessToken: "at-2" }); // no refreshToken in args
    expect(auth.getAccessToken()).toBe("at-2");
    expect(auth.getRefreshToken()).toBe("rt-1");
  });

  it("handles broken sessionStorage gracefully", () => {
    const orig = sessionStorage.setItem;
    sessionStorage.setItem = () => { throw new Error("QuotaExceeded"); };
    expect(() => auth.saveTokens({ accessToken: "x" })).not.toThrow();
    sessionStorage.setItem = orig;
  });

  it("handles broken localStorage gracefully", () => {
    const orig = localStorage.setItem;
    localStorage.setItem = () => { throw new Error("QuotaExceeded"); };
    expect(() => auth.saveTokens({ refreshToken: "x" })).not.toThrow();
    localStorage.setItem = orig;
  });
});

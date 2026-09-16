/* ============================================================
 * login.test.js — Tests for login screen behavior (v2.6.0)
 * ============================================================ */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderLogin } from "../src/screens/login.js";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  if (typeof localStorage !== "undefined") localStorage.clear();
  // Default window.location.hostname to localhost
  Object.defineProperty(window, "location", {
    writable: true,
    value: { hostname: "localhost", hash: "#/login" },
  });
  global.fetch = vi.fn();
});

describe("login screen", () => {
  it("renders username + password + submit", async () => {
    await renderLogin();
    const form = document.getElementById("login-form");
    expect(form).toBeTruthy();
    expect(form.querySelector('input[name="username"]')).toBeTruthy();
    expect(form.querySelector('input[name="password"]')).toBeTruthy();
    expect(form.querySelector('button[type="submit"]')).toBeTruthy();
  });

  it("rejects empty username", async () => {
    await renderLogin();
    const form = document.getElementById("login-form");
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /api/v1/auth/login with credentials", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accessToken: "at-1", refreshToken: "rt-1" }),
    });
    await renderLogin();
    const form = document.getElementById("login-form");
    form.querySelector('input[name="username"]').value = "admin";
    form.querySelector('input[name="password"]').value = "TestPass1234!";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/login"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows error on 401", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "Invalid credentials", code: "EC-AUTH-103" }),
    });
    await renderLogin();
    const form = document.getElementById("login-form");
    form.querySelector('input[name="username"]').value = "admin";
    form.querySelector('input[name="password"]').value = "wrong";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    const errBox = document.getElementById("login-error");
    expect(errBox.hidden).toBe(false);
    expect(errBox.textContent.length).toBeGreaterThan(0);
  });

  it("shows retry-after on 429", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: "Too many", retryAfterSec: 60, code: "EC-AUTH-101" }),
    });
    await renderLogin();
    const form = document.getElementById("login-form");
    form.querySelector('input[name="username"]').value = "admin";
    form.querySelector('input[name="password"]').value = "wrong";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    const errBox = document.getElementById("login-error");
    expect(errBox.hidden).toBe(false);
    expect(errBox.textContent).toMatch(/60/);
  });

  it("shows lockout message on 423", async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 423,
      json: async () => ({ retryAfterSec: 1800, code: "EC-AUTH-104" }),
    });
    await renderLogin();
    const form = document.getElementById("login-form");
    form.querySelector('input[name="username"]').value = "admin";
    form.querySelector('input[name="password"]').value = "wrong";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    const errBox = document.getElementById("login-error");
    expect(errBox.hidden).toBe(false);
    expect(errBox.textContent).toMatch(/1800/);
  });

  it("shows network error on fetch throw", async () => {
    global.fetch.mockRejectedValueOnce(new Error("NetworkError"));
    await renderLogin();
    const form = document.getElementById("login-form");
    form.querySelector('input[name="username"]').value = "admin";
    form.querySelector('input[name="password"]').value = "x";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 100));
    const errBox = document.getElementById("login-error");
    expect(errBox.hidden).toBe(false);
  });
});

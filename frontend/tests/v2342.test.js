// v2342.test.js — v2.34.2 autofill hardening for login.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe("v2.34.2 — login.js autofill hardening", () => {
  it("uses autocomplete=off on the form", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/login.js"),
      "utf-8",
    );
    expect(src).toMatch(/<form id="login-form"[^>]*autocomplete="off"/);
  });

  it("inputs have autocomplete=off", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/login.js"),
      "utf-8",
    );
    const matches = src.match(/autocomplete="off"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3); // form + 2 inputs
  });

  it("uses randomized name suffixes to defeat heuristic autofill", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/login.js"),
      "utf-8",
    );
    expect(src).toMatch(/name="mn-user-\$\{suffix\}/);
    expect(src).toMatch(/name="mn-pass-\$\{suffix\}/);
  });

  it("inputs start as readonly and remove readonly on focus", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/login.js"),
      "utf-8",
    );
    expect(src).toMatch(/readonly/);
    expect(src).toMatch(/onfocus="this\.removeAttribute\('readonly'\)/);
  });

  it("blocks common password managers via data-* attrs", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/login.js"),
      "utf-8",
    );
    expect(src).toMatch(/data-lpignore="true"/);
    expect(src).toMatch(/data-1p-ignore="true"/);
    expect(src).toMatch(/data-form-type="other"/);
  });
});

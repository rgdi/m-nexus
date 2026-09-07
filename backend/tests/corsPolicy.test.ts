// Tests para corsPolicy (Fase 6 security fix — bug auditor #8).
//
// Bug original: cors: { origin: true, credentials: true } reflejaba cualquier origin.
// Esto es vulnerable a CSRF si en el futuro se mete auth por cookie.
// Fix: whitelist explícita via env var CORS_ALLOWED_ORIGINS.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAllowedOrigins, isOriginAllowed, corsOriginCallback } from "../src/utils/corsPolicy";

describe("corsPolicy — defaults", () => {
  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it("returns default allowed origins when env not set", () => {
    const origins = getAllowedOrigins();
    expect(origins.length).toBeGreaterThan(5);
    expect(origins).toContain("http://localhost:3000");
    expect(origins).toContain("capacitor://localhost");
  });

  it("parses comma-separated CORS_ALLOWED_ORIGINS", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com,https://admin.example.com";
    const origins = getAllowedOrigins();
    expect(origins).toEqual(["https://app.example.com", "https://admin.example.com"]);
  });

  it("rejects CORS_ALLOWED_ORIGINS=* and falls back to defaults", () => {
    process.env.CORS_ALLOWED_ORIGINS = "*";
    const origins = getAllowedOrigins();
    // No debe ser ["*"] — debe usar defaults seguros
    expect(origins).not.toEqual(["*"]);
    expect(origins).toContain("http://localhost:3000");
  });

  it("ignores empty entries in CORS_ALLOWED_ORIGINS", () => {
    process.env.CORS_ALLOWED_ORIGINS = "https://a.com,, ,https://b.com";
    const origins = getAllowedOrigins();
    expect(origins).toEqual(["https://a.com", "https://b.com"]);
  });
});

describe("corsPolicy — isOriginAllowed", () => {
  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it("allows localhost variants by default", () => {
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
    expect(isOriginAllowed("http://localhost:4000")).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5173")).toBe(true);
  });

  it("allows capacitor (mobile app) by default", () => {
    expect(isOriginAllowed("capacitor://localhost")).toBe(true);
  });

  it("allows undefined/null origin (same-origin, curl)", () => {
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed("null")).toBe(true);
  });

  it("REJECTS unknown origins (the security fix)", () => {
    expect(isOriginAllowed("https://evil.com")).toBe(false);
    expect(isOriginAllowed("https://attacker.io")).toBe(false);
    expect(isOriginAllowed("http://random-origin.net")).toBe(false);
  });

  it("REJECTS similar but not equal origins", () => {
    // Subdomain trick
    expect(isOriginAllowed("http://localhost.evil.com")).toBe(false);
    // Different port
    expect(isOriginAllowed("http://localhost:9999")).toBe(false);
  });
});

describe("corsPolicy — with custom whitelist", () => {
  beforeEach(() => {
    process.env.CORS_ALLOWED_ORIGINS = "https://app.mnexus.io,https://admin.mnexus.io";
  });
  afterEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it("only allows whitelisted origins", () => {
    expect(isOriginAllowed("https://app.mnexus.io")).toBe(true);
    expect(isOriginAllowed("https://admin.mnexus.io")).toBe(true);
  });

  it("rejects localhost (not in custom whitelist)", () => {
    expect(isOriginAllowed("http://localhost:3000")).toBe(false);
  });

  it("rejects random origins", () => {
    expect(isOriginAllowed("https://random.com")).toBe(false);
  });
});

describe("corsPolicy — callback", () => {
  beforeEach(() => {
    delete process.env.CORS_ALLOWED_ORIGINS;
  });

  it("callback allows whitelisted origin", () => {
    let allowed: string | boolean | undefined;
    let err: Error | null = null;
    corsOriginCallback("http://localhost:3000", (e, a) => {
      err = e;
      allowed = a;
    });
    expect(err).toBeNull();
    // Devuelve el origin exacto para que Access-Control-Allow-Origin lo refleje
    expect(allowed).toBe("http://localhost:3000");
  });

  it("callback allows undefined origin (same-origin)", () => {
    let allowed: string | boolean | undefined;
    corsOriginCallback(undefined, (e, a) => {
      allowed = a;
    });
    expect(allowed).toBe(true);
  });

  it("callback blocks non-whitelisted origin with error", () => {
    let err: Error | null = null;
    let allowed = true;
    corsOriginCallback("https://evil.com", (e, a) => {
      err = e;
      allowed = a ?? true;
    });
    expect(err).not.toBeNull();
    expect(err!.message).toContain("evil.com");
    expect(allowed).toBe(false);
  });
});

describe("corsPolicy — security invariants", () => {
  it("NEVER returns '*' as an allowed origin", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.CORS_ALLOWED_ORIGINS = "*";
    const origins = getAllowedOrigins();
    expect(origins).not.toContain("*");
  });

  it("NEVER returns empty allowed list (always has defaults)", () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    process.env.CORS_ALLOWED_ORIGINS = "";
    const origins = getAllowedOrigins();
    expect(origins.length).toBeGreaterThan(0);
  });
});

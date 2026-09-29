// tests/v237-security.test.ts — v2.37.0 auth + rate-limit pass.
//
// Every test here corresponds to a finding from the critical audit:
//   F1  /api/v1/grade/mcq with a cardId disclosed the answer key to
//       anonymous callers.
//   F2  /api/v1/grade/typed could invoke a paid LLM provider with no
//       authentication and no rate limit.
//   F3  GET /api/v1/notes returned every note to anyone.
//   F4  GET /api/v1/flashcards returned every card — including
//       correctIndex — to anyone.
//   F5  POST /api/v1/flashcards/:id/review sent ratings the backend
//       rejected, so the progress screen silently read zero.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/server.js";
import { __resetGradingBuckets } from "../src/routes/grading.js";
import { join } from "node:path";

let app: Awaited<ReturnType<typeof buildApp>>;
let token = "";

beforeAll(async () => {
  app = await buildApp();
  const r = await app.inject({
    method: "POST",
    url: "/api/v1/register",
    payload: {
      username: "sec" + Date.now(),
      password: "demo123",
      deviceId: "dev-" + Math.random().toString(36).slice(2, 10),
      deviceName: "security-test",
      platform: "web",
    },
  });
  token = r.json()?.accessToken ?? "";
  if (!token) {
    throw new Error(
      `register failed (${r.statusCode}): ${r.body.slice(0, 300)} — the auth assertions below would be vacuous`,
    );
  }
});

afterAll(async () => {
  try { await app.close(); } catch {}
});

beforeEach(() => __resetGradingBuckets());

// v2.37.0: a function, not a const. A module-level `const authed = { Bearer ${token} }`
// is evaluated at import time — before beforeAll has run — so every
// "authenticated" request would silently go out with an empty token and
// the auth assertions would pass for the wrong reason.
const authed = () => ({ authorization: `Bearer ${token}` });

describe("F1 — MCQ cardId lookup requires auth", () => {
  it("rejects an anonymous cardId request", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/grade/mcq",
      payload: { cardId: "any-card-id", chosenIndex: 0 },
    });
    expect(r.json().code).toBe("EC-GRADE-007");
  });

  it("does not leak whether the card exists to an anonymous caller", async () => {
    const missing = await app.inject({
      method: "POST", url: "/api/v1/grade/mcq",
      payload: { cardId: "definitely-missing-xyz", chosenIndex: 0 },
    });
    expect(missing.json().code).toBe("EC-GRADE-007");
    // The response must not distinguish "no such card" from "no access" —
    // otherwise the endpoint becomes an id oracle.
    expect(missing.json().message ?? missing.json().error).not.toMatch(/not found/i);
  });

  it("allows an authenticated cardId request through to the store", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/grade/mcq",
      headers: authed(),
      payload: { cardId: "definitely-missing-xyz", chosenIndex: 0 },
    });
    // Now the auth gate passes, so we get the honest "no such card".
    expect(r.json().code).toBe("EC-GRADE-002");
  });

  it("still allows the inline-options preview without auth", async () => {
    // The caller supplies the key here, so there is nothing to disclose.
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/grade/mcq",
      payload: { options: ["a", "b"], correctIndex: 0, chosenIndex: 0 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().correct).toBe(true);
  });
});

describe("F2 — LLM grading requires auth and is rate limited", () => {
  it("refuses useLlm without a token", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/grade/typed",
      payload: { userAnswer: "120 mmHg", expected: "120 mmHg", useLlm: true },
    });
    expect(r.json().code).toBe("EC-GRADE-005");
  });

  it("still grades deterministically without a token when useLlm is off", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/grade/typed",
      payload: { userAnswer: "120 mmHg", expected: "120 mmHg", useLlm: false },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().score).toBe(100);
  });

  it("accepts useLlm from an authenticated caller", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/grade/typed",
      headers: authed(),
      payload: { userAnswer: "120 mmHg", expected: "120 mmHg", useLlm: true },
    });
    // No provider is reachable in tests, so it degrades — but it must
    // not be refused on auth grounds.
    expect(r.json().code).not.toBe("EC-GRADE-005");
    expect(r.statusCode).toBe(200);
  });

  it("returns 429 once the LLM budget for a caller is spent", async () => {
    let sawLimit = false;
    for (let i = 0; i < 60; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/grade/typed",
        headers: authed(),
        payload: { userAnswer: "a", expected: "b", useLlm: true },
      });
      if (r.statusCode === 429) {
        sawLimit = true;
        expect(r.json().code).toBe("EC-GRADE-006");
        expect(r.headers["retry-after"]).toBeTruthy();
        break;
      }
    }
    expect(sawLimit).toBe(true);
  });

  it("does not spend the LLM budget on deterministic requests", async () => {
    for (let i = 0; i < 80; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/grade/typed",
        payload: { userAnswer: "a", expected: "a", useLlm: false },
      });
      expect(r.statusCode).toBe(200);
    }
  });

  it("rate limits MCQ for a single caller", async () => {
    let sawLimit = false;
    for (let i = 0; i < 200; i++) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/grade/mcq",
        payload: { options: ["a", "b"], correctIndex: 0, chosenIndex: 0 },
      });
      if (r.statusCode === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });
});

describe("F3 / F4 — notes and flashcards require auth", () => {
  it("GET /api/v1/notes is not public", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/notes" });
    expect(r.statusCode).toBe(401);
  });

  it("GET /api/v1/flashcards is not public", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/flashcards" });
    expect(r.statusCode).toBe(401);
  });

  it("the anonymous response carries no note bodies", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/notes" });
    expect(r.body).not.toMatch(/"body"/);
    expect(r.body).not.toMatch(/"pages"/);
  });

  it("the anonymous response carries no answer keys", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/flashcards" });
    expect(r.body).not.toMatch(/correctIndex/);
  });

  it("an authenticated caller still gets their notes", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/notes", headers: authed() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty("notes");
  });

  it("an authenticated caller still gets their flashcards", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/flashcards", headers: authed() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveProperty("cards");
  });

  it("the health check stays public so uptime monitors keep working", async () => {
    // Note: PUBLIC_PATHS also lists a bare "/health", but the route is only
    // registered at "/api/v1/health". The bare entry is a no-op — flagged in
    // docs/v2.37.md, not a security hole either way.
    const r = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(r.statusCode).toBe(200);
  });

  it("registration stays public so a first-time user can sign in", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/register",
      payload: {
        username: "pub" + Date.now(), password: "demo123",
        deviceId: "pub-" + Math.random().toString(36).slice(2, 10),
        deviceName: "t", platform: "web",
      },
    });
    expect(r.statusCode).toBe(200);
  });

  it("an optional-auth public route still verifies a good token", async () => {
    // /api/v1/grade/typed is public, but with a valid token the route can
    // see who is asking. That only works because v2.37.0 made auth
    // optional rather than skipped on public paths.
    const r = await app.inject({
      method: "POST", url: "/api/v1/grade/typed",
      headers: authed(),
      payload: { userAnswer: "x", expected: "x", useLlm: true },
    });
    expect(r.json().code).not.toBe("EC-GRADE-005");
  });

  it("a public route ignores a garbage token instead of 401-ing", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/grade/typed",
      headers: { authorization: "Bearer not-a-real-token" },
      payload: { userAnswer: "x", expected: "x", useLlm: false },
    });
    expect(r.statusCode).toBe(200);
  });
});

describe("F5 — the review endpoint accepts the ratings the UI actually sends", () => {
  it("creates a card", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/flashcards",
      headers: authed(),
      payload: { front: "¿Cuánto es 2+2?", back: "4", cardType: "basic" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toHaveProperty("id");
  });

  it("accepts rating 1 (De nuevo) — the old UI sent 0 and got a 400", async () => {
    const c = await app.inject({
      method: "POST", url: "/api/v1/flashcards", headers: authed(),
      payload: { front: "card A", back: "a", cardType: "basic" },
    });
    const id = (c.json().card || c.json()).id;
    const r = await app.inject({
      method: "POST", url: `/api/v1/flashcards/${id}/review`,
      headers: authed(), payload: { rating: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().logged).toBe(true);
  });

  it("accepts ratings 2, 3 and 4", async () => {
    for (const rating of [2, 3, 4]) {
      const c = await app.inject({
        method: "POST", url: "/api/v1/flashcards", headers: authed(),
        payload: { front: `card ${rating}`, back: "x", cardType: "basic" },
      });
      const id = (c.json().card || c.json()).id;
      const r = await app.inject({
        method: "POST", url: `/api/v1/flashcards/${id}/review`,
        headers: authed(), payload: { rating },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().nextIntervalDays).toBeGreaterThan(0);
    }
  });

  it("still rejects rating 0 and 5 as out of range", async () => {
    const c = await app.inject({
      method: "POST", url: "/api/v1/flashcards", headers: authed(),
      payload: { front: "range card", back: "x", cardType: "basic" },
    });
    const id = (c.json().card || c.json()).id;
    for (const rating of [0, 5]) {
      const r = await app.inject({
        method: "POST", url: `/api/v1/flashcards/${id}/review`,
        headers: authed(), payload: { rating },
      });
      expect(r.statusCode).toBe(400);
    }
  });

  it("a review lands in reviewHistory so the heatmap can see it", async () => {
    const c = await app.inject({
      method: "POST", url: "/api/v1/flashcards", headers: authed(),
      payload: { front: "heatmap card", back: "h", cardType: "basic" },
    });
    const id = (c.json().card || c.json()).id;
    await app.inject({
      method: "POST", url: `/api/v1/flashcards/${id}/review`,
      headers: authed(), payload: { rating: 3 },
    });
    const list = await app.inject({ method: "GET", url: "/api/v1/flashcards", headers: authed() });
    const card = list.json().cards.find((x) => x.id === id);
    expect(card.reviewHistory?.length).toBeGreaterThan(0);
    expect(card.reviewHistory[0].rating).toBe(3);
  });

  it("the review records the retrievability it measured", async () => {
    const c = await app.inject({
      method: "POST", url: "/api/v1/flashcards", headers: authed(),
      payload: { front: "retention card", back: "r", cardType: "basic" },
    });
    const id = (c.json().card || c.json()).id;
    await app.inject({
      method: "POST", url: `/api/v1/flashcards/${id}/review`,
      headers: authed(), payload: { rating: 3 },
    });
    const list = await app.inject({ method: "GET", url: "/api/v1/flashcards", headers: authed() });
    const card = list.json().cards.find((x) => x.id === id);
    expect(typeof card.reviewHistory[0].r).toBe("number");
  });

  it("the heatmap now reports a non-zero review for today", async () => {
    const r = await app.inject({
      method: "GET", url: "/api/v1/progress/heatmap?weeks=1", headers: authed(),
    });
    const body = r.json();
    const today = body.days.find((d) => d.date === body.today);
    expect(today.reviews).toBeGreaterThan(0);
  });
});

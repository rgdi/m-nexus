// tests/v238.test.ts — v2.38.0 task extraction.
//
// The headline input from the feature request:
//   "dar de comer a los gatos mañana, comprar pan y llamar al dentista el viernes"
//   → 3 tasks, dates resolved, kinds assigned.

import { describe, it, expect } from "vitest";
import {
  splitInput,
  findDate,
  parseAmount,
  extractDeterministic,
  extractTasks,
} from "../src/services/taskExtractor.js";

const T0 = new Date(2026, 8, 29, 10, 0, 0).getTime(); // Tue 29 Sep 2026
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString().slice(0, 10));

describe("v2.38.0 — splitting", () => {
  it("splits on commas", () => {
    expect(splitInput("comprar pan, llamar a mamá")).toEqual(["comprar pan", "llamar a mamá"]);
  });

  it("splits on semicolons and newlines", () => {
    expect(splitInput("comprar pan; llamar a mamá\nenviar el informe")).toHaveLength(3);
  });

  it("splits on 'y' when the next word starts a new action", () => {
    // "comprar pan y llamar al dentista" is two things.
    expect(splitInput("comprar pan y llamar al dentista")).toEqual([
      "comprar pan",
      "llamar al dentista",
    ]);
  });

  it("does NOT split a grocery list on 'y'", () => {
    // "pan y huevos" is one shopping trip, not two items.
    expect(splitInput("necesito leche, huevos y papel higiénico")).toEqual([
      "necesito leche, huevos y papel higiénico",
    ]);
  });

  it("drops list bullets and collapses whitespace", () => {
    expect(splitInput("- comprar pan\n-   llamar a mamá")).toEqual(["comprar pan", "llamar a mamá"]);
  });

  it("ignores empty input", () => {
    expect(splitInput("")).toEqual([]);
    expect(splitInput("  , ;  ")).toEqual([]);
  });
});

describe("v2.38.0 — dates", () => {
  it("resolves hoy / mañana / pasado mañana", () => {
    expect(iso(findDate("comprar pan hoy", T0).due)).toBe("2026-09-29");
    expect(iso(findDate("comprar pan mañana", T0).due)).toBe("2026-09-30");
    expect(iso(findDate("comprar pan pasado mañana", T0).due)).toBe("2026-10-01");
  });

  it("resolves weekdays to the next occurrence", () => {
    // T0 is a Tuesday, so "viernes" is three days out.
    expect(iso(findDate("llamar el viernes", T0).due)).toBe("2026-10-02");
    expect(iso(findDate("llamar el lunes", T0).due)).toBe("2026-10-05");
  });

  it("resolves 'en N días'", () => {
    expect(iso(findDate("entregar en 3 días", T0).due)).toBe("2026-10-02");
  });

  it("resolves 'N semanas'", () => {
    expect(iso(findDate("en 2 semanas", T0).due)).toBe("2026-10-13");
    expect(iso(findDate("en 3 semanas", T0).due)).toBe("2026-10-20");
  });

  it("resolves an explicit month and day, rolling to next year if past", () => {
    // 12 March 2026 already happened on 29 Sep 2026 → next March.
    expect(iso(findDate("12 de marzo", T0).due)).toBe("2027-03-12");
    // 15 October has not happened yet → this year.
    expect(iso(findDate("15 de octubre", T0).due)).toBe("2026-10-15");
  });

  it("honours an explicit year", () => {
    expect(iso(findDate("3 de junio de 2027", T0).due)).toBe("2027-06-03");
  });

  it("resolves dd/mm, rolling to next year when the date has passed", () => {
    expect(iso(findDate("15/10", T0).due)).toBe("2026-10-15");
  });

  it("resolves ISO dates", () => {
    expect(iso(findDate("2026-12-24", T0).due)).toBe("2026-12-24");
  });

  it("returns null when there is no date", () => {
    expect(findDate("comprar pan", T0).due).toBeNull();
  });

  // The bug that made this class of parser useless: \b is defined over
  // [A-Za-z0-9_], so "é" is a non-word character and /\bmañana\b/ cannot
  // match "mañana" — the boundary is asserted between a non-word char
  // and another non-word char.
  it("matches keywords that end in an accent", () => {
    // These are the ones a naive \b silently drops.
    expect(iso(findDate("mañana", T0).due)).toBe("2026-09-30");
    expect(iso(findDate("pasado mañana", T0).due)).toBe("2026-10-01");
    expect(iso(findDate("miércoles", T0).due)).toBe("2026-09-30");
  });

  it("does not match a date word glued to a longer word", () => {
    // "mañana" inside "mañanero" must not count.
    expect(findDate("comprar pan mañanero", T0).due).toBeNull();
  });
});

describe("v2.38.0 — kinds", () => {
  const kindOf = (s: string) => extractDeterministic(s, T0)[0]?.kind;

  it("recognises a plain task", () => {
    expect(kindOf("llamar al dentista")).toBe("task");
  });

  it("recognises shopping", () => {
    expect(kindOf("comprar pan")).toBe("shopping");
    expect(kindOf("necesito leche")).toBe("shopping");
    expect(kindOf("pan")).toBe("shopping");
  });

  it("recognises a habit", () => {
    expect(kindOf("ir al gimnasio")).toBe("habit");
    expect(kindOf("meditar todos los días")).toBe("habit");
  });

  it("recognises an expense", () => {
    expect(kindOf("pagué la luz")).toBe("expense");
    expect(kindOf("gasté 30€ en cena")).toBe("expense");
  });

  it("recognises an event", () => {
    expect(kindOf("cita con el dentista")).toBe("event");
    expect(kindOf("reunión con el profesor")).toBe("event");
  });

  it("reads accents in the keywords", () => {
    // "pagué"/"gasté"/"reunión" all end in or contain accented letters;
    // with a naive \b these were unreachable and fell through to "task".
    expect(kindOf("pagué 40€ de la luz")).toBe("expense");
    expect(kindOf("gasté el alquiler")).toBe("expense");
    expect(kindOf("reunión con el profesor")).toBe("event");
  });

  it("falls back to task for something unrecognised", () => {
    expect(kindOf("xzzy plugh")).toBe("task");
  });
});

describe("v2.38.0 — amounts", () => {
  it("reads euros", () => {
    expect(parseAmount("pagué 40€")).toBe(4000);
    expect(parseAmount("pagué 12,50 euros")).toBe(1250);
  });

  it("reads dollars and pounds", () => {
    expect(parseAmount("costó $30")).toBe(3000);
    expect(parseAmount("£15")).toBe(1500);
  });

  it("returns undefined when there is no amount", () => {
    expect(parseAmount("comprar pan")).toBeUndefined();
  });
});

describe("v2.38.0 — the headline input", () => {
  const out = extractDeterministic(
    "dar de comer a los gatos mañana, comprar pan y llamar al dentista el viernes",
    T0,
  );

  it("produces three items", () => {
    expect(out).toHaveLength(3);
  });

  it("keeps each item's text clean of its date phrase", () => {
    expect(out[0].text).toBe("dar de comer a los gatos");
    expect(out[1].text).toBe("comprar pan");
    expect(out[2].text).toBe("llamar al dentista");
  });

  it("resolves each date", () => {
    expect(iso(out[0].due)).toBe("2026-09-30");
    expect(iso(out[2].due)).toBe("2026-10-02");
  });

  it("classifies the shopping item", () => {
    expect(out[1].kind).toBe("shopping");
  });

  it("marks everything as rule-derived", () => {
    expect(out.every((t) => t.how === "rule")).toBe(true);
  });
});

describe("v2.38.0 — LLM path", () => {
  it("does not call the model for a short, fully-parsed capture", async () => {
    let called = false;
    const r = await extractTasks("comprar pan mañana", {
      useLlm: true,
      now: T0,
      llm: async () => { called = true; return "{}"; },
    });
    expect(called).toBe(false);
    expect(r.usedLlm).toBe(false);
    expect(r.tasks).toHaveLength(1);
  });

  it("does not call the model when useLlm is off", async () => {
    let called = false;
    const long = "y ".repeat(200);
    await extractTasks(long, { now: T0, llm: async () => { called = true; return "{}"; } });
    expect(called).toBe(false);
  });

  it("consults the model for a long, ambiguous capture", async () => {
    let called = false;
    const r = await extractTasks("cosas ".repeat(60), {
      useLlm: true,
      now: T0,
      llm: async () => {
        called = true;
        return '{"tasks":[{"text":"comprar pan","kind":"shopping","due":null,"priority":1,"subject":"compras"}]}';
      },
    });
    expect(called).toBe(true);
    expect(r.usedLlm).toBe(true);
    expect(r.tasks[0].kind).toBe("shopping");
    expect(r.tasks[0].how).toBe("llm");
  });

  it("parses JSON wrapped in prose and fences", async () => {
    const r = await extractTasks("x ".repeat(150), {
      useLlm: true,
      now: T0,
      llm: async () => 'Aquí tienes:\n```json\n{"tasks":[{"text":"llamar","kind":"task","due":null,"priority":1,"subject":""}]}\n```\nEspero que sirva.',
    });
    expect(r.tasks[0].text).toBe("llamar");
  });

  it("keeps a date the model dropped but the rules found", async () => {
    const r = await extractTasks("comprar el pastel mañana " + "x ".repeat(150), {
      useLlm: true,
      now: T0,
      llm: async () => '{"tasks":[{"text":"comprar el pastel","kind":"shopping","due":null,"priority":1,"subject":"compras"}]}',
    });
    expect(r.tasks[0].due).not.toBeNull();
    expect(r.tasks[0].how).toBe("llm+rule");
  });

  it("keeps the kind the rules recognised when the model says 'task'", async () => {
    const r = await extractTasks("pagué 40€ de la luz " + "x ".repeat(150), {
      useLlm: true,
      now: T0,
      llm: async () => '{"tasks":[{"text":"pagué 40€ de la luz","kind":"task","due":null,"priority":1,"subject":""}]}',
    });
    expect(r.tasks[0].kind).toBe("expense");
    expect(r.tasks[0].amountCents).toBe(4000);
  });

  it("falls back to the rules when the model throws", async () => {
    // Long enough to be worth asking the model, but every item is short
    // and unambiguous, so the rule result is directly assertable.
    const r = await extractTasks("comprar pan mañana, llamar al dentista el viernes " + "y ".repeat(200), {
      useLlm: true,
      now: T0,
      llm: async () => { throw new Error("provider down"); },
    });
    expect(r.usedLlm).toBe(true);
    expect(r.llmError).toContain("provider down");
    // The deterministic answer is still returned — the model is optional.
    expect(r.tasks[0].text).toBe("comprar pan");
    expect(iso(r.tasks[0].due)).toBe("2026-09-30");
  });

  it("falls back when the model returns garbage", async () => {
    const r = await extractTasks("comprar pan " + "x ".repeat(150), {
      useLlm: true,
      now: T0,
      llm: async () => "lo siento, no puedo",
    });
    expect(r.tasks.length).toBeGreaterThan(0);
  });

  it("returns an honest empty list for empty input", async () => {
    const r = await extractTasks("   ", { useLlm: true, now: T0, llm: async () => "{}" });
    expect(r.tasks).toEqual([]);
    expect(r.usedLlm).toBe(false);
  });

  it("never claims the LLM graded something it did not", async () => {
    const r = await extractTasks("comprar pan mañana", { useLlm: true, now: T0, llm: async () => "{}" });
    expect(r.tasks.every((t) => t.how === "rule")).toBe(true);
  });
});

// ── HTTP surface ─────────────────────────────────────────────────
import { beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/server.js";
import { registerDevice, type TestAuth } from "./helpers/auth.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let auth: TestAuth;
const H = () => auth.headers;

beforeAll(async () => {
  app = await buildApp();
  auth = await registerDevice(app, "cap");
});
afterAll(async () => { try { await app.close(); } catch {} });

describe("v2.38.0 — POST /api/v1/tasks/capture", () => {
  it("parses without persisting when asked for a preview", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "comprar pan mañana, llamar al dentista el viernes", persist: false },
    });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.tasks).toHaveLength(2);
    expect(b.created).toEqual([]);
  });

  it("persists the extracted tasks", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "comprar pan mañana, llamar al dentista el viernes" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().created).toHaveLength(2);
    expect(r.json().created[0].how).toBe("rule");
  });

  it("stores the kind so the right screen can find it", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "pagué 40€ de la luz" },
    });
    const t = r.json().created[0];
    expect(t.kind).toBe("expense");
    expect(t.amountCents).toBe(4000);
  });

  it("keeps the source text for provenance", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "comprar pan" },
    });
    expect(r.json().created[0].sourceText).toBe("comprar pan");
  });

  it("rejects empty input", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(), payload: { text: "   " },
    });
    expect(r.statusCode).toBe(400);
  });

  it("requires auth", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture",
      payload: { text: "comprar pan" },
    });
    expect(r.statusCode).toBe(401);
  });
});

describe("v2.38.0 — habits", () => {
  let habitId = "";

  it("captures a habit", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "ir al gimnasio todos los días" },
    });
    const t = r.json().created[0];
    expect(t.kind).toBe("habit");
    expect(t.cadence).toBe("daily");
    habitId = t.id;
  });

  it("records today's check-in and starts a streak", async () => {
    const r = await app.inject({
      method: "POST", url: `/api/v1/tasks/${habitId}/habit-check`, headers: H(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().streak).toBe(1);
  });

  it("is idempotent — checking in twice is still one day", async () => {
    const r = await app.inject({
      method: "POST", url: `/api/v1/tasks/${habitId}/habit-check`, headers: H(),
    });
    expect(r.json().streak).toBe(1);
  });

  it("refuses a habit check on a non-habit", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "comprar pan" },
    });
    const id = r.json().created[0].id;
    const c = await app.inject({
      method: "POST", url: `/api/v1/tasks/${id}/habit-check`, headers: H(),
    });
    expect(c.statusCode).toBe(400);
    expect(c.json().code).toBe("EC-TSK-012");
  });

  it("404s on an unknown habit", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks/task-nope/habit-check", headers: H(),
    });
    expect(r.statusCode).toBe(404);
  });
});

describe("v2.38.0 — summaries", () => {
  it("totals expenses in cents", async () => {
    await app.inject({
      method: "POST", url: "/api/v1/tasks/capture", headers: H(),
      payload: { text: "pagué 10€ de gasolina" },
    });
    const r = await app.inject({
      method: "GET", url: "/api/v1/tasks/summary?kind=expense", headers: H(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().totalCents).toBeGreaterThanOrEqual(1000);
  });

  it("lists only pending tasks for the task summary", async () => {
    const r = await app.inject({
      method: "GET", url: "/api/v1/tasks/summary?kind=task", headers: H(),
    });
    expect(r.json().entries.every((t: any) => !t.done)).toBe(true);
  });

  it("returns the live streak for habits", async () => {
    const r = await app.inject({
      method: "GET", url: "/api/v1/tasks/summary?kind=habit", headers: H(),
    });
    const withStreak = r.json().entries.find((e: any) => (e.streak ?? 0) > 0);
    expect(withStreak).toBeTruthy();
  });

  it("requires auth", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/tasks/summary?kind=task" });
    expect(r.statusCode).toBe(401);
  });
});

describe("v2.38.0 — legacy rows still work", () => {
  it("a task created without a kind behaves as kind=task", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/tasks", headers: H(),
      payload: { text: "tarea antigua" },
    });
    expect(r.json().kind).toBeUndefined();
    const s = await app.inject({
      method: "GET", url: "/api/v1/tasks/summary?kind=task", headers: H(),
    });
    // (t.kind ?? "task") === "task" must match the legacy row.
    expect(s.json().entries.some((t: any) => t.text === "tarea antigua")).toBe(true);
  });
});

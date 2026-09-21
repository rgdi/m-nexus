// journalV226.test.js — v2.26.0 Daily Journal screen + premium renderers.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Set up the fetch mock BEFORE importing the screen, mimicking the
// outliner tests with a richer endpoint catalog.

function ok(payload, status = 200) {
  return {
    ok: true,
    status,
    headers: { get: (k) => (k?.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function makeMeta() {
  return {
    today: "2026-09-21",
    rolloverHour: 4,
    builtinTemplates: [
      { id: "tpl-general", subject: "*", name: "General", blockCount: 13 },
      { id: "tpl-anat", subject: "anat", name: "Anatomía", blockCount: 9 },
    ],
  };
}

function makeJournal(today) {
  return {
    id: `journal-${today}-anat`,
    title: `📓 ${today} · anat`,
    body: "",
    subject: "anat",
    tags: ["journal", "daily"],
    pages: [{ strokes: [], placeholders: [] }],
    folderId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isJournal: true,
    journalDate: today,
    blocks: [
      { id: "b-head", parentId: null, order: 0, text: "📓 Anat · Hoy", type: "text", meta: { kind: "heading", emoji: "🫀", title: "Hoy" }, createdAt: 1, updatedAt: 1 },
      { id: "b-mood", parentId: null, order: 1, text: "¿Cómo me siento?", type: "text", meta: { kind: "mood" }, createdAt: 1, updatedAt: 1 },
      { id: "b-div1", parentId: null, order: 2, text: "---", type: "text", meta: { kind: "divider" }, createdAt: 1, updatedAt: 1 },
      { id: "b-q1", parentId: null, order: 3, text: "cards-due", type: "cloze", meta: { kind: "query-cards-due" }, createdAt: 1, updatedAt: 1 },
      { id: "b-call", parentId: null, order: 4, text: "Una frase", type: "callout", meta: { kind: "callout", emoji: "✨", title: "Reflexión" }, createdAt: 1, updatedAt: 1 },
    ],
  };
}

const moodHist = Array.from({ length: 7 }).map((_, i) => ({
  date: `2026-09-${15 + i}`,
  mood: i === 6 ? 4 : i === 3 ? 5 : null,
  isToday: i === 6,
}));

const heatmap = { start: "2026-08-23", end: "2026-09-21", density: { "2026-09-21": 1, "2026-09-20": 1, "2026-09-18": 1 } };
const streak = { current: 3, longest: 7, missed: 0 };

let lastOps = [];

beforeEach(async () => {
  vi.resetModules();
  lastOps = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    const u = String(url);
    const m = (opts?.method || "GET").toUpperCase();
    lastOps.push({ method: m, url: u });
    if (m === "GET" && u.endsWith("/journal/meta")) return ok(makeMeta());
    if (m === "GET" && /\/journal\/streak/.test(u)) return ok(streak);
    if (m === "GET" && /\/journal\/heatmap/.test(u)) return ok(heatmap);
    if (m === "GET" && /\/journal\/mood-history/.test(u)) return ok({ days: 7, entries: moodHist });
    if (m === "GET" && /\/journal\/list/.test(u)) return ok({ journals: [makeJournal("2026-09-21")], total: 1 });
    if (m === "POST" && u.endsWith("/journal/today")) return ok(makeJournal("2026-09-21"));
    if (m === "POST" && /\/journal\/embed\/resolve/.test(u)) {
      return ok({ type: "cards-due", items: [{ id: "c1", front: "fibrosis quística", subject: "bio", due: 1 }] });
    }
    if (m === "POST" && /\/mood/.test(u)) return ok({ ok: true, mood: { score: 4, note: "" } });
    return ok({});
  });
  document.body.innerHTML = "";
});

describe("v2.26.0 — renderJournal paints all major sections", () => {
  it("renderiza sidebar (streak + mood + heatmap + recent)", async () => {
    const { renderJournal } = await import("../src/screens/journal.js");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await renderJournal(root);
    expect(root.querySelector(".journal-screen")).toBeTruthy();
    expect(root.querySelector(".journal-sidebar")).toBeTruthy();
    expect(root.querySelector(".streak-num").textContent).toContain("3");
    expect(root.querySelector(".heatmap-grid")).toBeTruthy();
    expect(root.querySelector(".recent-list")).toBeTruthy();
  });

  it("main has view-switcher with Día/Semana/Mes", async () => {
    const { renderJournal } = await import("../src/screens/journal.js");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await renderJournal(root);
    const tabs = Array.from(root.querySelectorAll(".view-switcher .tab")).map((t) => t.textContent.trim());
    expect(tabs).toEqual(["Día", "Semana", "Mes"]);
  });

  it("day-view bloquea 5 botones de mood", async () => {
    const { renderJournal } = await import("../src/screens/journal.js");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await renderJournal(root);
    expect(root.querySelectorAll(".mood-btn").length).toBe(5);
  });

  it("renderiza cada kind de bloque con su renderer correcto", async () => {
    const { renderJournal } = await import("../src/screens/journal.js");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await renderJournal(root);
    // heading: h1
    expect(root.querySelector(".jr-heading h1")).toBeTruthy();
    // mood hero + 5 buttons
    expect(root.querySelector(".mood-hero")).toBeTruthy();
    // divider
    expect(root.querySelector(".jr-divider")).toBeTruthy();
    // embed
    expect(root.querySelector(".jr-embed")).toBeTruthy();
    // callout
    expect(root.querySelector(".jr-callout")).toBeTruthy();
  });
});

describe("v2.26.0 — block renderers", () => {
  it("heading incluye emoji + escapado seguro", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "text",
      text: "📓 Hoy", meta: { kind: "heading", emoji: "🫀", title: "Hoy" },
      createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("jr-h1");
    expect(html).toContain("🫀");
    expect(html).toContain("Hoy");
  });

  it("callout incluye title + editable", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "callout",
      text: "Una frase", meta: { kind: "callout", emoji: "✨", title: "Reflexión" },
      createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("jr-callout");
    expect(html).toContain("Reflexión");
    expect(html).toContain('data-act="edit-block"');
  });

  it("gratitude muestra 3 inputs", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "text",
      text: "Familia\nSalud\nMi gato",
      meta: { kind: "gratitude", title: "Agradecido" },
      createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("jr-gratitude");
    expect(html.match(/jr-grat-item/g)?.length).toBe(3);
  });

  it("todo checkbox respeta estado done", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "text",
      text: "Llamar al médico",
      meta: { kind: "todo", done: true },
      createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("checked");
  });

  it("mood block muestra 5 botones", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "text",
      text: "", meta: { kind: "mood" }, createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("jr-mood");
    expect(html.match(/jr-mood-btn/g)?.length).toBe(5);
  });

  it("embed bloque lleva data-embed-type", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "cloze",
      text: "cards-due",
      meta: { kind: "query-cards-due" },
      createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("data-embed-type=\"query-cards-due\"");
    expect(html).toContain("jr-embed");
  });

  it("escapado seguro en heading evita XSS", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "text",
      text: "<script>alert(1)</script>", meta: { kind: "heading" },
      createdAt: 1, updatedAt: 1,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("free block tiene placeholder", async () => {
    const { renderJournalBlock } = await import("../src/widgets/journal_block_renderers.js");
    const html = renderJournalBlock({
      id: "b1", parentId: null, order: 0, type: "text",
      text: "", meta: { kind: "free" }, createdAt: 1, updatedAt: 1,
    });
    expect(html).toContain("jr-free");
    expect(html).toContain('placeholder="Escribe aquí…"');
  });
});

describe("v2.26.0 — view switcher", () => {
  it("cambiar a Mes muestra month-grid", async () => {
    const { renderJournal } = await import("../src/screens/journal.js");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await renderJournal(root);
    root.querySelector('[data-view="month"]').click();
    expect(root.querySelector(".month-grid")).toBeTruthy();
    expect(root.querySelectorAll(".month-cell").length).toBe(42);
  });

  it("cambiar a Semana muestra 7 week-cell", async () => {
    const { renderJournal } = await import("../src/screens/journal.js");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await renderJournal(root);
    root.querySelector('[data-view="week"]').click();
    expect(root.querySelectorAll(".week-cell").length).toBe(7);
  });
});

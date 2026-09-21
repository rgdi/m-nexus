// tests/flashcardsV224.test.ts — v2.24.0 schema migration + atomic-extract
//
// Cubre:
//   1. Backfill de cards legadas (sin cardType/fsrs/elaborations/relatedTo/interleaveGroup)
//   2. POST /flashcards/atomic-extract comportamiento end-to-end
//   3. POST /notes/:id/extract-flashcards con split de mega-tarjetas
//   4. inferencia de cardType (auto-backfill) cuando falta en JSON

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_FILE = join(process.cwd(), "data", "flashcards.json");

import {
  backfillFlashcard,
  defaultFsrsState,
  type Flashcard,
  type CardType,
} from "../src/routes/flashcards.js";

beforeEach(async () => {
  // Reset flashcards.json to a legacy state (no v2.24.0 fields)
  const legacy = [
    {
      id: "fc-legacy-1",
      front: "¿Gen de fibrosis quística?",
      back: "CFTR",
      subject: "biología",
      tags: ["recreo"],
      sourceNoteId: "note-1",
      sourceExcerpt: "Gen de fibrosis…",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    },
    {
      // Legacy, con cloze inline en el front — debería auto-detectarse como cloze
      id: "fc-legacy-2",
      front: "El páncreas secreta {{c1::insulina}}",
      back: "insulina",
      subject: "",
      tags: [],
      sourceNoteId: "",
      sourceExcerpt: "",
      createdAt: 1700000000001,
      updatedAt: 1700000001001,
    },
  ];
  await fs.writeFile(DATA_FILE, JSON.stringify(legacy, null, 2));
});

describe("v2.24.0 — backfillFlashcard", () => {
  it("añade cardType inferido (CFTR → basic)", () => {
    const out = backfillFlashcard({
      id: "x", front: "¿Gen de fibrosis quística?", back: "CFTR",
      subject: "", tags: [], sourceNoteId: "", sourceExcerpt: "",
      createdAt: 1, updatedAt: 1,
    });
    expect(out.cardType).toBe("basic");
    expect(out.fsrs.state).toBe("new");
    expect(out.fsrs.stability).toBe(0);
    expect(out.elaborations).toEqual([]);
    expect(out.relatedTo).toEqual([]);
    expect(out.interleaveGroup).toBeNull();
  });

  it("detecta cloze desde contenido inline", () => {
    const out = backfillFlashcard({
      id: "x", front: "El páncreas secreta {{c1::insulina}}", back: "insulina",
      subject: "", tags: [], sourceNoteId: "", sourceExcerpt: "",
      createdAt: 1, updatedAt: 1,
    });
    expect(out.cardType).toBe("cloze");
  });

  it("preserva FSRS state existente si viene de una export ya migrada", () => {
    const out = backfillFlashcard({
      id: "x", front: "¿X?", back: "Y",
      subject: "", tags: [], sourceNoteId: "", sourceExcerpt: "",
      createdAt: 1, updatedAt: 1,
      cardType: "basic",
      fsrs: { stability: 4.5, difficulty: 3, state: "review", reps: 5, lapses: 0, lastReview: 1, due: 2, retrievability: 0.9 },
      elaborations: [{ question: "¿Por qué?", answer: "porque" }],
      relatedTo: ["fc-other"],
      interleaveGroup: "endocrino",
    });
    expect(out.fsrs.stability).toBe(4.5);
    expect(out.fsrs.state).toBe("review");
    expect(out.elaborations[0].answer).toBe("porque");
    expect(out.interleaveGroup).toBe("endocrino");
  });

  it("defaultFsrsState devuelve algo usable", () => {
    const s = defaultFsrsState();
    expect(s.state).toBe("new");
    expect(s.due).toBeGreaterThan(0);
  });
});

describe("v2.24.0 — atomic-extract end-to-end", () => {
  // Antes del primer test, garantizamos sólo 2 cards legacy
  beforeEach(async () => {
    const legacy = [
      { id: "fc-legacy-1", front: "¿Gen de fibrosis quística?", back: "CFTR",
        subject: "biología", tags: ["recreo"], sourceNoteId: "note-1",
        sourceExcerpt: "Gen de fibrosis…", createdAt: 1700000000000, updatedAt: 1700000000000 },
      { id: "fc-legacy-2", front: "El páncreas secreta {{c1::insulina}}", back: "insulina",
        subject: "", tags: [], sourceNoteId: "", sourceExcerpt: "",
        createdAt: 1700000000001, updatedAt: 1700000001001 },
    ];
    await fs.writeFile(DATA_FILE, JSON.stringify(legacy, null, 2));
    // Invalidate service cache by hitting list
    await fetch("http://localhost:4100/api/v1/flashcards").then((r) => r.text());
    // The Service re-reads JSON into cache lazily on next call. Force by reading
    // and one get that triggers a save with re-shape. Simpler: touch the path.
  });

  it("rechaza una mega-tarjeta con Causes/síntomas y propone un split", async () => {
    const body = JSON.stringify({
      noteContent:
        "¿Causas de pancreatitis aguda? A. Alcohol B. Colelitiasis C. Hipertrigliceridemia D. Traumatismo",
      subject: "digestivo",
      autoCreate: false,
    });
    const r = await fetch("http://localhost:4100/api/v1/flashcards/atomic-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    // 0 aceptadas (todas habrían ido al split o rechazarían). Miramos pending.
    expect(j.ok).toBe(true);
    expect(j.split).toBeGreaterThanOrEqual(1);
    expect(j.queuedForApproval).toBeGreaterThan(0);
  });

  it("acepta una cloze atómica pura", async () => {
    const noteContent = "El gen mutado en fibrosis quística es {{c1::CFTR}}.";
    const r = await fetch("http://localhost:4100/api/v1/flashcards/atomic-extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteContent, subject: "biología", autoCreate: true }),
    });
    const j = await r.json();
    expect(j.persisted).toBeGreaterThanOrEqual(1);
    expect(j.accepted).toBeGreaterThanOrEqual(1);
  });

  it("no destruye las cards legacy — el backfill es no destructivo", async () => {
    // Cargamos todas las cards (provocamos backfill)
    const r1 = await fetch("http://localhost:4100/api/v1/flashcards");
    const j1 = await r1.json();
    expect(j1.cards.length).toBe(2);
    // Comprobar backfill sobre legacy-2 (tenía cloze)
    const card2 = j1.cards.find((c: any) => c.id === "fc-legacy-2");
    expect(card2.cardType).toBe("cloze");
    expect(card2.fsrs).toBeDefined();
    expect(card2.fsrs.state).toBe("new");
  });
});

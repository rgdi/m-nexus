// tests/v238res.test.ts — v2.38.1 resource generation.
//
// Shape borrowed from SurfSense's podcast pipeline (outline.py, draft.py):
// plan the document first, then write each part against that shared plan
// with a bounded recap of what came before.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateResource,
  buildMindMap,
  RESOURCE_KINDS,
  type Chunk,
} from "../src/services/resourceGenerator.js";
import { invalidateIndex } from "../src/services/folderRag.js";

let dir: string;
let before: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "res-"));
  before = process.cwd();
  process.chdir(dir);
  await fs.mkdir(join(dir, "data"), { recursive: true });
  // v2.38.1: the generator grounds itself through the per-user store,
  // so the fixture is seeded there rather than in data/*.json.
  const { writeCollection } = await import("../src/services/userStore.js");
  await writeCollection("default", "folders.json", [
    { id: "gen", name: "Genética", parentId: null, color: "", icon: "", createdAt: 0, updatedAt: 0 },
    { id: "qui", name: "Química", parentId: null, color: "", icon: "", createdAt: 0, updatedAt: 0 },
  ]);
  await writeCollection("default", "notes.json", [
    { id: "n1", title: "Fibrosis quística", folderId: "gen", subject: "bio", tags: [], pages: [], createdAt: 0, updatedAt: 0,
      body: "La fibrosis quística es una enfermedad autosómica recesiva.\n\nSe debe a una mutación en el gen CFTR.\n\nEl tratamiento incluye mucolíticos y fisioterapia respiratoria." },
    { id: "n2", title: "Herencia", folderId: "gen", subject: "bio", tags: [], pages: [], createdAt: 0, updatedAt: 0,
      body: "La herencia mendeliana sigue las leyes de Mendel.\n\nLa segregación describe cómo se separan los alelos." },
    { id: "n3", title: "pH", folderId: "qui", subject: "qui", tags: [], pages: [], createdAt: 0, updatedAt: 0,
      body: "La acidosis respiratoria baja el pH por retención de CO2." },
  ]);
  invalidateIndex();
});

afterEach(async () => {
  process.chdir(before);
  await fs.rm(dir, { recursive: true, force: true });
  invalidateIndex();
});

/** A model that answers whatever stage is being asked. */
function fakeModel(opts: { plan?: any; cards?: any; quiz?: any; section?: (i: number) => string } = {}) {
  const seen: string[] = [];
  return {
    seen,
    call: async (prompt: string) => {
      seen.push(prompt);
      if (prompt.includes("planifica la estructura")) {
        return opts.plan ?? JSON.stringify({
          title: "Fibrosis quística",
          sections: [
            { heading: "Qué es", what: "definición" },
            { heading: "Causa", what: "gen implicado" },
          ],
        });
      }
      if (prompt.includes("tarjetas de estudio")) {
        return opts.cards ?? JSON.stringify({
          cards: [
            { front: "¿Qué gen causa la fibrosis quística?", back: "El gen CFTR [1]" },
            { front: "¿Cómo se hereda?", back: "Autosómica recesiva [1]" },
          ],
        });
      }
      if (prompt.includes("opción múltiple")) {
        return opts.quiz ?? JSON.stringify({
          questions: [{
            question: "¿Qué gen está mutado?",
            options: ["CFTR", "BRCA1", "TP53", "EGFR"],
            correctIndex: 0,
            explanation: "La mutación está en CFTR [1].",
          }],
        });
      }
      // A section draft.
      const m = prompt.match(/SECCI[ÓO]N (\d+) de/);
      const i = m ? Number(m[1]) - 1 : 0;
      return opts.section ? opts.section(i) : `Contenido de la sección [1].`;
    },
  };
}

describe("v2.38.1 — catalogue", () => {
  it("offers four kinds", () => {
    expect(RESOURCE_KINDS.map((k) => k.kind)).toEqual(["summary", "flashcards", "quiz", "mindmap"]);
  });

  it("marks the mind map as not needing a model", () => {
    expect(RESOURCE_KINDS.find((k) => k.kind === "mindmap")?.needsLlm).toBe(false);
  });
});

describe("v2.38.1 — summary: plan, then write", () => {
  it("plans before writing anything", async () => {
    const m = fakeModel();
    await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    expect(m.seen[0]).toContain("planifica la estructura");
  });

  it("writes one call per planned section", async () => {
    const m = fakeModel();
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.sections).toHaveLength(2);
    // plan + 2 sections
    expect(m.seen).toHaveLength(3);
  });

  it("shows each section the plan, so they cannot drift", async () => {
    const m = fakeModel();
    await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    for (const prompt of m.seen.slice(1)) {
      expect(prompt).toContain("QUÉ DEBE CUBRIR");
      expect(prompt).toContain("MATERIAL");
    }
  });

  it("passes a bounded recap, not the whole draft", async () => {
    // SurfSense's RECAP_CHARS. Without the bound, a 5-section document
    // carries its own full text into every later call.
    const m = fakeModel({ section: () => "x".repeat(2000) });
    await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    const last = m.seen[m.seen.length - 1];
    const recap = last.split("ACABO DE ESCRIBIR")[1] ?? "";
    expect(recap.length).toBeLessThan(2000);
  });

  it("records which chunk each section cited", async () => {
    const m = fakeModel();
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.sections[0].cites.length).toBeGreaterThan(0);
  });

  it("falls back to one section when the planner returns nothing", async () => {
    // Five invented sections are worse than one honest one.
    const m = fakeModel({ plan: "not json at all" });
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.sections).toHaveLength(1);
  });

  it("stops cleanly when the planner call throws", async () => {
    const r = await generateResource({
      kind: "summary", folderId: "gen", useLlm: true,
      llm: async (p) => { if (p.includes("planifica")) throw new Error("boom"); return "texto [1]"; },
    });
    expect(r.sections.length).toBeGreaterThan(0);
  });
});

describe("v2.38.1 — grounding and scope", () => {
  it("only uses passages from the requested folder", async () => {
    const m = fakeModel();
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.sources.every((s) => s.folderName === "Genética")).toBe(true);
  });

  it("lists the sources it generated from", async () => {
    const m = fakeModel();
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.sources.length).toBeGreaterThan(0);
    expect(r.sources[0]).toHaveProperty("noteId");
    expect(r.sources[0]).toHaveProperty("chunkId");
  });

  it("returns nothing usable when the folder is empty", async () => {
    let called = false;
    const r = await generateResource({
      kind: "flashcards", folderId: "nope", useLlm: true,
      llm: async () => { called = true; return "{}"; },
    });
    expect(called).toBe(false);
    expect(r.cards).toEqual([]);
    expect(r.sources).toEqual([]);
  });

  it("narrowing by topic picks a subset of the folder", async () => {
    const m = fakeModel();
    const wide = await generateResource({ kind: "summary", folderId: "gen", useLlm: true, llm: m.call });
    const narrow = await generateResource({ kind: "summary", folderId: "gen", topic: "mendel", useLlm: true, llm: m.call });
    expect(narrow.sources.length).toBeLessThanOrEqual(wide.sources.length);
  });
});

describe("v2.38.1 — flashcards", () => {
  it("returns cards with citations", async () => {
    const m = fakeModel();
    const r = await generateResource({ kind: "flashcards", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.cards).toHaveLength(2);
    expect(r.cards[0].cites.length).toBeGreaterThan(0);
  });

  it("drops a card with no question", async () => {
    const m = fakeModel({ cards: JSON.stringify({ cards: [{ front: "", back: "x" }, { front: "¿Qué es el CFTR?", back: "Un gen" }] }) });
    const r = await generateResource({ kind: "flashcards", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.cards).toHaveLength(1);
  });

  it("survives unparseable output", async () => {
    const r = await generateResource({
      kind: "flashcards", folderId: "gen", useLlm: true,
      llm: async () => "lo siento",
    });
    expect(r.cards).toEqual([]);
  });
});

describe("v2.38.1 — quiz", () => {
  it("returns questions with options and a key", async () => {
    const m = fakeModel();
    const r = await generateResource({ kind: "quiz", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.quiz).toHaveLength(1);
    expect(r.quiz[0].options).toHaveLength(4);
    expect(r.quiz[0].correctIndex).toBe(0);
  });

  it("repairs a key that points outside the options", async () => {
    // A quiz whose answer key is 7 with four options is a broken quiz,
    // and it is the model that produced it, not the user.
    const m = fakeModel({ quiz: JSON.stringify({ questions: [{
      question: "¿Qué gen está mutado?", options: ["a", "b"], correctIndex: 7, explanation: "e",
    }] }) });
    const r = await generateResource({ kind: "quiz", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.quiz[0].correctIndex).toBe(0);
  });

  it("drops a question with fewer than two options", async () => {
    const m = fakeModel({ quiz: JSON.stringify({ questions: [
      { question: "¿Qué es el CFTR?", options: ["a", "b"], correctIndex: 0, explanation: "" },
      { question: "Esta es mala", options: ["solo"], correctIndex: 0, explanation: "" },
    ] }) });
    const r = await generateResource({ kind: "quiz", folderId: "gen", useLlm: true, llm: m.call });
    expect(r.quiz).toHaveLength(1);
  });
});

describe("v2.38.1 — mind map needs no model at all", () => {
  const chunk = (id: string, text: string): Chunk => ({
    id, noteId: "n1", noteTitle: "T", folderId: "gen", folderName: "Genética",
    subject: "", locator: "", text, words: text.split(/\s+/).length,
  });

  it("works with useLlm off and never calls the model", async () => {
    let called = false;
    const r = await generateResource({
      kind: "mindmap", folderId: "gen",
      llm: async () => { called = true; return "{}"; },
    });
    expect(called).toBe(false);
    expect(r.usedLlm).toBe(false);
    expect(r.mindmap!.length).toBeGreaterThan(0);
  });

  it("branches on Spanish discourse markers", () => {
    const m = buildMindMap([
      chunk("a", "Se define como una enfermedad autosómica recesiva grave."),
      chunk("b", "Se debe a una mutación en el gen CFTR Located."),
      chunk("c", "El tratamiento incluye mucolíticos y fisioterapia."),
    ]);
    const labels = m.map((n) => n.label);
    expect(labels).toContain("Definición");
    expect(labels).toContain("Tratamiento");
  });

  it("caps each branch — a mind map with 40 leaves is a wall of text", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Es una frase larga número ${i} con contenido.`).join(" ");
    const m = buildMindMap([chunk("a", many)]);
    for (const n of m) expect(n.children.length).toBeLessThanOrEqual(6);
  });

  it("every leaf is a sentence that exists in a note", () => {
    // This is why it needs no model: nothing here can be invented.
    const src = "La fibrosis quística es autosómica recesiva. El tratamiento usa mucolíticos.";
    const m = buildMindMap([chunk("a", src)]);
    for (const n of m) {
      for (const leaf of n.children) {
        expect(src).toContain(leaf.replace(/[.]+$/, ""));
      }
    }
  });

  it("ignores fragments too short to be a point", () => {
    expect(buildMindMap([chunk("a", "sí. no. aquí. x")])).toHaveLength(0);
  });
});

describe("v2.38.1 — without a model", () => {
  it("says so instead of pretending", async () => {
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: false });
    expect(r.usedLlm).toBe(false);
    expect(r.llmError).toContain("no model");
    expect(r.sections).toEqual([]);
  });

  it("still grounds the answer in sources", async () => {
    const r = await generateResource({ kind: "summary", folderId: "gen", useLlm: false });
    expect(r.sources.length).toBeGreaterThan(0);
  });
});


describe("v2.38.1 — an empty topic is not a missing-notes message", () => {
  it("never titles a real summary 'I found nothing in your notes'", async () => {
    // Regression: with no topic typed, the planner had no title, and the
    // `|| NO_SOURCE` fallback printed a failure message directly above a
    // summary built from three passages of the user's own notes.
    const out = await generateResource({
      kind: "summary",
      folderId: "gen",
      useLlm: true,
      llm: async (prompt: string) =>
        /plan/i.test(prompt)
          ? JSON.stringify({ title: "", sections: [{ heading: "Genética", what: "lo basico" }] })
          : "La fibrosis quística se debe a una mutación en el gen CFTR.",
    } as any);
    expect(out.sources.length).toBeGreaterThan(0);
    expect(out.sections!.length).toBeGreaterThan(0);
    expect(out.title).not.toMatch(/No encontré nada/);
    expect(out.title).toBeTruthy();
  });

  it("does say so when there genuinely is no material", async () => {
    // A folder with nothing in it is the one case where saying so is
    // the honest answer.
    const { writeCollection } = await import("../src/services/userStore.js");
    await writeCollection("default", "folders.json", [
      { id: "vacio", name: "Vacio", parentId: null, color: "", icon: "", createdAt: 0, updatedAt: 0 },
    ]);
    invalidateIndex();
    const out = await generateResource({ kind: "summary", folderId: "vacio" } as any);
    expect(out.sources.length).toBe(0);
    expect(out.title).toMatch(/No encontré nada/);
  });
});

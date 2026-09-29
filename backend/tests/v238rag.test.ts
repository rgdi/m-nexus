// tests/v238rag.test.ts — v2.38.0 folder-scoped RAG.
//
// Architecture borrowed from open-notebook (github.com/lfnovo/open-notebook),
// graphs/ask.py: strategy → fan-out → synthesis. What matters here is that
// a folder is a hard scope, and that the answer says which passages it used.

import { describe, it, expect, beforeEach } from "vitest";
import {
  chunkNote,
  buildFolderTree,
  tokenise,
  stem,
  rank,
  ask,
  folderStats,
  invalidateIndex,
  buildIndex,
  type Chunk,
  type NoteLike,
} from "../src/services/folderRag.js";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const T0 = new Date(2026, 8, 29).getTime();

/* ------------------------------------------------------------------ */

describe("v2.38.0 — chunking", () => {
  it("returns nothing for an empty body", () => {
    expect(chunkNote({ id: "n1", title: "T", body: "   " })).toEqual([]);
  });

  it("keeps a short note as one chunk", () => {
    const c = chunkNote({ id: "n1", title: "T", body: "Una frase corta." });
    expect(c).toHaveLength(1);
    expect(c[0].noteId).toBe("n1");
  });

  it("splits a long note into several chunks", () => {
    const para = Array.from({ length: 60 }, (_, i) => `palabra${i}`).join(" ");
    const body = Array.from({ length: 6 }, () => para).join("\n\n");
    const c = chunkNote({ id: "n1", title: "T", body });
    expect(c.length).toBeGreaterThan(1);
  });

  it("gives every chunk a unique id", () => {
    const body = Array.from({ length: 8 }, (_, i) => `párrafo número ${i} con texto`).join("\n\n");
    const c = chunkNote({ id: "n1", title: "T", body });
    expect(new Set(c.map((x) => x.id)).size).toBe(c.length);
  });

  it("carries the folder name onto every chunk", () => {
    const c = chunkNote({ id: "n1", title: "T", body: "texto", folderId: "f1" }, "Genética");
    expect(c[0].folderName).toBe("Genética");
  });

  it("records a locator so a citation can point somewhere", () => {
    const body = Array.from({ length: 5 }, (_, i) => `bloque ${i}`).join("\n\n");
    const c = chunkNote({ id: "n1", title: "T", body });
    expect(c.every((x) => typeof x.locator === "string" && x.locator.length > 0)).toBe(true);
  });
});

describe("v2.38.0 — folder tree", () => {
  it("resolves a root folder", () => {
    const t = buildFolderTree([{ id: "a", name: "A", parentId: null }]);
    expect(t.get("a")?.path).toBe("A");
    expect(t.get("a")?.descendants).toEqual(["a"]);
  });

  it("collects descendants so a scope covers a whole branch", () => {
    const t = buildFolderTree([
      { id: "a", name: "Ciencias", parentId: null },
      { id: "b", name: "Genética", parentId: "a" },
      { id: "c", name: "Herencia", parentId: "b" },
    ]);
    expect(t.get("a")?.descendants.sort()).toEqual(["a", "b", "c"]);
    expect(t.get("b")?.path).toBe("Ciencias / Genética");
  });

  it("records depth", () => {
    const t = buildFolderTree([
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: "a" },
    ]);
    expect(t.get("b")?.depth).toBe(1);
  });

  it("survives an orphan whose parent was deleted", () => {
    const t = buildFolderTree([{ id: "x", name: "Huérfana", parentId: "gone" }]);
    expect(t.get("x")?.descendants).toEqual(["x"]);
  });
});

describe("v2.38.0 — lexical scoring", () => {
  const mk = (id: string, text: string): Chunk => ({
    id, noteId: id, noteTitle: id, folderId: null, folderName: "",
    subject: "", locator: "", text, words: text.split(/\s+/).length,
  });

  it("folds accents so 'genetica' matches 'genética'", () => {
    expect(tokenise("genética")).toContain("genetica");
  });

  it("drops stopwords", () => {
    expect(tokenise("la de el en y")).toEqual([]);
  });

  it("folds plurals", () => {
    expect(stem("corazones")).toBe(stem("corazon"));
  });

  it("ranks the chunk that actually contains the term first", () => {
    const chunks = [
      mk("a", "el corazón bombea sangre"),
      mk("b", "la fibrosis quística depende del gen CFTR"),
    ];
    const r = rank(chunks, "CFTR");
    expect(r[0].id).toBe("b");
  });

  it("reports which terms matched", () => {
    const r = rank([mk("a", "el corazón bombea sangre")], "corazón sangre");
    expect(r[0].matched).toContain("corazon");
  });

  it("returns nothing for a query of pure stopwords", () => {
    expect(rank([mk("a", "texto")], "de la el")).toEqual([]);
  });

  it("normalises by length so a long chunk does not win on volume", () => {
    const short = mk("s", "genética mendeliana");
    const long = mk("l", `genética mendeliana ${"relleno ".repeat(80)}`);
    const r = rank([long, short], "genética mendeliana");
    expect(r[0].id).toBe("s");
  });
});

/* ------------------------------------------------------------------ *
 * HTTP behaviour, against a real temp data dir
 * ------------------------------------------------------------------ */

let dir: string;
let before: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "rag-"));
  before = process.cwd();
  process.chdir(dir);
  await fs.mkdir(join(dir, "data"), { recursive: true });
  invalidateIndex();
});

afterEach(async () => {
  process.chdir(before);
  await fs.rm(dir, { recursive: true, force: true });
  invalidateIndex();
});

import { afterEach } from "vitest";

async function seed() {
  await fs.writeFile(join(dir, "data", "folders.json"), JSON.stringify([
    { id: "gen", name: "Genética", parentId: null, color: "", icon: "", createdAt: 0, updatedAt: 0 },
    { id: "qui", name: "Química", parentId: null, color: "", icon: "", createdAt: 0, updatedAt: 0 },
  ]));
  await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([
    { id: "n1", title: "Fibrosis quística", body: "La fibrosis quística se debe a una mutación en el gen CFTR.", subject: "gen", tags: [], pages: [], folderId: "gen", createdAt: 0, updatedAt: 0 },
    { id: "n2", title: "Herencia", body: "La herencia mendeliana sigue las leyes de Mendel.", subject: "gen", tags: [], pages: [], folderId: "gen", createdAt: 0, updatedAt: 0 },
    { id: "n3", title: "Enlace iónico", body: "El enlace iónico transfiere electrones entre átomos.", subject: "qui", tags: [], pages: [], folderId: "qui", createdAt: 0, updatedAt: 0 },
  ]));
  invalidateIndex();
}

describe("v2.38.0 — folder scoping is a filter, not a hint", () => {
  it("only returns passages from the requested folder", async () => {
    await seed();
    const r = await ask("CFTR", { folderId: "gen" });
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.citations.every((c) => c.folderName === "Genética")).toBe(true);
  });

  it("never leaks a sibling folder", async () => {
    await seed();
    const r = await ask("electrones átomos", { folderId: "gen" });
    // The chemistry note is the only match for this, and it is out of scope.
    expect(r.citations.every((c) => c.noteTitle !== "Enlace iónico")).toBe(true);
  });

  it("counts how much was in scope, so the UI can say '3 de 5'", async () => {
    await seed();
    const gen = await ask("CFTR", { folderId: "gen" });
    const all = await ask("CFTR", { folderId: null });
    expect(gen.searched).toBeLessThan(all.searched);
    expect(all.totalChunks).toBeGreaterThan(gen.searched);
  });

  it("searches everything when no folder is given", async () => {
    await seed();
    const r = await ask("electrones", { folderId: null });
    expect(r.citations.some((c) => c.folderName === "Química")).toBe(true);
  });

  it("returns an honest 'not found' rather than an empty citation list", async () => {
    await seed();
    const r = await ask("xyzzy plugh quantum", { folderId: "gen" });
    expect(r.answer).toMatch(/No encontré/);
    expect(r.citations).toEqual([]);
  });
});

describe("v2.38.0 — three-phase ask", () => {
  it("works with no model: citations only, answer empty", async () => {
    await seed();
    const r = await ask("CFTR", { folderId: "gen", useLlm: false });
    expect(r.usedLlm).toBe(false);
    expect(r.answer).toBe("");
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("plans a strategy, then searches each term", async () => {
    await seed();
    const calls: string[] = [];
    const r = await ask("¿Qué es CFTR y cómo se hereda?", {
      folderId: "gen", useLlm: true,
      llm: async (p) => {
        calls.push(p);
        if (p.includes("planifica la búsqueda")) {
          return JSON.stringify({
            reasoning: "Dos conceptos distintos.",
            searches: [
              { term: "CFTR", instructions: "definición" },
              { term: "herencia mendeliana", instructions: "leyes" },
            ],
          });
        }
        return "La fibrosis quística se debe al gen CFTR [1].";
      },
    });
    expect(calls.length).toBe(2);          // strategy + synthesis
    expect(r.searches).toHaveLength(2);
    expect(r.strategy).toContain("Dos conceptos");
    expect(r.answer).toContain("CFTR");
  });

  it("merges a passage found by two branches into one citation", async () => {
    await seed();
    const r = await ask("genética", {
      folderId: "gen", useLlm: true,
      llm: async (p) =>
        p.includes("planifica")
          ? JSON.stringify({ reasoning: "", searches: [
              { term: "CFTR", instructions: "" }, { term: "CFTR fibrosis", instructions: "" }] })
          : "respuesta [1]",
    });
    const ids = r.citations.map((c) => c.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back to one search when the planner returns blanks", async () => {
    // A reasoning model can spend its budget thinking and return a valid
    // object with empty terms. Running five empty searches and answering
    // "no documents found" would be the wrong outcome.
    await seed();
    let synth = 0;
    const r = await ask("CFTR", {
      folderId: "gen", useLlm: true,
      llm: async (p) => {
        if (p.includes("planifica")) {
          return JSON.stringify({ reasoning: "", searches: [{ term: "  ", instructions: "" }] });
        }
        synth++;
        return "Respuesta [1]";
      },
    });
    expect(synth).toBe(1);
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("falls back when the planner call itself throws", async () => {
    await seed();
    const r = await ask("CFTR", {
      folderId: "gen", useLlm: true,
      llm: async (p) => {
        if (p.includes("planifica")) throw new Error("model down");
        return "Respuesta [1]";
      },
    });
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("caps the planner at five searches", async () => {
    await seed();
    const many = Array.from({ length: 9 }, (_, i) => ({ term: `t${i}`, instructions: "" }));
    const r = await ask("CFTR", {
      folderId: "gen", useLlm: true,
      llm: async (p) => (p.includes("planifica") ? JSON.stringify({ reasoning: "", searches: many }) : "x [1]"),
    });
    expect(r.searches.length).toBeLessThanOrEqual(5);
  });

  it("parses a strategy wrapped in a code fence", async () => {
    await seed();
    const r = await ask("CFTR", {
      folderId: "gen", useLlm: true,
      llm: async (p) => p.includes("planifica")
        ? 'Aquí va:\n```json\n{"reasoning":"x","searches":[{"term":"CFTR","instructions":"y"}]}\n```'
        : "Respuesta [1]",
    });
    expect(r.searches[0].term).toBe("CFTR");
  });

  it("honours a refusal instead of passing it through", async () => {
    await seed();
    const r = await ask("CFTR", {
      folderId: "gen", useLlm: true,
      llm: async (p) => (p.includes("planifica")
        ? JSON.stringify({ reasoning: "", searches: [{ term: "CFTR", instructions: "" }] })
        : "No está en mis notas."),
    });
    expect(r.answer).toMatch(/No encontré/);
  });

  it("returns citations even when the synthesis fails", async () => {
    await seed();
    const r = await ask("CFTR", {
      folderId: "gen", useLlm: true,
      llm: async (p) => {
        if (p.includes("planifica")) {
          return JSON.stringify({ reasoning: "", searches: [{ term: "CFTR", instructions: "" }] });
        }
        throw new Error("timeout");
      },
    });
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.llmError).toContain("timeout");
  });

  it("every citation names the note it came from", async () => {
    await seed();
    const r = await ask("CFTR", { folderId: "gen" });
    for (const c of r.citations) {
      expect(c.noteTitle.length).toBeGreaterThan(0);
      expect(c.chunkId).toMatch(/^n\d+#\d+$/);
    }
  });

  it("every citation says which search surfaced it", async () => {
    await seed();
    const r = await ask("CFTR", { folderId: "gen" });
    expect(r.citations.every((c) => c.via.length > 0)).toBe(true);
  });
});

describe("v2.38.0 — index", () => {
  it("rebuilds after a write", async () => {
    await seed();
    const before = await buildIndex();
    expect(before.chunks.length).toBeGreaterThan(0);
    invalidateIndex();
    const after = await buildIndex();
    expect(after.builtAt).toBeGreaterThanOrEqual(before.builtAt);
  });

  it("excludes journal entries from the index", async () => {
    await fs.writeFile(join(dir, "data", "notes.json"), JSON.stringify([
      { id: "j1", title: "Hoy", body: "un diario sobre Mendel", isJournal: true, pages: [], tags: [], createdAt: 0, updatedAt: 0 },
      { id: "n1", title: "Notas", body: "Mendel", pages: [], tags: [], folderId: null, createdAt: 0, updatedAt: 0 },
    ]));
    invalidateIndex();
    const idx = await buildIndex();
    expect(idx.chunks.every((c) => c.noteId !== "j1")).toBe(true);
  });

  it("reports per-folder chunk counts for the picker", async () => {
    await seed();
    const s = await folderStats();
    const gen = s.folders.find((f) => f.id === "gen");
    expect(gen?.chunks).toBeGreaterThan(0);
  });

  it("survives a missing data directory", async () => {
    await fs.rm(join(dir, "data"), { recursive: true, force: true });
    invalidateIndex();
    const r = await ask("cualquier cosa", { folderId: "gen" });
    expect(r.totalChunks).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Retrieval shape — borrowed from SurfSense
 * ------------------------------------------------------------------ */

describe("v2.38.0 — per-note cap", () => {
  const mk = (note: string, text: string, i = 0): Chunk => ({
    id: `${note}#${i}`, noteId: note, noteTitle: note, folderId: null,
    folderName: "", subject: "", locator: "", text, words: text.split(/\s+/).length,
  });

  it("one long note cannot fill the whole result list", () => {
    // SurfSense's _cap_chunks_per_document. Ten chunks from one note and
    // one each from four others: without the cap, the first note's ten
    // chunks all outrank everything and the other notes vanish.
    const chunks = [
      ...Array.from({ length: 10 }, (_, i) => mk("largo", `genética mendeliana parte ${i}`, i)),
      mk("b", "genética mendeliana", 0),
      mk("c", "genética mendeliana", 0),
      mk("d", "genética mendeliana", 0),
    ];
    const r = rank(chunks, "genética mendeliana", { maxPerNote: 3 });
    expect(r.length).toBeLessThan(chunks.length);
    expect(new Set(r.map((x) => x.noteId)).size).toBeGreaterThan(1);
  });

  it("keeps the matched chunks, not the trailing ones", () => {
    const chunks = Array.from({ length: 8 }, (_, i) => mk("n", `relleno ${i}`, i));
    // Only the last chunk actually contains the term.
    chunks[7].text = "genética mendeliana";
    chunks[7].words = 2;
    const r = rank(chunks, "genética mendeliana", { maxPerNote: 2 });
    expect(r[0].id).toBe("n#7");
  });

  it("is a no-op when no note exceeds the cap", () => {
    const chunks = [mk("a", "genética mendeliana", 0), mk("b", "genética mendeliana", 0)];
    // Two chunks, two different notes, both matching → neither is capped.
    expect(rank(chunks, "genética", { maxPerNote: 3 })).toHaveLength(2);
  });
});

describe("v2.38.0 — Reciprocal Rank Fusion", () => {
  const mk = (id: string, note: string, text: string): Chunk => ({
    id, noteId: note, noteTitle: note, folderId: null, folderName: "",
    subject: "", locator: "", text, words: text.split(/\s+/).length,
  });

  it("fuses both arms instead of summing raw scores", () => {
    // "a" is a mediocre lexical hit and a strong semantic hit.
    // "b" is the reverse. RRF should not care which arm found what.
    const chunks = [
      mk("a", "n1", "menciona Mendel una vez"),
      mk("b", "n2", "mendeliana mendeliana mendeliana Mendel Mendel"),
    ];
    const sem = new Map([["a", 0.9], ["b", 0.1]]);
    const r = rank(chunks, "Mendel", { semantic: sem });
    // b wins the lexical arm, a wins the semantic arm; with equal
    // weights in RRF the balance is what decides, not the raw 0.9.
    expect(r.every((x) => typeof x.score === "number")).toBe(true);
    expect(r[0].via).toBe("fused");
  });

  it("falls back to the lexical arm when no embeddings exist", () => {
    const chunks = [mk("a", "n1", "hola mundo"), mk("b", "n2", "adios planeta")];
    const r = rank(chunks, "mundo", { semantic: new Map() });
    expect(r[0].id).toBe("a");
    expect(r[0].via).toBe("lexical");
  });

  it("reports the arm that surfaced each result", () => {
    const chunks = [mk("a", "n1", "hola mundo")];
    expect(rank(chunks, "mundo")[0].via).toBe("lexical");
    expect(rank(chunks, "mundo", { semantic: new Map([["a", 0.5]]) })[0].via).toBe("fused");
  });

  it("does not need the two scores to share a scale", () => {
    // The whole point of RRF. Cosine here is 1000x larger than any BM25
    // score could be, so `lexical * 0.7 + semantic * 0.3` would be decided
    // entirely by that 1000 and the lexical signal would vanish.
    //
    // Both chunks match "hola" equally in the lexical arm; b's 1000 vs
    // a's 0 is the entire semantic signal. The two arms therefore hand
    // out rank 0 and rank 1 once each, so the fused totals come out EQUAL.
    // That tie is the proof — the magnitude of 1000 had no influence.
    const chunks = [mk("a", "n1", "hola mundo"), mk("b", "n2", "hola planeta")];
    const sem = new Map([["a", 0.0], ["b", 1000.0]]);
    const r = rank(chunks, "hola", { semantic: sem });
    expect(r[0].score).toBeCloseTo(r[1].score, 6);
    // And a fused score is a rank statistic, not a raw distance.
    expect(r[0].score).toBeCloseTo(1 / 61 + 1 / 62, 5);
  });

});

/* ------------------------------------------------------------------ *
 * Conversational retrieval — from Khoj
 * ------------------------------------------------------------------ */

describe("v2.38.0 — the history reaches the planner", () => {
  it("follow-up questions are answerable because of the history", async () => {
    await seed();
    // "¿Y el tratamiento?" has no noun the index can match on its own.
    // With the previous turns in the prompt the planner resolves the
    // pronoun and searches for the disease that was just discussed.
    let planned = "";
    const r = await ask("¿Y el tratamiento?", {
      folderId: "gen", useLlm: true,
      history: [
        { role: "user", text: "¿Qué es la fibrosis quística?" },
        { role: "assistant", text: "Es una enfermedad autosómica recesiva causada por mutaciones en CFTR." },
      ],
      llm: async (p) => {
        if (p.includes("planifica")) {
          expect(p).toContain("CONVERSACIÓN PREVIA");
          expect(p).toContain("fibrosis quística");
          planned = p;
          return JSON.stringify({
            reasoning: "Resuelvo la referencia al tema anterior.",
            searches: [{ term: "fibrosis quística tratamiento", instructions: "tratamiento" }],
          });
        }
        return "El tratamiento incluye mucolíticos [1].";
      },
    });
    expect(planned).not.toBe("");
    expect(r.searches[0].term).toContain("fibrosis");
    expect(r.citations.length).toBeGreaterThan(0);
  });

  it("says nothing about history when there is none", async () => {
    await seed();
    let prompt = "";
    await ask("¿Qué es el CFTR?", {
      folderId: "gen", useLlm: true,
      llm: async (p) => {
        if (p.includes("planifica")) {
          prompt = p;
          return JSON.stringify({ reasoning: "", searches: [{ term: "CFTR", instructions: "" }] });
        }
        return "x [1]";
      },
    });
    expect(prompt).not.toContain("CONVERSACIÓN PREVIA");
  });

  it("only sends the recent turns, not the whole transcript", async () => {
    await seed();
    const history = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const, text: `pregunta numero ${i}`,
    }));
    let prompt = "";
    await ask("final", {
      folderId: "gen", useLlm: true, history,
      llm: async (p) => {
        if (p.includes("planifica")) { prompt = p; return '{"searches":[{"term":"final","instructions":""}]}'; }
        return "x [1]";
      },
    });
    expect(prompt).toContain("pregunta numero 19");
    expect(prompt).not.toContain("pregunta numero 0");
  });
});

describe("v2.38.0 — web fallback is opt-in and labelled", () => {
  it("does not touch the web by default", async () => {
    await seed();
    let called = false;
    const r = await ask("xyzzy plugh quantum", {
      folderId: "gen",
      webSearch: async () => { called = true; return []; },
    });
    expect(called).toBe(false);
    expect(r.web).toBeUndefined();
  });

  it("goes to the web when allowed and says so", async () => {
    await seed();
    const r = await ask("xyzzy plugh quantum", {
      folderId: "gen", allowWeb: true,
      webSearch: async () => [{ title: "Resultado", url: "https://x.test", snippet: "s" }],
    });
    expect(r.web).toHaveLength(1);
    expect(r.answer).toMatch(/web/i);
  });

  it("never dresses a web result up as a note citation", async () => {
    await seed();
    const r = await ask("xyzzy plugh quantum", {
      folderId: "gen", allowWeb: true,
      webSearch: async () => [{ title: "Resultado", url: "https://x.test", snippet: "s" }],
    });
    expect(r.citations).toEqual([]);
  });

  it("stays quiet when the web has nothing either", async () => {
    await seed();
    const r = await ask("xyzzy plugh quantum", {
      folderId: "gen", allowWeb: true, webSearch: async () => [],
    });
    expect(r.web).toBeUndefined();
    expect(r.answer).toMatch(/No encontré/);
  });

  it("prefers the notes when they have the answer, even with web allowed", async () => {
    await seed();
    let called = false;
    const r = await ask("CFTR", {
      folderId: "gen", allowWeb: true,
      webSearch: async () => { called = true; return [{ title: "w", url: "u", snippet: "s" }]; },
    });
    expect(called).toBe(false);
    expect(r.citations.length).toBeGreaterThan(0);
  });
});

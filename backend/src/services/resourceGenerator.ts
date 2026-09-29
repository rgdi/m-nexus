// services/resourceGenerator.ts — v2.38.1
//
// Turn a folder (or the whole library) into study material: a summary, a
// flashcard deck, a quiz, or a mind map — with every claim carrying the
// note it came from.
//
// ── Where the shape comes from ─────────────────────────────────────
// SurfSense (github.com/MODSetter/SurfSense), the podcast pipeline at
// `surfsense_local/backend/worker/studio/media/audio/podcast/`:
//
//   outline.py  — plan the episode first. One Segment per beat, each
//                 with its own talking points and a word target.
//   draft.py    — draft each segment on its own against the SHARED plan,
//                 with `RECAP_CHARS = 800` of the text written so far, so
//                 a segment continues the episode instead of restarting
//                 it, without carrying the whole thing in every call.
//
// That is the part worth copying. Asking a model for a 2000-word summary
// in one shot produces a document that drifts: the last third repeats the
// first, or quietly contradicts it, and when it does you cannot tell
// which half to believe. Planning the shape first and writing each part
// against a fixed plan — with only a bounded recap of what came before —
// keeps the whole thing on the rails and makes each part independently
// checkable against its citations.
//
// The other borrowed idea is the one from `docs/v2.38.md`: a generation
// that says "from your notes" must be checkable, so every section carries
// the chunk ids it used, and a claim with no support is reported as such
// rather than quietly shipped.

import { generateCompletion } from "./aiProviders.js";
import { logOp } from "../utils/log.js";
import { buildIndex, rank, type Chunk, type ScoredChunk } from "./folderRag.js";

/* ------------------------------------------------------------------ *
 * What can be generated
 * ------------------------------------------------------------------ */

export type ResourceKind = "summary" | "flashcards" | "quiz" | "mindmap";

export const RESOURCE_KINDS: Array<{ kind: ResourceKind; label: string; needsLlm: boolean }> = [
  { kind: "summary", label: "Resumen", needsLlm: true },
  { kind: "flashcards", label: "Mazo de tarjetas", needsLlm: true },
  { kind: "quiz", label: "Quiz", needsLlm: true },
  { kind: "mindmap", label: "Mapa mental", needsLlm: false },
];

export interface SourceRef {
  chunkId: string;
  noteId: string;
  noteTitle: string;
  folderName: string;
  locator: string;
  snippet: string;
}

export interface SummarySection {
  heading: string;
  body: string;
  /** Chunk ids this section actually used. Empty means unsupported. */
  cites: string[];
}

export interface GeneratedFlashcard {
  front: string;
  back: string;
  cites: string[];
}

export interface GeneratedQuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  cites: string[];
}

export interface MindMapNode {
  label: string;
  children: string[];
  cites: string[];
}

export interface ResourceResult {
  kind: ResourceKind;
  title: string;
  /** Present for summary. */
  sections?: SummarySection[];
  /** Present for flashcards. */
  cards?: GeneratedFlashcard[];
  /** Present for quiz. */
  quiz?: GeneratedQuizQuestion[];
  /** Present for mindmap. */
  mindmap?: MindMapNode[];
  /** Everything the index put in scope, for the "generated from" footer. */
  sources: SourceRef[];
  usedLlm: boolean;
  llmError?: string;
  durationMs: number;
}

/* ------------------------------------------------------------------ *
 * Grounding
 * ------------------------------------------------------------------ */

const LETTER = "[\\p{L}\\p{N}]";
const bounded = (p: string) => `(?<!${LETTER})(?:${p})(?!${LETTER})`;

/**
 * Pick the passages the generation is allowed to use.
 *
 * The whole library is not the input. A summary over 300 chunks is both
 * expensive and incoherent; the retrieval step narrows it to the passages
 * that actually relate to the topic, and only those become `sources`.
 */
function ground(chunks: Chunk[], topic: string, limit: number): ScoredChunk[] {
  // With no topic this is not a search. "Summarise this folder" means
  // "use this folder's content", and running `rank()` against the literal
  // words "resumen general" returns nothing on any corpus that does not
  // happen to contain that phrase — which is all of them.
  //
  // So: no topic → take the material itself, in reading order, at most
  // two passages per note so one long note cannot take the whole budget.
  if (!topic.trim()) {
    const perNote = new Map<string, number>();
    const out: ScoredChunk[] = [];
    for (const c of chunks) {
      const n = perNote.get(c.noteId) ?? 0;
      if (n >= 2) continue;
      perNote.set(c.noteId, n + 1);
      out.push({ ...c, score: 1, lexical: 0, semantic: null, matched: [], via: "lexical" });
      if (out.length >= limit) break;
    }
    return out;
  }
  return rank(chunks, topic, { limit, maxPerNote: 2 });
}

function toRef(c: ScoredChunk): SourceRef {
  return {
    chunkId: c.id,
    noteId: c.noteId,
    noteTitle: c.noteTitle,
    folderName: c.folderName,
    locator: c.locator,
    snippet: c.text.length > 300 ? c.text.slice(0, 297) + "…" : c.text,
  };
}

function contextBlock(picked: ScoredChunk[]): string {
  return picked
    .map((c, i) => `[${i + 1}] (id: ${c.id} — ${c.noteTitle}${c.folderName ? `, ${c.folderName}` : ""})\n${c.text}`)
    .join("\n\n");
}

/** Parse JSON the way models actually emit it: fenced, or buried in prose. */
function parseJson(raw: string): any | null {
  const fenced = String(raw ?? "").match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : String(raw ?? "");
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

/* ------------------------------------------------------------------ *
 * Mind map — the only one that needs no model
 * ------------------------------------------------------------------ */

const TOPIC_HINTS: Array<{ re: RegExp; label: string }> = [
  { re: new RegExp(bounded(`definici[oó]n|se\\s+define|denominad[oa]|llamad[oa]|conocid[oa]\\s+como|se\\s+caracteriza`), "iu"), label: "Definición" },
  { re: new RegExp(bounded(`se\\s+compone|consta\\s+de|formado\\s+por|estructura|partes\\s+de`), "iu"), label: "Estructura" },
  { re: new RegExp(bounded(`se\\s+relaciona|relaci[oó]n|conecta|depende\\s+de|a\\s+su\\s+vez|influye`), "iu"), label: "Relaciones" },
  { re: new RegExp(bounded(`causa|debido\\s+a|porque|origen|etiolog[ií]a`), "iu"), label: "Causas" },
  { re: new RegExp(bounded(`tratamiento|terapia|f[oó]rmaco|medicamento|intervenci[oó]n`), "iu"), label: "Tratamiento" },
  { re: new RegExp(bounded(`s[ií]ntoma|signo|manifestaci[oó]n|cl[ií]nic`), "iu"), label: "Síntomas" },
  { re: new RegExp(bounded(`ejemplo|caso|por\\s+ejemplo`), "iu"), label: "Ejemplos" },
  { re: new RegExp(bounded(`diferencia|se\\s+diferencia|en\\s+contra|comparaci[oó]n`), "iu"), label: "Diferencias" },
  { re: new RegExp(bounded(`fórmula|ecuaci[oó]n|ley|t[eé]orema|regla`), "iu"), label: "Fórmulas y leyes" },
  { re: new RegExp(bounded(`riesgo|complicaci[oó]n|efecto\\s+adverso`), "iu"), label: "Riesgos" },
];

function firstSentence(t: string): string {
  const m = t.match(/^[^.!?\n]+[.!?]?/);
  return (m ? m[0] : t).trim();
}

/**
 * Build a mind map with no model at all.
 *
 * The point of this one is that it works offline, costs nothing, and
 * cannot hallucinate: every node is a sentence lifted from a note, and
 * the branch it lands on is decided by which of a fixed set of Spanish
 * discourse markers that sentence opens with. A model would produce
 * prettier labels; it would also produce labels that are not in the
 * notes, which defeats the purpose of a study aid built from them.
 */
export function buildMindMap(picked: ScoredChunk[]): MindMapNode[] {
  const branches = new Map<string, string[]>();
  const cites = new Map<string, Set<string>>();

  for (const c of picked) {
    for (const sentence of c.text.split(/(?<=[.!?])\s+/)) {
      const s = firstSentence(sentence);
      if (s.length < 18 || s.length > 180) continue;
      const hint = TOPIC_HINTS.find((h) => h.re.test(s));
      const label = hint?.label ?? "Ideas";
      if (!branches.has(label)) branches.set(label, []);
      branches.get(label)!.push(s);
      if (!cites.has(label)) cites.set(label, new Set());
      cites.get(label)!.add(c.id);
    }
  }

  // Cap each branch: a mind map with 40 leaves is a wall of text, and
  // the marginal value of leaf 40 over leaf 6 is close to zero.
  const order = ["Definición", "Causas", "Síntomas", "Tratamiento", "Fórmulas y leyes", "Diferencias", "Ejemplos", "Riesgos", "Ideas"];
  return order
    .filter((l) => branches.has(l))
    .slice(0, 8)
    .map((label) => ({
      label,
      children: [...new Set(branches.get(label)!)].slice(0, 6),
      cites: [...(cites.get(label) ?? [])],
    }));
}

/* ------------------------------------------------------------------ *
 * The model-driven kinds
 * ------------------------------------------------------------------ */

const PLAN_PROMPT = `Eres un profesor. Antes de escribir, planifica la estructura.

Devuelve SOLO JSON con esta forma:
{"title":"...","sections":[{"heading":"...","what":"qué debe cubrir esa sección, en una frase"}]}

Entre 3 y 6 secciones. Cada sección cubre un aspecto DISTINTO. No repitas.
El título va en el idioma del material.

TEMA: {topic}
MATERIAL:
{context}`;

const SECTION_PROMPT = `Escribe UNA sección de un documento de estudio.

Reglas:
- Solo información del MATERIAL. Nada de conocimiento general.
- Cita con el número entre corchetes, p. ej. [2], al final de cada frase que lo necesite.
- Si el material no cubre lo que te pedí, escribe exactamente: "No está en mis notas."
- No inventes números ni fuentes.

DOCUMENTO: {title}
SECCIÓN {i} de {n}: {heading}
QUÉ DEBE CUBRIR: {what}

MATERIAL:
{context}

ACABO DE ESCRIBIR (para no repetir, no para citar):
{recap}`;

/** SurfSense's RECAP_CHARS. Bounded, or the whole draft goes in every call. */
const RECAP_CHARS = 800;

function recapOf(sections: SummarySection[]): string {
  const tail = sections.slice(-2).map((s) => `${s.heading}: ${s.body}`).join("\n");
  return tail.length > RECAP_CHARS ? "…" + tail.slice(-RECAP_CHARS) : tail;
}

function citesIn(text: string, picked: ScoredChunk[]): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const c = picked[Number(m[1]) - 1];
    if (c) out.add(c.id);
  }
  return [...out];
}

const NO_SOURCE = "No encontré nada en tus notas sobre eso.";

async function genSummary(
  topic: string, picked: ScoredChunk[], call: (p: string) => Promise<string>,
): Promise<{ title: string; sections: SummarySection[] }> {
  if (picked.length === 0) return { title: topic, sections: [] };

  // Phase 1 — the plan. This is what stops the drift.
  let title = topic;
  let plan: Array<{ heading: string; what: string }> = [];
  try {
    const raw = await call(PLAN_PROMPT
      .replace("{topic}", topic || "(el material completo)")
      .replace("{context}", contextBlock(picked)));
    const j = parseJson(raw);
    if (j) {
      title = String(j.title ?? topic).slice(0, 120) || topic;
      plan = Array.isArray(j.sections)
        ? j.sections
            .map((s: any) => ({ heading: String(s?.heading ?? "").trim(), what: String(s?.what ?? "").trim() }))
            .filter((s: any) => s.heading.length > 0)
            .slice(0, 6)
        : [];
    }
  } catch (e: any) {
    logOp("resource", "summary plan failed", false, { error: String(e?.message ?? e) });
  }
  if (plan.length === 0) {
    // The planner failed or returned nothing usable. One section is
    // honest; five invented ones are not.
    plan = [{ heading: "Resumen", what: "resume el material disponible" }];
  }

  // Phase 2 — each section against the shared plan, with a bounded recap.
  const sections: SummarySection[] = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    let body = "";
    try {
      body = String(await call(SECTION_PROMPT
        .replace("{title}", title)
        .replace("{i}", String(i + 1))
        .replace("{n}", String(plan.length))
        .replace("{heading}", p.heading)
        .replace("{what}", p.what)
        .replace("{context}", contextBlock(picked))
        .replace("{recap}", sections.length ? recapOf(sections) : "(nada todavía)"))).trim();
    } catch (e: any) {
      logOp("resource", "summary section failed", false, { i, error: String(e?.message ?? e) });
      break;
    }
    if (!body) break;
    sections.push({ heading: p.heading, body, cites: citesIn(body, picked) });
  }

  return { title, sections };
}

const CARDS_PROMPT = `Crea tarjetas de estudio a partir del MATERIAL.

Devuelve SOLO JSON: {"cards":[{"front":"pregunta","back":"respuesta"}]}
Entre 5 y 15 tarjetas. Preguntas concretas y respondibles en una frase.
Solo contenido del MATERIAL. Nada de conocimiento general.

MATERIAL:
{context}`;

async function genFlashcards(
  picked: ScoredChunk[], call: (p: string) => Promise<string>,
): Promise<GeneratedFlashcard[]> {
  if (picked.length === 0) return [];
  let raw = "";
  try {
    raw = await call(CARDS_PROMPT.replace("{context}", contextBlock(picked)));
  } catch (e: any) {
    logOp("resource", "flashcards failed", false, { error: String(e?.message ?? e) });
    return [];
  }
  const j = parseJson(raw);
  if (!j || !Array.isArray(j.cards)) return [];
  return j.cards
    .map((c: any) => ({
      front: String(c?.front ?? "").trim(),
      back: String(c?.back ?? "").trim(),
      // A card gets the citations of the chunks its own text touches,
      // which is a weaker link than the summary's but a real one.
      cites: [...new Set([
        ...citesIn(String(c?.back ?? ""), picked),
        ...citesIn(String(c?.front ?? ""), picked),
      ])],
    }))
    .filter((c: GeneratedFlashcard) => c.front.length > 2 && c.back.length > 1)
    .slice(0, 20);
}

const QUIZ_PROMPT = `Crea un quiz de opción múltiple a partir del MATERIAL.

Devuelve SOLO JSON:
{"questions":[{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}]}

Entre 5 y 10 preguntas. 4 opciones cada una. correctIndex empieza en 0.
Distractores plausibles pero falsos, tomados de lo que hay en el material.
Solo contenido del MATERIAL.

MATERIAL:
{context}`;

async function genQuiz(
  picked: ScoredChunk[], call: (p: string) => Promise<string>,
): Promise<GeneratedQuizQuestion[]> {
  if (picked.length === 0) return [];
  let raw = "";
  try {
    raw = await call(QUIZ_PROMPT.replace("{context}", contextBlock(picked)));
  } catch (e: any) {
    logOp("resource", "quiz failed", false, { error: String(e?.message ?? e) });
    return [];
  }
  const j = parseJson(raw);
  if (!j || !Array.isArray(j.questions)) return [];
  return j.questions
    .map((q: any) => {
      const options = Array.isArray(q?.options) ? q.options.map((o: any) => String(o).trim()) : [];
      let ci = Number(q?.correctIndex);
      return {
        question: String(q?.question ?? "").trim(),
        options,
        // A quiz whose key points outside the options is a broken quiz.
        correctIndex: Number.isInteger(ci) && ci >= 0 && ci < options.length ? ci : 0,
        explanation: String(q?.explanation ?? "").trim(),
        cites: citesIn(`${q?.question ?? ""} ${q?.explanation ?? ""}`, picked),
      };
    })
    .filter((q: GeneratedQuizQuestion) => q.question.length > 4 && q.options.length >= 2)
    .slice(0, 15);
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface GenerateOptions {
  kind: ResourceKind;
  /** "" or null means the whole library. */
  folderId?: string | null;
  /** Free text narrowing which passages are used. */
  topic?: string;
  /** How many passages feed the generation. */
  limit?: number;
  useLlm?: boolean;
  llm?: (p: string) => Promise<string>;
}

export async function generateResource(opts: GenerateOptions): Promise<ResourceResult> {
  const t0 = Date.now();
  const index = await buildIndex();
  const topic = (opts.topic ?? "").trim();

  const scope = opts.folderId
    ? index.chunks.filter((c) => c.folderId === opts.folderId)
    : index.chunks;

  const picked = ground(scope, topic, opts.limit ?? 12);
  const sources = picked.map(toRef);

  const base = { kind: opts.kind, sources };

  if (picked.length === 0) {
    return {
      ...base,
      // The one place a "nothing found" title is honest: there really
      // are no sources.
      title: topic || NO_SOURCE,
      sections: opts.kind === "summary" ? [] : undefined,
      cards: opts.kind === "flashcards" ? [] : undefined,
      quiz: opts.kind === "quiz" ? [] : undefined,
      mindmap: opts.kind === "mindmap" ? [] : undefined,
      usedLlm: false,
      durationMs: Date.now() - t0,
    };
  }

  // The mind map is deterministic by construction, so it never needs a
  // model and works with the radio off.
  if (opts.kind === "mindmap") {
    const mindmap = buildMindMap(picked);
    return {
      ...base,
      title: topic || (sources[0]?.folderName || "Mapa mental"),
      mindmap,
      usedLlm: false,
      durationMs: Date.now() - t0,
    };
  }

  if (!opts.useLlm) {
    const call = opts.llm;
    if (!call) {
      return {
        ...base,
        title: topic || "Sin modelo configurado",
        sections: [], cards: [], quiz: [],
        usedLlm: false,
        llmError: "no model available",
        durationMs: Date.now() - t0,
      };
    }
  }

  const call = opts.llm ?? ((p: string) => generateCompletion(p, { temperature: 0.3, maxTokens: 1400 }));

  try {
    if (opts.kind === "summary") {
      const { title, sections } = await genSummary(topic, picked, call);
      logOp("resource", "summary", true, { sections: sections.length, sources: sources.length, ms: Date.now() - t0 });
      // NO_SOURCE is a statement about the *notes*, not a title. With an
      // empty topic (the common case: "just summarise this folder") the
      // old `title || NO_SOURCE` printed "I found nothing in your notes"
      // directly above a summary built from three passages of them.
      return {
        ...base,
        title: title || topic || sources[0]?.folderName || "Resumen del material",
        sections,
        usedLlm: true,
        durationMs: Date.now() - t0,
      };
    }
    if (opts.kind === "flashcards") {
      const cards = await genFlashcards(picked, call);
      logOp("resource", "flashcards", true, { cards: cards.length, ms: Date.now() - t0 });
      return { ...base, title: topic || "Tarjetas", cards, usedLlm: true, durationMs: Date.now() - t0 };
    }
    const quiz = await genQuiz(picked, call);
    logOp("resource", "quiz", true, { questions: quiz.length, ms: Date.now() - t0 });
    return { ...base, title: topic || "Quiz", quiz, usedLlm: true, durationMs: Date.now() - t0 };
  } catch (e: any) {
    logOp("resource", opts.kind, false, { error: String(e?.message ?? e) });
    return {
      ...base,
      title: topic || "Error",
      sections: [], cards: [], quiz: [],
      usedLlm: true,
      llmError: String(e?.message ?? e),
      durationMs: Date.now() - t0,
    };
  }
}

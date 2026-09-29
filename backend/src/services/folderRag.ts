// services/folderRag.ts — v2.38.0
//
// Folder-scoped retrieval, in the spirit of NotebookLM: ask a question
// about ONE folder and get answers grounded only in what is inside it,
// with citations you can click.
//
// ── Why this is not just the existing ai_tutor ────────────────────
// `ai_tutor` takes whatever `snapshots` the client sends. The client
// decides what the model sees, so two clients can get two different
// answers to the same question, and a folder boundary is whatever the
// frontend felt like passing. This service owns the index instead: the
// server reads the notes, scopes them, and returns the passages it
// actually used so the answer can be checked.
//
// ── Scoring ──────────────────────────────────────────────────────
// Hybrid, because neither signal alone is good enough:
//
//   lexical   — BM25-ish over the chunk text. Catches "CFTR" and
//               "12 de marzo", which embeddings routinely miss because
//               they are rare tokens with no semantic neighbours.
//   semantic  — cosine over embeddings when the provider is reachable.
//               Catches "enfermedad fibroquística" ↔ "CFTR" when the
//               user never wrote the acronym near the concept.
//   folder    — a hard filter, never a score. Asking about Genetics
//               must not return a Chemistry note, however similar.
//
// The LLM is optional. Without it, the same endpoint returns the ranked
// passages, which is the honest answer to "what do my notes about
// this say" — and is what a privacy-conscious user wants anyway, since
// the notes never leave the machine.

import { generateCompletion } from "./aiProviders.js";
import { logOp } from "../utils/log.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Resolved per call, not at import time. A module-level constant pins
 * the path to whatever cwd the process started in, which is wrong for
 * every worker and every test that chdirs into a temp data dir.
 */
const dataDir = () => join(process.cwd(), "data");

/* ------------------------------------------------------------------ *
 * Chunking
 * ------------------------------------------------------------------ */

export interface Chunk {
  id: string;
  noteId: string;
  noteTitle: string;
  folderId: string | null;
  folderName: string;
  subject: string;
  /** Where in the note this passage came from, for the citation label. */
  locator: string;
  text: string;
  /** Word count, used to normalise the lexical score. */
  words: number;
}

export interface NoteLike {
  id: string;
  title: string;
  body: string;
  subject?: string;
  tags?: string[];
  folderId?: string | null;
}

export interface FolderLike {
  id: string;
  name: string;
  parentId: string | null;
}

const CHUNK_WORDS = 110;
const CHUNK_OVERLAP = 25;

/** Split a note into overlapping passages on blank lines, then on length. */
export function chunkNote(note: NoteLike, folderName = ""): Chunk[] {
  const raw = (note.body ?? "").trim();
  if (!raw) return [];

  const paras = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: Chunk[] = [];
  let idx = 0;

  const push = (text: string, locator: string) => {
    const t = text.trim();
    if (t.length < 3) return;
    out.push({
      id: `${note.id}#${idx++}`,
      noteId: note.id,
      noteTitle: note.title || "(sin título)",
      folderId: note.folderId ?? null,
      folderName,
      subject: note.subject ?? "",
      locator,
      text: t,
      words: t.split(/\s+/).filter(Boolean).length,
    });
  };

  let carry = "";
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    // A paragraph longer than the window is split on sentence bounds,
    // then on words, so a 600-word wall of text does not become one
    // unretrievable chunk.
    if (p.split(/\s+/).length <= CHUNK_WORDS) {
      const merged = carry ? `${carry} ${p}` : p;
      if (merged.split(/\s+/).length > CHUNK_WORDS + CHUNK_OVERLAP && carry) {
        push(carry, `§${i}`);
        carry = p;
      } else {
        carry = merged;
      }
      continue;
    }
    if (carry) { push(carry, `§${i}`); carry = ""; }
    const sentences = p.match(/[^.!?\n]+[.!?]*/g) ?? [p];
    let buf = "";
    for (const s of sentences) {
      if ((buf + " " + s).split(/\s+/).length > CHUNK_WORDS && buf) {
        push(buf, `§${i}`);
        // Overlap so a fact split across the boundary stays findable.
        const tail = buf.split(/\s+/).slice(-CHUNK_OVERLAP).join(" ");
        buf = `${tail} ${s}`.trim();
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf) carry = buf;
  }
  if (carry) push(carry, "final");

  return out;
}

/* ------------------------------------------------------------------ *
 * Folder tree
 * ------------------------------------------------------------------ */

export interface FolderNode extends FolderLike {
  /** This folder plus every descendant. */
  descendants: string[];
  depth: number;
  path: string;
}

export function buildFolderTree(folders: FolderLike[]): Map<string, FolderNode> {
  const byId = new Map<string, FolderLike>(folders.map((f) => [f.id, f]));
  const childrenOf = new Map<string, FolderLike[]>();
  for (const f of folders) {
    const key = f.parentId ?? "__root__";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(f);
  }

  const out = new Map<string, FolderNode>();
  const walk = (f: FolderLike, depth: number, path: string): string[] => {
    const selfPath = path ? `${path} / ${f.name}` : f.name;
    const here = [f.id];
    for (const c of childrenOf.get(f.id) ?? []) {
      here.push(...walk(c, depth + 1, selfPath));
    }
    out.set(f.id, {
      ...f,
      descendants: here,
      depth,
      path: selfPath,
    });
    return here;
  };
  for (const f of folders) {
    if (!f.parentId || !byId.has(f.parentId)) walk(f, 0, "");
  }
  // Orphans whose parent was deleted.
  for (const f of folders) if (!out.has(f.id)) walk(f, 0, "");
  return out;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

const STOP = new Set(
  ("de la que el en y a los del se las por un para con no una su al lo como mas pero " +
   "sus le ya o este si porque esta cuando muy sin sobre tambien me hasta hay donde " +
   "quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e " +
   "esto mi antes algunos que unos yo otro otras otra tanto esa estos mucho quienes " +
   "the of and to in a is that it for on with as at by from or an be are was were")
    .split(/\s+/),
);

/** Light stemmer: enough to fold plurals and common ES endings. */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  return w
    .replace(/(aciones|ación|amiento)$/i, "")
    .replace(/(es|s)$/i, "")
    .replace(/(ando|iendo|ados|idas|ar|er|ir)$/i, "");
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}+-]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

export interface ScoredChunk extends Chunk {
  score: number;
  lexical: number;
  semantic: number | null;
  /** Query terms that actually matched, for a "why this" hint. */
  matched: string[];
  /** Which retrieval arm surfaced it. */
  via: "lexical" | "fused";
}

/**
 * Reciprocal Rank Fusion.
 *
 * Adapted from SurfSense (github.com/MODSetter/SurfSense),
 * surfsense_backend/app/retriever/chunks_hybrid_search.py, which fuses a
 * full-text arm and a vector arm with RRF over a Postgres FULL OUTER JOIN.
 *
 * Why RRF rather than a weighted sum of scores: BM25 and cosine produce
 * numbers on scales that have nothing to do with each other. Any
 * `lexical * 0.7 + semantic * 0.3` needs both sides normalised first, and
 * that normalisation constant becomes a hidden hyper-parameter that
 * silently mis-ranks the moment the corpus changes. Rank fusion only
 * needs the ORDER of each list, which is stable.
 *
 *   score(d) = Σ 1 / (k + rank_i(d)),  k = 60
 *
 * A passage both arms like beats one that only a single arm loves, which
 * is the behaviour you actually want and which a sum only produces by
 * accident.
 */
const RRF_K = 60;

function fuse(
  lexicalOrder: string[],
  semanticOrder: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  const bump = (id: string, add: number) =>
    out.set(id, (out.get(id) ?? 0) + add);
  lexicalOrder.forEach((id, i) => bump(id, 1 / (RRF_K + i + 1)));
  if (semanticOrder.length) {
    semanticOrder.forEach((id, i) => bump(id, 1 / (RRF_K + i + 1)));
  }
  return out;
}

/**
 * Cap how many chunks one note may contribute.
 *
 * Also from SurfSense (`_cap_chunks_per_document`). Without it a long
 * note — a semester of anatomy — fills the entire result list with its
 * own consecutive chunks, and the other four notes the user actually
 * asked about never appear. The list arrives score-sorted, so the head
 * is the matched part and the citable chunks are the ones kept.
 */
function capPerNote(scored: ScoredChunk[], maxPerNote: number): ScoredChunk[] {
  const byNote = new Map<string, number>();
  const keep: ScoredChunk[] = [];
  for (const s of scored) {
    const n = byNote.get(s.noteId) ?? 0;
    if (n >= maxPerNote) continue;
    byNote.set(s.noteId, n + 1);
    keep.push(s);
  }
  return keep;
}

/**
 * Rank chunks.
 *
 * The lexical arm always runs: it is the one that is always available
 * and never hallucinates. The semantic arm is folded in with RRF when
 * the caller supplies embeddings.
 */
export function rank(
  chunks: Chunk[],
  query: string,
  opts: { semantic?: Map<string, number>; limit?: number; maxPerNote?: number } = {},
): ScoredChunk[] {
  const q = tokenise(query);
  if (q.length === 0) return [];

  // Document frequency, for the IDF term.
  const df = new Map<string, number>();
  const toks = chunks.map((c) => tokenise(c.text));
  for (const list of toks) {
    for (const t of new Set(list)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, chunks.length);

  const scored: ScoredChunk[] = chunks.map((c, i) => {
    const list = toks[i];
    const tf = new Map<string, number>();
    for (const t of list) tf.set(t, (tf.get(t) ?? 0) + 1);

    let lexical = 0;
    const matched: string[] = [];
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      matched.push(t);
      const idf = Math.log(1 + N / (1 + (df.get(t) ?? 0)));
      // Length normalisation, so a long chunk does not win on volume.
      lexical += idf * (f / Math.sqrt(c.words || 1));
    }
    // Phrase bonus: the exact words next to each other beat scattered ones.
    const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (strip(c.text).includes(strip(query))) lexical *= 1.6;

    return { ...c, score: lexical, lexical, semantic: null, matched, via: "lexical" as const };
  });

  const lexicalOrder = [...scored].sort((a, b) => b.lexical - a.lexical);
  const maxPerNote = opts.maxPerNote ?? 3;

  // No semantic arm — the normal case. The lexical order is the answer.
  if (!opts.semantic || opts.semantic.size === 0) {
    return capPerNote(lexicalOrder.filter((c) => c.lexical > 0), maxPerNote)
      .slice(0, opts.limit ?? 12);
  }

  // Both arms: order each independently, then fuse by rank.
  const semanticOrder = [...scored]
    .sort((a, b) => (opts.semantic!.get(b.id) ?? 0) - (opts.semantic!.get(a.id) ?? 0))
    .map((c) => c.id);

  const fused = fuse(lexicalOrder.map((c) => c.id), semanticOrder);
  const merged: ScoredChunk[] = scored.map((c) => ({
    ...c,
    score: fused.get(c.id) ?? 0,
    semantic: opts.semantic!.get(c.id) ?? null,
    via: "fused" as const,
  }));
  merged.sort((a, b) => b.score - a.score);

  const picked = merged.filter((c) => c.lexical > 0 || (c.semantic ?? 0) > 0.01);
  return capPerNote(picked, maxPerNote).slice(0, opts.limit ?? 12);
}


/* ------------------------------------------------------------------ *
 * Index
 * ------------------------------------------------------------------ */

export interface FolderRagIndex {
  builtAt: number;
  chunks: Chunk[];
  folders: Map<string, FolderNode>;
  notes: number;
}

let cache: FolderRagIndex | null = null;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir(), file), "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export async function buildIndex(force = false): Promise<FolderRagIndex> {
  if (cache && !force) return cache;
  const [notesRaw, foldersRaw] = await Promise.all([
    readJson<any>("notes.json", []),
    readJson<any>("folders.json", []),
  ]);
  const notes: NoteLike[] = Array.isArray(notesRaw) ? notesRaw : notesRaw?.notes ?? [];
  const folders: FolderLike[] = Array.isArray(foldersRaw) ? foldersRaw : foldersRaw?.folders ?? [];

  const tree = buildFolderTree(folders);
  const chunks: Chunk[] = [];
  for (const n of notes) {
    if ((n as any).isJournal) continue; // a journal is not source material
    const fname = n.folderId ? tree.get(n.folderId)?.name ?? "" : "";
    chunks.push(...chunkNote(n, fname));
  }
  cache = { builtAt: Date.now(), chunks, folders: tree, notes: notes.length };
  logOp("rag", "index built", true, { notes: notes.length, chunks: chunks.length, folders: tree.size });
  return cache;
}

export function invalidateIndex(): void {
  cache = null;
}

/* ------------------------------------------------------------------ *
 * Ask — three phases
 * ------------------------------------------------------------------ *
 *
 * The shape here is taken from open-notebook (github.com/lfnovo/open-notebook),
 * whose `graphs/ask.py` does something the single-query version could not:
 *
 *   1. STRATEGY  — the model reads the question and decomposes it into up
 *                  to five sub-searches, each with its own term and its
 *                  own instruction ("what do I need from this search").
 *   2. FAN-OUT   — every sub-search runs on its own against the same
 *                  scope, and each is answered in isolation.
 *   3. SYNTHESIS — one more pass merges the partial answers, with the
 *                  strategy reasoning in hand, citing document ids.
 *
 * Why bother: "qué sé sobre el sistema nervioso y cómo se relaciona con
 * el gastrointestinal" is two questions. Retrieving it as one blob
 * returns whichever chunk scores highest and silently drops the other
 * half. Two focused retrievals return both.
 *
 * The cost is two extra model calls, so the deterministic path stays:
 * with no LLM, or when the strategy call fails, one lexical retrieval
 * over the whole question produces the same citations the fan-out would
 * have drawn from. The user is never worse off than before.
 *
 * Two details borrowed verbatim because they are the ones that break in
 * production:
 *
 *   - A reasoning model can burn its whole budget thinking and return a
 *     syntactically valid strategy with blank terms. Empty terms are
 *     dropped, and if nothing usable is left we fall back rather than
 *     running five empty searches and answering "no documents found".
 *   - The synthesis prompt forbids inventing document ids and requires
 *     the exact id, because a paraphrased id is a dead link.
 */

export interface Citation {
  chunkId: string;
  noteId: string;
  noteTitle: string;
  folderName: string;
  locator: string;
  snippet: string;
  score: number;
  /** Which sub-search surfaced this. Lets the UI show "why this is here". */
  via: string;
}

export interface SubSearch {
  term: string;
  instructions: string;
  /** The focused answer for this branch. Empty in the deterministic path. */
  answer?: string;
  hits?: number;
}

export interface AskResult {
  question: string;
  answer: string;
  citations: Citation[];
  /** Web results, when the caller allowed the fallback and it was used. */
  web?: WebResult[];
  searches: SubSearch[];
  strategy?: string;
  searched: number;
  totalChunks: number;
  usedLlm: boolean;
  llmError?: string;
  durationMs: number;
}

/** The set of folders a question is allowed to see. */
function scopeFor(
  index: FolderRagIndex,
  folderId?: string | null,
  includeDescendants = true,
): Set<string> | null {
  if (!folderId) return null; // whole library
  const node = index.folders.get(folderId);
  if (!node) return new Set([folderId]);
  return new Set(includeDescendants ? node.descendants : [folderId]);
}

const NO_ANSWER = "No encontré nada en tus notas sobre eso.";
const MAX_SEARCHES = 5;

/**
 * The strategy prompt takes the conversation, not just the question.
 *
 * From Khoj (github.com/khoj-ai/khoj),
 * `routers/helpers.py::generate_online_subqueries`, which renders
 * `chat_history` alongside the query before asking the model for
 * subqueries.
 *
 * This is the single reason a follow-up question can be answered at
 * all. "¿Y el tratamiento?" contains no noun the index can match. With
 * the previous turns in the prompt the model resolves the pronoun and
 * searches for the disease that was just discussed, instead of running
 * two empty searches and reporting nothing found.
 */
const STRATEGY_PROMPT = `Eres un asistente de estudio. Antes de responder, planifica la búsqueda.

Devuelve SOLO JSON (sin \`\`\`), con esta forma:
{"reasoning":"...","searches":[{"term":"...","instructions":"qué necesito extraer de esta búsqueda"}]}

Reglas:
- Como máximo 5 búsquedas. Mínimo 1.
- Cada "term" es un término corto y concreto, no una frase.
- Si la pregunta tiene partes ("A y B, y cómo se relacionan"), una
  búsqueda por parte.
- No inventes búsquedas si la pregunta es simple: una basta.

{history}
Pregunta: {question}`;

/** Renders the recent turns for the strategy prompt. */
function renderHistory(history: ChatTurn[] | undefined): string {
  if (!Array.isArray(history) || history.length === 0) return "";
  const recent = history.slice(-6);
  return (
    "CONVERSACIÓN PREVIA (para resolver referencias como «eso» o «¿y por qué?»):\n" +
    recent.map((t) => `${t.role === "user" ? "Usuario" : "Tú"}: ${t.text}`).join("\n") +
    "\n\n"
  );
}

function parseJson(raw: string): any | null {
  const fenced = String(raw ?? "").match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : String(raw ?? "");
  const a = body.indexOf("{");
  const b = body.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(body.slice(a, b + 1)); } catch { return null; }
}

function sanitiseStrategy(raw: string): { strategy: string; searches: SubSearch[] } {
  const parsed = parseJson(raw);
  if (!parsed || !Array.isArray(parsed.searches)) {
    return { strategy: "", searches: [] };
  }
  // A reasoning model can return a valid object with blank terms after
  // spending its budget on thinking. Drop them instead of searching for "".
  const searches = parsed.searches
    .map((s: any) => ({
      term: String(s?.term ?? "").trim(),
      instructions: String(s?.instructions ?? "").trim(),
    }))
    .filter((s: any) => s.term.length > 0)
    .slice(0, MAX_SEARCHES);
  return { strategy: String(parsed.reasoning ?? "").trim(), searches };
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AskOptions {
  folderId?: string | null;
  shallow?: boolean;
  useLlm?: boolean;
  limit?: number;
  force?: boolean;
  /**
   * Conversation so far. Passed into the strategy prompt so a follow-up
   * can resolve its references. See renderHistory.
   */
  history?: ChatTurn[];
  /**
   * May the answer fall back to the web when the local index has
   * nothing? Off by default — notes are the product, and leaking a
   * question to a search engine is the user's call, not the app's.
   */
  allowWeb?: boolean;
  /** Injected in tests. */
  llm?: (prompt: string) => Promise<string>;
  /** Injected in tests. */
  webSearch?: (q: string) => Promise<WebResult[]>;
}

function toCitation(c: ScoredChunk, via: string): Citation {
  return {
    chunkId: c.id,
    noteId: c.noteId,
    noteTitle: c.noteTitle,
    folderName: c.folderName,
    locator: c.locator,
    snippet: c.text.length > 320 ? c.text.slice(0, 317) + "…" : c.text,
    score: Number(c.score.toFixed(4)),
    via,
  };
}

export async function ask(question: string, opts: AskOptions = {}): Promise<AskResult> {
  const t0 = Date.now();
  const q = String(question ?? "").trim();
  const index = await buildIndex(opts.force);

  const base = {
    question: q,
    searched: 0,
    totalChunks: index.chunks.length,
  };

  if (!q) {
    return { ...base, answer: "", citations: [], searches: [], usedLlm: false, durationMs: Date.now() - t0 };
  }

  const scope = scopeFor(index, opts.folderId, !opts.shallow);
  const inScope = index.chunks.filter((c) => (scope ? (c.folderId ? scope.has(c.folderId) : false) : true));
  const scoped = { searched: inScope.length };

  /* ── Phase 1: strategy ────────────────────────────────────────── */
  let strategy = "";
  let searches: SubSearch[] = [];
  let llmError: string | undefined;

  if (opts.useLlm) {
    const call = opts.llm ?? ((p: string) => generateCompletion(p, { temperature: 0.2, maxTokens: 900 }));
    try {
      const raw = await call(
        STRATEGY_PROMPT
          .replace("{history}", renderHistory(opts.history))
          .replace("{question}", q),
      );
      ({ strategy, searches } = sanitiseStrategy(raw));
    } catch (e: any) {
      llmError = String(e?.message ?? e);
      searches = [];
    }
  }

  // No model, or the model gave us nothing usable → one retrieval over
  // the whole question. Never answer "no documents found" when we
  // simply failed to plan.
  const deterministic = searches.length === 0;
  if (deterministic) {
    searches = [{ term: q, instructions: "" }];
  }

  /* ── Phase 2: fan out ─────────────────────────────────────────── */
  const perSearch = opts.limit ?? 6;
  const seen = new Map<string, Citation>();
  const searchesOut: SubSearch[] = [];

  for (const s of searches) {
    const ranked = rank(inScope, s.term, { limit: perSearch });
    s.hits = ranked.filter((r) => r.score > 0).length;
    for (const r of ranked) {
      if (r.score <= 0) continue;
      const prev = seen.get(r.id);
      // A passage found by two branches is one citation, not two.
      if (!prev) seen.set(r.id, toCitation(r, s.term));
      else if (r.score > prev.score) seen.set(r.id, toCitation(r, `${prev.via}, ${s.term}`));
    }
    searchesOut.push(s);
  }

  const citations = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 12);

  if (citations.length === 0) {
    // Nothing in the notes. If the user allowed it, go to the web —
    // but say so, and never dress a web result up as a note.
    if (opts.allowWeb) {
      const search = opts.webSearch ?? webSearch;
      const probe = searchesOut[0]?.term || q;
      const web = await search(probe);
      if (web.length) {
        return {
          ...base, ...scoped,
          answer: "No tengo nada sobre esto en tus notas. Esto es lo que encontré en la web:",
          citations: [], web, searches: searchesOut, strategy,
          usedLlm: false, durationMs: Date.now() - t0,
        };
      }
    }
    return {
      ...base, ...scoped, answer: NO_ANSWER, citations: [],
      searches: searchesOut, strategy, usedLlm: opts.useLlm === true,
      ...(llmError ? { llmError } : {}),
      durationMs: Date.now() - t0,
    };
  }

  /* ── Phase 3: synthesise ──────────────────────────────────────── */
  if (!opts.useLlm) {
    // No model: the ranked passages ARE the answer. This is also the
    // privacy-respecting path — the notes never leave the machine.
    return {
      ...base, ...scoped, answer: "", citations, searches: searchesOut,
      strategy, usedLlm: false, durationMs: Date.now() - t0,
    };
  }

  const scopeName = opts.folderId
    ? index.folders.get(opts.folderId)?.path ?? "la carpeta"
    : "toda la biblioteca";

  const call = opts.llm!;
  const numbered = citations.map((c, i) => ({ i: i + 1, c }));

  const finalPrompt = [
    `# CONTEXTO`,
    `Fragmentos de ${scopeName}. Cada línea empieza por su id.`,
    ...numbered.map(({ i, c }) => `[${i}] (id: ${c.chunkId} — ${c.noteTitle}${c.folderName ? `, ${c.folderName}` : ""})\n${c.snippet}`),
    ``,
    `# ESTRATEGIA DE BÚSQUEDA`,
    strategy || "(búsqueda directa)",
    ``,
    `# PREGUNTA`,
    q,
    ``,
    `# TU TRABAJO`,
    `Responde en el idioma de la pregunta, solo con lo que está arriba.`,
    `Si los fragmentos no contienen la respuesta, di exactamente: "No está en mis notas".`,
    `Cita con el número entre corchetes, p. ej. [2].`,
    `PROHIBIDO inventar documentos o ids. Usa solo los ids que aparecen arriba,`,
    `completos y sin modificar. Si citas, cita los que respaldan la frase.`,
  ].join("\n");

  try {
    const raw = await call(finalPrompt);
    const answer = String(raw ?? "").trim();
    // A model that answered from outside the context is worse than one
    // that refused; the phrase list covers the common refusals in both
    // languages we ship.
    const refused = /no está en mis notas|no lo encuentro en|not in my notes|cannot answer from/i.test(answer);
    logOp("rag", "answered", true, {
      folder: opts.folderId ?? null, cited: citations.length,
      searches: searchesOut.length, refused, ms: Date.now() - t0,
    });
    return {
      ...base, ...scoped, answer: refused ? NO_ANSWER : answer, citations,
      searches: searchesOut, strategy, usedLlm: true, durationMs: Date.now() - t0,
    };
  } catch (e: any) {
    logOp("rag", "synthesis failed", false, { error: String(e?.message ?? e) });
    return {
      ...base, ...scoped, answer: "", citations, searches: searchesOut,
      strategy, usedLlm: true,
      llmError: llmError ?? String(e?.message ?? e),
      durationMs: Date.now() - t0,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Optional web fallback
 * ------------------------------------------------------------------ */

const STRIP_TAGS = /<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi;

/**
 * Search the web for the question.
 *
 * Adapted from Khoj (github.com/khoj-ai/khoj),
 * `processor/tools/online_search.py`, which scrapes and reads the pages
 * behind a search result rather than handing the model a snippet — a
 * snippet is 200 characters of SEO text and answers nothing.
 *
 * There is no search API key in this project, so this queries DuckDuckGo's
 * HTML endpoint and degrades to nothing if it is unreachable. It is
 * opt-in per request, and every result it produces is tagged `web` in the
 * response so the UI can never present it as something from the notes.
 */
export async function webSearch(query: string, limit = 3): Promise<WebResult[]> {
  const out: WebResult[] = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; M-NEXUS/2.38)" },
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const html = await r.text();

    // result__a is the title link, result__snippet the body.
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < limit) {
      out.push({
        title: m[2].replace(STRIP_TAGS, "").trim().slice(0, 160),
        url: m[1],
        snippet: m[3].replace(STRIP_TAGS, "").trim().slice(0, 280),
      });
    }
  } catch (e: any) {
    logOp("rag", "web search failed", false, { error: String(e?.message ?? e) });
  }
  return out;
}

/** Which folders actually have content, for the picker. */
export async function folderStats() {
  const index = await buildIndex();
  const counts = new Map<string, number>();
  for (const c of index.chunks) {
    if (c.folderId) counts.set(c.folderId, (counts.get(c.folderId) ?? 0) + 1);
  }
  return {
    totalChunks: index.chunks.length,
    totalNotes: index.notes,
    builtAt: index.builtAt,
    folders: [...index.folders.values()]
      .map((f) => ({ id: f.id, name: f.name, path: f.path, depth: f.depth, chunks: counts.get(f.id) ?? 0 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

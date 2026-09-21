// flashcards.ts: REST CRUD para flashcards.
// v1.5.1 — extracción desde `{{c1::front::back}}` en body de notas.
// v1.5.2 — asignación automática a asignatura/carpeta (note.subject + note.tags).
// v2.24.0 — Schema migration: cardType + DSR fields + elaborations + relatedTo + interleaveGroup.
//                Las cards antiguas reciben backfill al cargar (defaults nuevos campos).
//
// Modelo:
//   Flashcard {
//     // Identidad y origen
//     id, front, back, subject, tags[], sourceNoteId, sourceExcerpt,
//     // v2.24.0 — Tipos cognitivos (Wozniak §6.1)
//     cardType: "basic" | "cloze" | "enumerate" | "image_occlusion",
//     // v2.24.0 — FSRS-6 state (DSR model, persistido, antes solo en localStorage)
//     fsrs: { stability, difficulty, reps, lapses, state, lastReview, due, retrievability },
//     // v2.24.0 — Elaboración profunda (paper §3.5)
//     elaborations: [{ question: "¿Por qué…?", answer: "Porque…" }],
//     // v2.24.0 — Vinculación elaborativa (paper §3.5)
//     relatedTo: [cardId, …] ,
//     // v2.24.0 — Pool de intercalado (paper §3.4)
//     interleaveGroup: string | null,
//     createdAt, updatedAt,
//   }

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export type CardType = "basic" | "cloze" | "enumerate" | "image_occlusion" | "multiple_choice";

export type CardState = "new" | "learning" | "relearning" | "review";

/** Estado FSRS-6 almacenado en el backend (antes vivía sólo en localStorage del cliente). */
export interface FsrsCardState {
  /** Stability, en días. Tiempo que tarda R en caer de 100% a 90%. */
  stability: number;
  /** Difficulty, 1-10. */
  difficulty: number;
  /** Estado de la card en el ciclo de aprendizaje. */
  state: CardState;
  /** Reps totales. */
  reps: number;
  /** Cuántas veces se olvidó (Again). */
  lapses: number;
  /** Timestamp del último review. */
  lastReview: number;
  /** Cuándo debe ser repasada. */
  due: number;
  /** Retrievability estimada en el último review (0..1). */
  retrievability: number;
}

export interface Elaboration {
  /** Pregunta de elaboración (paper §3.5: "elaborative interrogation"). */
  question: string;
  /** Respuesta del usuario, persistida para self-quiz posterior. */
  answer: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  tags: string[];
  sourceNoteId: string;
  sourceExcerpt: string;
  // v2.24.0 — añadidos
  cardType: CardType;
  /** Estado FSRS-6 persistente. Backfill para cards legacy: { stability: 0, …, state: "new" }. */
  fsrs: FsrsCardState;
  /** Auto-explicaciones / elaborative interrogation prompts (§3.5). */
  elaborations: Elaboration[];
  /** IDs de cards relacionadas (chunking semántico + triple encoding, §4.6). */
  relatedTo: string[];
  /** Grupo de intercalado (discriminación, §3.4). Cards con mismo grupo se sirven mezcladas. */
  interleaveGroup: string | null;
  // v2.27.0 — multiple choice payload (only used when cardType === "multiple_choice")
  options?: string[];
  correctIndex?: number;
  // legacy
  createdAt: number;
  updatedAt: number;
}

/** Default FSRS state para cards nuevas y backfill para legacy. */
export function defaultFsrsState(): FsrsCardState {
  return {
    stability: 0,
    difficulty: 5,
    state: "new",
    reps: 0,
    lapses: 0,
    lastReview: 0,
    due: Date.now(),
    retrievability: 1,
  };
}

/** Backfill para cards legacy que vienen de JSON sin los nuevos campos. */
export function backfillFlashcard(c: any): Flashcard {
  return {
    id: c.id ?? `fc-${randomUUID()}`,
    front: c.front ?? "",
    back: c.back ?? "",
    subject: c.subject ?? "",
    tags: c.tags ?? [],
    sourceNoteId: c.sourceNoteId ?? "",
    sourceExcerpt: c.sourceExcerpt ?? "",
    cardType: c.cardType ?? inferCardType(c.front, c.back),
    fsrs: c.fsrs ?? defaultFsrsState(),
    elaborations: c.elaborations ?? [],
    relatedTo: c.relatedTo ?? [],
    interleaveGroup: c.interleaveGroup ?? null,
    createdAt: c.createdAt ?? Date.now(),
    updatedAt: c.updatedAt ?? Date.now(),
  };
}

/** Inferencia segura del cardType cuando el backfill no tiene uno. */
function inferCardType(front: string, back: string): CardType {
  // Heurística conservadora. Si lleva números ya o listas largas => "enumerate",
  // si front/back son similares => "basic", si el cuerpo lleva {{c :: … }} => "cloze".
  if (/\{\{c\d+::/.test(front) || /\{\{c\d+::/.test(back)) return "cloze";
  const f = (front || "").trim();
  const b = (back || "").trim();
  if (b.split(/\n/).filter((l) => /^\s*\d+[\.\)]/.test(l)).length >= 2) return "enumerate";
  // Si front > 12 palabras o back > 50 palabras, preferimos "basic" (definición).
  return "basic";
}

const DATA_FILE = join(process.cwd(), "data", "flashcards.json");

class FlashcardsService {
  private cache: Flashcard[] | null = null;
  /** mtime usado para invalidación cache. La cache stale = reload. */
  private cacheMtime: number | null = null;

  /** Test-only: invalidar la cache in-memory. */
  __resetCache() { this.cache = null; this.cacheMtime = null; }

  async all(): Promise<Flashcard[]> {
    // v2.24.0: detectamos que el mtime del archivo avanzó y reléemos.
    // Es la manera limpia de evitar cache stale en tests sin afectar performance.
    try {
      const stat = await fs.stat(DATA_FILE);
      const mtime = stat.mtimeMs;
      if (this.cache && this.cacheMtime === mtime) return this.cache;
      this.cacheMtime = mtime;
    } catch {
      // file missing — fall through to read+create
    }
    try {
      const buf = await fs.readFile(DATA_FILE, "utf-8");
      const parsed = JSON.parse(buf) as any[];
      this.cache = parsed.map(backfillFlashcard);
      // Si hicimos backfill, persistimos para no repetirlo
      await this.save();
      return this.cache;
    } catch {
      this.cache = [];
      this.cacheMtime = null;
      await this.save();
      return this.cache;
    }
  }

  async get(id: string): Promise<Flashcard | undefined> {
    return (await this.all()).find((c) => c.id === id);
  }

  async create(input: Partial<Flashcard>): Promise<Flashcard> {
    const list = await this.all();
    const c: Flashcard = backfillFlashcard({
      ...input,
      id: `fc-${randomUUID()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    list.push(c);
    await this.save();
    return c;
  }

  async update(id: string, patch: Partial<Flashcard>): Promise<Flashcard | null> {
    const list = await this.all();
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id: list[i].id, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((c) => c.id !== id);
    if (next.length === list.length) return false;
    this.cache = next;
    await this.save();
    return true;
  }

  /** Reordenar relatedTo (sin cambiar updatedAt en masa). */
  async linkRelated(id: string, relatedIds: string[]): Promise<Flashcard | null> {
    const list = await this.all();
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], relatedTo: relatedIds, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
    // Invalidar mtime cache for next read
    try {
      const stat = await fs.stat(DATA_FILE);
      this.cacheMtime = stat.mtimeMs;
    } catch {}
  }
}

const svc = new FlashcardsService();

/**
 * extractFlashcards — dada una nota, extrae todas las `{{c1::front::back}}`
 * y devuelve las flashcards nuevas (no duplica si ya existe el front).
 *
 * v2.24.0: usa el cognitiveValidator para mega-tarjetas / atomicidad.
 * Las cards rechazadas se loguean como "rejected" pero no bloquean el resto.
 */
export async function extractFlashcards(
  note: { id: string; body: string; subject: string; tags: string[] },
): Promise<{ created: Flashcard[]; skipped: number; rejected: number }> {
  const re = /\{\{c1::([^}]+?)\}\}/g;
  const matches = [...(note.body || "").matchAll(re)];
  const list = await svc.all();
  const existingFronts = new Set(list.filter((c) => c.sourceNoteId === note.id).map((c) => c.front));
  const { validateCard, atomicRefactor, splitMegaCard } = await import(
    "../services/cognitiveValidator.js"
  );

  const created: Flashcard[] = [];
  let skipped = 0;
  let rejected = 0;
  for (const m of matches) {
    const inner = m[1];
    const [front, back] = inner.split("::").map((s) => s.trim());
    if (!front || !back) { skipped++; continue; }
    if (existingFronts.has(front)) { skipped++; continue; }
    const v = validateCard(front, back, "cloze");
    if (!v.ok) {
      const { looksLikeMegaCard } = await import("../services/cognitiveValidator.js");
      // Mega-tarjeta detectada → split y persistir las sub-cards
      if (looksLikeMegaCard(front, back)) {
        const refactor = atomicRefactor([{ front, back, cardType: "cloze" }]);
        for (const s of refactor.accepted) {
          const card = await svc.create({
            front: s.front,
            back: s.back,
            subject: note.subject || "",
            tags: note.tags || [],
            sourceNoteId: note.id,
            sourceExcerpt: s.front.slice(0, 80),
            cardType: "cloze",
          });
          created.push(card);
        }
        for (const sp of refactor.split) {
          for (const s of sp.split) {
            const card = await svc.create({
              front: s.front,
              back: s.back,
              subject: note.subject || "",
              tags: note.tags || [],
              sourceNoteId: note.id,
              sourceExcerpt: s.front.slice(0, 80),
              cardType: "cloze",
            });
            created.push(card);
          }
        }
        continue;
      }
      // Otro hard error → skip + log
      const { logOp } = await import("../utils/log.js");
      logOp("flashcards", "rejected", false, { front, reason: v.hardError });
      rejected++;
      continue;
    }
    const card = await svc.create({
      front, back,
      subject: note.subject || "",
      tags: note.tags || [],
      sourceNoteId: note.id,
      sourceExcerpt: inner.slice(0, 80),
      cardType: "cloze",
    });
    created.push(card);
  }
  return { created, skipped, rejected };
}

export async function flashcardsRoutes(app: FastifyInstance): Promise<void> {
  // Listar todas
  app.get("/flashcards", async () => {
    const list = await svc.all();
    return { cards: list, total: list.length };
  });

  // v2.24.0 — POST /api/v1/flashcards/atomic-extract
  //
  // Extiende la lógica v1.5.1 con:
  //   - Validación cognitiva (Wozniak §6.1-6.3, paper §6).
  //   - Detección y split automático de mega-tarjetas.
  //   - Creación con backfill de los nuevos campos cardType/fsrs/elaborations/relatedTo/interleaveGroup.
  //
  // Body { noteContent, sourceNoteId?, interleaveGroup?, autoCreate? }
  //  - autoCreate=true  → persiste las cards atómicas en flashcards.json
  //  - autoCreate=false → sólo devuelve preview para aprobación humana
  app.post<{
    Body: {
      noteContent?: string;
      sourceNoteId?: string;
      subject?: string;
      tags?: string[];
      interleaveGroup?: string;
      autoCreate?: boolean;
    };
  }>("/flashcards/atomic-extract", async (req) => {
    const body = (req.body ?? {}) as any;
    const noteContent = body.noteContent;
    if (!noteContent || typeof noteContent !== "string") {
      throw E.val(
        "EC-FC-005",
        "noteContent requerido",
        { context: { hasContent: !!noteContent }, statusCode: 400 },
      );
    }
    const { atomicRefactor } = await import("../services/cognitiveValidator.js");
    const { addCandidate } = await import("../services/generationApprovals.js");
    const log = await import("../utils/log.js");

    // Extraer candidatas crudas: cloze eliminations del body (sintaxis Anki)
    const clozeRe = /\{\{c(\d+)::([^}:]+?)(?:::([^}]*))?\}\}/g;
    const matches = [...noteContent.matchAll(clozeRe)];
    const raw: Array<{ front: string; back: string }> = [];
    if (matches.length) {
      // Cada cloze = 1 card (atomic). El "front" muestra el texto con el cloze
      // replaced por _____, y el "back" lo revela.
      for (const m of matches) {
        const hidden = (m[2] || "").trim();
        const textWithCloze = noteContent.replace(/\{\{c\d+::[^}:]+?(?:::[^}]*)?\}\}/g, "[…]");
        raw.push({ front: textWithCloze, back: hidden });
      }
    } else {
      // Sin cloze: detectamos si la pregunta pide una LISTA (paper §6.3 mega-tarjetas).
      // Si la pregunta empieza con "Causas/Síntomas/Tipos…" y el back es una lista,
      // generamos UNA sola (front, back) candidatas — el atomicRefactor se
      // encarga de dividir y validar. Si no, fragmentamos en frases como antes.
      const listQuestionMatch = noteContent.match(
        /\b(Causas|Síntomas|Síntoma|Signos|Diagnósticos|Diferenciales|Factores|Criterios|Mecanismos|Tipos|Fases|Fármacos|Síntomas de|Manifestaciones)\b/i,
      );
      if (listQuestionMatch) {
        // Dividir frontal y back por el primer "?" o ":" o salto de línea doble,
        // y tomar todo lo posterior como lista candidata.
        const m = noteContent.match(/^(.+?[\?:])\s*([\s\S]+)$/);
        if (m) {
          const front = m[1].trim();
          const back = m[2].trim();
          if (front && back && back.length > 5) {
            raw.push({ front, back });
          }
        }
      }
      // Si no detectó list-question o no se pudo parsear, fragmentamos en frases
      if (raw.length === 0) {
        const sentences = noteContent
          .split(/[.!?]+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 5);
        for (const s of sentences.slice(0, 8)) {
          const words = s.split(/\s+/);
          const front = words.slice(0, Math.min(8, words.length)).join(" ") + (words.length > 8 ? "…" : "");
          raw.push({ front, back: s });
        }
      }
    }

    // Aplicar atomic refactor
    const refactor = atomicRefactor(raw);
    let persisted = 0;
    let queuedForApproval = 0;
    let rejected = 0;
    let splitCount = 0;

    // accepted → persistir
    for (const a of refactor.accepted) {
      if (body.autoCreate !== false) {
        const c = await svc.create({
          front: a.front,
          back: a.back,
          subject: body.subject || "",
          tags: body.tags || [],
          sourceNoteId: body.sourceNoteId || "",
          sourceExcerpt: a.front.slice(0, 80),
          cardType: a.cardType,
          interleaveGroup: body.interleaveGroup || null,
        });
        persisted++;
        log.logOp?.("flashcards", "atomic-extract-create", true, {
          id: c.id,
          warnings: a.warnings.length,
        });
      } else {
        // Approval queue
        await addCandidate({
          topicId: body.subject || "general",
          sourceNoteId: body.sourceNoteId || "",
          kind: a.cardType as any,
          payload: { front: a.front, back: a.back, subject: body.subject || "" },
          preview: a.front,
          answer: a.back,
          confidence: 0.95,
        });
        queuedForApproval++;
      }
    }
    // split → persistir las sub-cards como nuevas atómicas
    for (const sp of refactor.split) {
      splitCount++;
      for (const sub of sp.split) {
        if (body.autoCreate !== false) {
          await svc.create({
            front: sub.front,
            back: sub.back,
            subject: body.subject || "",
            tags: body.tags || [],
            sourceNoteId: body.sourceNoteId || "",
            sourceExcerpt: sub.front.slice(0, 80),
            cardType: sub.cardType,
            interleaveGroup: body.interleaveGroup || null,
          });
          persisted++;
        } else {
          await addCandidate({
            topicId: body.subject || "general",
            sourceNoteId: body.sourceNoteId || "",
            kind: sub.cardType as any,
            payload: { front: sub.front, back: sub.back, subject: body.subject || "" },
            preview: sub.front,
            answer: sub.back,
            confidence: 0.85,
          });
          queuedForApproval++;
        }
      }
    }
    for (const r of refactor.rejected) {
      rejected++;
    }
    log.logOp?.("flashcards", "atomic-extract", true, {
      persisted,
      queuedForApproval,
      splitCount,
      rejected,
      rawCount: raw.length,
    });

    return {
      ok: true,
      accepted: refactor.accepted.length,
      split: splitCount,
      rejected,
      queuedForApproval,
      persisted,
      cards: refactor.accepted.map((a) => ({
        front: a.front,
        back: a.back,
        cardType: a.cardType,
        warnings: a.warnings,
      })),
    };
  });

  // Endpoint legacy, conservado para compatibilidad v1.5.x (clients UI viejos).
  app.post<{ Body: { noteContent?: string; noteTitle?: string; style?: string; level?: string; maxCards?: number } }>("/flashcards/generate", async (req, reply) => {
    const body = req.body || ({} as any);
    const noteContent = body.noteContent;
    if (!noteContent || typeof noteContent !== "string") {
      return reply.status(400).send({ error: "noteContent requerido" });
    }
    const max = body.maxCards || 5;
    // Mock — split into sentences and turn into cloze-style Q/A
    const sentences = noteContent
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5);
    const cards = sentences.slice(0, max).map((s, i) => {
      // Take first 6 words as front, full sentence as back
      const words = s.split(/\s+/);
      const front = words.slice(0, Math.min(8, words.length)).join(" ") + (words.length > 8 ? "..." : "");
      return {
        front,
        back: s,
        cardType: body.style || "cloze",
        model: "mock-llm",
      };
    });
    return { cards, model: "mock-llm" };
  });

  // Filtrar por asignatura / sourceNoteId
  app.get<{ Querystring: { subject?: string; noteId?: string } }>("/flashcards/filter", async (req) => {
    const list = await svc.all();
    const { subject, noteId } = req.query;
    let filtered = list;
    if (subject) filtered = filtered.filter((c) => c.subject === subject);
    if (noteId) filtered = filtered.filter((c) => c.sourceNoteId === noteId);
    return { cards: filtered, total: filtered.length };
  });

  app.get<{ Params: { id: string } }>("/flashcards/:id", async (req) => {
    const c = await svc.get(req.params.id);
    if (!c) throw E.val("EC-FC-001", "Flashcard no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return c;
  });

  app.post<{ Body: Partial<Flashcard> }>("/flashcards", async (req, reply) => {
    const c = await svc.create(req.body ?? {});
    reply.code(201);
    logOp("flashcards", "created", true, { id: c.id, subject: c.subject });
    return c;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Flashcard> }>("/flashcards/:id", async (req) => {
    const c = await svc.update(req.params.id, req.body ?? {});
    if (!c) throw E.val("EC-FC-002", "Flashcard no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return c;
  });

  app.delete<{ Params: { id: string } }>("/flashcards/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-FC-003", "Flashcard no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });

  // v1.5.1: extraer desde body de nota
  app.post<{ Params: { id: string } }>("/notes/:id/extract-flashcards", async (req) => {
    const { getNote } = await import("./notes.js").catch(() => ({} as any));
    // Import lazy: usar servicio directo
    const notesPath = join(process.cwd(), "data", "notes.json");
    let note: any = null;
    try {
      const list = JSON.parse(await fs.readFile(notesPath, "utf-8"));
      note = list.find((n: any) => n.id === req.params.id);
    } catch {}
    if (!note) throw E.val("EC-FC-004", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    const out = await extractFlashcards(note);
    logOp("flashcards", "extract", true, { noteId: note.id, created: out.created.length, skipped: out.skipped });
    return out;
  });

  // v2.9.0: extraer clozes Y ENQUEUAR para aprobación humana.
  // No crea flashcards directamente; el usuario debe aprobar en /approvals.
  app.post<{ Params: { id: string } }>("/notes/:id/extract-as-candidates", async (req) => {
    const { addCandidate } = await import("../services/generationApprovals.js");
    const notesPath = join(process.cwd(), "data", "notes.json");
    let note: any = null;
    try {
      const list = JSON.parse(await fs.readFile(notesPath, "utf-8"));
      note = list.find((n: any) => n.id === req.params.id);
    } catch {}
    if (!note) throw E.val("EC-FC-004", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });

    const re = /\{\{c1::([^}]+?)\}\}/g;
    const matches = [...(note.body || "").matchAll(re)];
    let queued = 0;
    for (const m of matches) {
      const inner = m[1];
      const [front, back] = inner.split("::").map((s: string) => s.trim());
      if (!front || !back) continue;
      await addCandidate({
        topicId: note.subject || "general",
        sourceNoteId: note.id,
        kind: "cloze",
        payload: { front, back, subject: note.subject || "" },
        preview: front,
        answer: back,
        confidence: 0.95, // high because extracted deterministically
      });
      queued++;
    }
    return { queued, skipped: matches.length - queued };
  });
}

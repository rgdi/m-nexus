// flashcards.ts: REST CRUD para flashcards.
// v1.5.1 — extracción desde `{{c1::front::back}}` en body de notas.
// v1.5.2 — asignación automática a asignatura/carpeta (note.subject + note.tags).
//
// Modelo:
//   Flashcard { id, front, back, subject, tags[], sourceNoteId, sourceExcerpt, createdAt, updatedAt }

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  tags: string[];
  sourceNoteId: string;
  sourceExcerpt: string;
  createdAt: number;
  updatedAt: number;
}

const DATA_FILE = join(process.cwd(), "data", "flashcards.json");

class FlashcardsService {
  private cache: Flashcard[] | null = null;

  async all(): Promise<Flashcard[]> {
    if (this.cache) return this.cache;
    try {
      const buf = await fs.readFile(DATA_FILE, "utf-8");
      this.cache = JSON.parse(buf);
      return this.cache!;
    } catch {
      this.cache = [];
      await this.save();
      return this.cache;
    }
  }

  async get(id: string): Promise<Flashcard | undefined> {
    return (await this.all()).find((c) => c.id === id);
  }

  async create(input: Partial<Flashcard>): Promise<Flashcard> {
    const list = await this.all();
    const c: Flashcard = {
      id: `fc-${randomUUID()}`,
      front: input.front ?? "",
      back: input.back ?? "",
      subject: input.subject ?? "",
      tags: input.tags ?? [],
      sourceNoteId: input.sourceNoteId ?? "",
      sourceExcerpt: input.sourceExcerpt ?? "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
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

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}

const svc = new FlashcardsService();

/**
 * extractFlashcards — dada una nota, extrae todas las `{{c1::front::back}}`
 * y devuelve las flashcards nuevas (no duplica si ya existe el front).
 */
export async function extractFlashcards(
  note: { id: string; body: string; subject: string; tags: string[] },
): Promise<{ created: Flashcard[]; skipped: number }> {
  const re = /\{\{c1::([^}]+?)\}\}/g;
  const matches = [...(note.body || "").matchAll(re)];
  const list = await svc.all();
  const existingFronts = new Set(list.filter((c) => c.sourceNoteId === note.id).map((c) => c.front));
  const created: Flashcard[] = [];
  let skipped = 0;
  for (const m of matches) {
    const inner = m[1];
    const [front, back] = inner.split("::").map((s) => s.trim());
    if (!front || !back) { skipped++; continue; }
    if (existingFronts.has(front)) { skipped++; continue; }
    const card = await svc.create({
      front, back,
      subject: note.subject || "",
      tags: note.tags || [],
      sourceNoteId: note.id,
      sourceExcerpt: inner.slice(0, 80),
    });
    created.push(card);
  }
  return { created, skipped };
}

export async function flashcardsRoutes(app: FastifyInstance): Promise<void> {
  // Listar todas
  app.get("/flashcards", async () => {
    const list = await svc.all();
    return { cards: list, total: list.length };
  });

  // Generar borradores desde texto (mock — devuelve cloze candidates)
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
}

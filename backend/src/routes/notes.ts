// notes.ts: REST CRUD para notas (notebooks) con páginas + strokes.
// v1.1.0 — frontend Education Service (stylus-first)
//
// Modelo:
//   Note { id, title, body, subject, tags[], pages[], createdAt, updatedAt }
//   Page { strokes[], placeholders[] }
//   Stroke { tool, color, size, alpha, points[{x,y,p,tilt}] }
//   Placeholder { type, x, y, w, h, label }

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface StrokePoint { x: number; y: number; p: number; tilt: number }
export interface Stroke { tool: string; color: string; size: number; alpha: number; points: StrokePoint[] }
export interface Placeholder { type: string; x: number; y: number; w: number; h: number; label: string }
export interface Page { strokes: Stroke[]; placeholders: Placeholder[] }
export interface Note {
  id: string;
  title: string;
  body: string;
  subject: string;
  tags: string[];
  pages: Page[];
  createdAt: number;
  updatedAt: number;
}

const DATA_FILE = join(process.cwd(), "data", "notes.json");

class NotesService {
  private cache: Note[] | null = null;

  async all(): Promise<Note[]> {
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

  async get(id: string): Promise<Note | undefined> {
    return (await this.all()).find((n) => n.id === id);
  }

  async create(input: Partial<Note>): Promise<Note> {
    const list = await this.all();
    const n: Note = {
      id: `note-${randomUUID()}`,
      title: input.title ?? "Untitled",
      body: input.body ?? "",
      subject: input.subject ?? "",
      tags: input.tags ?? [],
      pages: input.pages ?? [{ strokes: [], placeholders: [] }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.push(n);
    await this.save();
    return n;
  }

  async update(id: string, patch: Partial<Note>): Promise<Note | null> {
    const list = await this.all();
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id: list[i].id, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((n) => n.id !== id);
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

const svc = new NotesService();

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  await ensureSeeded(svc);

  app.get("/notes", async () => {
    const list = await svc.all();
    return { notes: list, total: list.length };
  });

  app.get<{ Params: { id: string } }>("/notes/:id", async (req) => {
    const n = await svc.get(req.params.id);
    if (!n) throw E.val("EC-NOTE-001", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return n;
  });

  app.post<{ Body: Partial<Note> }>("/notes", async (req, reply) => {
    const n = await svc.create(req.body ?? {});
    reply.code(201);
    logOp("notes", "created", true, { id: n.id, title: n.title });
    return n;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Note> }>("/notes/:id", async (req) => {
    const n = await svc.update(req.params.id, req.body ?? {});
    if (!n) throw E.val("EC-NOTE-002", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return n;
  });

  app.delete<{ Params: { id: string } }>("/notes/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-NOTE-003", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });

  /// v1.1.0: append stroke a una página específica (sin reenviar toda la nota)
  app.post<{ Params: { id: string; page: string }; Body: { stroke: Stroke } }>(
    "/notes/:id/pages/:page/strokes",
    async (req) => {
      const n = await svc.get(req.params.id);
      if (!n) throw E.val("EC-NOTE-004", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
      const pageIdx = parseInt(req.params.page, 10);
      if (!n.pages[pageIdx]) {
        n.pages[pageIdx] = { strokes: [], placeholders: [] };
      }
      n.pages[pageIdx].strokes.push(req.body.stroke);
      await svc.update(n.id, { pages: n.pages });
      return { ok: true, strokeCount: n.pages[pageIdx].strokes.length };
    },
  );
}

async function ensureSeeded(svc: NotesService) {
  const list = await svc.all();
  if (list.length > 0) return;
  const seed: Array<Partial<Note>> = [
    { title: "Welcome to M-NEXUS", subject: "math", tags: ["welcome"], body: "# Welcome\n\nEste es tu notebook. **Pulsa el lápiz para escribir**, el icono de imagen para insertar fotos, el código para snippets, etc.\n\nUsa ==subrayado==, !!resaltado!!, [[Getting started]] o {{c1::Capital de Francia::París}} para crear flashcards.", pages: [{ strokes: [], placeholders: [] }] },
    { title: "Getting started", subject: "deu", tags: ["onboarding"], body: "# Erste Schritte\n\n- Schreib mit dem Stift\n- Speichere oft (auto-save alle 5s)\n- Nutze die AI-Taste für Übersetzung\n\nBeispiel: !!Hervorhebung!! oder ==unterstreichen==", pages: [{ strokes: [], placeholders: [] }] },
    { title: "Flashcards demo", subject: "bio", tags: ["biology", "review"], body: "# Cell biology\n\nMitochondria: the powerhouse of the cell.\n\n- {{c1::Main energy molecule::ATP}}\n- {{c1::Photosynthesis location::Chloroplast}}\n- {{c1::Number of chromosomes in humans::46}}\n- {{c1::DNA stands for::Deoxyribonucleic Acid}}\n\nReferencia: @campbell/cap9 (mitochondria) y @campbell/cap10 (cloroplastos).", pages: [{ strokes: [], placeholders: [] }] },
  ];
  for (const s of seed) await svc.create(s);
}

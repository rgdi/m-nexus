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
// v2.3.0-B: folders for hierarchical note organization.
export interface NoteFolder {
  id: string;
  name: string;
  parentId: string | null; // null = root
  color: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
}
export interface Note {
  id: string;
  title: string;
  body: string;
  subject: string;
  tags: string[];
  pages: Page[];
  folderId: string | null; // v2.3.0-B: optional folder
  createdAt: number;
  updatedAt: number;
  // v2.25.0: outliner blocks (atomic unit). Optional for backward compat.
  // Lazily derived from `body` on first read if missing.
  blocks?: import("../services/blocks.js").Block[];
  // v2.25.0: daily journal flag (auto-created note per day)
  isJournal?: boolean;
  journalDate?: string; // YYYY-MM-DD
}

const DATA_FILE = join(process.cwd(), "data", "notes.json");

export class NotesService {
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
      folderId: input.folderId ?? null,
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

/* ============================================================
 * v2.3.0-B: Folders CRUD
 * ============================================================ */
const FOLDERS_FILE = join(process.cwd(), "data", "folders.json");

class FoldersService {
  private cache: NoteFolder[] | null = null;

  async all(): Promise<NoteFolder[]> {
    if (this.cache) return this.cache;
    try {
      const buf = await fs.readFile(FOLDERS_FILE, "utf-8");
      this.cache = JSON.parse(buf);
      return this.cache!;
    } catch {
      this.cache = [];
      await this.save();
      return this.cache;
    }
  }

  async get(id: string): Promise<NoteFolder | undefined> {
    return (await this.all()).find((f) => f.id === id);
  }

  async create(input: Partial<NoteFolder>): Promise<NoteFolder> {
    const list = await this.all();
    const f: NoteFolder = {
      id: `folder-${randomUUID()}`,
      name: input.name ?? "New folder",
      parentId: input.parentId ?? null,
      color: input.color ?? "var(--subj-blue)",
      icon: input.icon ?? "folder",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.push(f);
    await this.save();
    return f;
  }

  async update(id: string, patch: Partial<NoteFolder>): Promise<NoteFolder | null> {
    const list = await this.all();
    const i = list.findIndex((f) => f.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id: list[i].id, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((f) => f.id !== id);
    if (next.length === list.length) return false;
    // Move child folders + notes to root (parentId = null, folderId = null).
    const remaining = this.cache!;
    for (const f of remaining) if (f.parentId === id) f.parentId = null;
    this.cache = next;
    await this.save();
    return true;
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(FOLDERS_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}

const foldersSvc = new FoldersService();

const svc = new NotesService();
export const notesServiceInstance = svc;

export async function notesRoutes(app: FastifyInstance): Promise<void> {
  // v2.6.0: demo data is opt-in via /admin/demo/load.

  // Folders CRUD
  app.get("/folders", async () => ({ folders: await foldersSvc.all() }));
  app.post<{ Body: Partial<NoteFolder> }>("/folders", async (req) => foldersSvc.create(req.body));
  app.patch<{ Params: { id: string }; Body: Partial<NoteFolder> }>("/folders/:id", async (req, reply) => {
    const f = await foldersSvc.update(req.params.id, req.body);
    if (!f) return reply.code(404).send({ error: "Folder not found" });
    return f;
  });
  app.delete<{ Params: { id: string } }>("/folders/:id", async (req, reply) => {
    const ok = await foldersSvc.remove(req.params.id);
    if (!ok) return reply.code(404).send({ error: "Folder not found" });
    return { ok: true };
  });

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

  // ============================================================
  // v2.25.0 — Outliner block-level endpoints
  // ============================================================
  const { NoteBlocks, bodyToBlocks, blocksToBody, indexNote, backlinksFor, matchesBlockQuery, extractBlockRefs } =
    await import("../services/blocks.js");

  // List blocks of a note (auto-migrates body → blocks on first read)
  app.get<{ Params: { id: string } }>("/notes/:id/blocks", async (req, reply) => {
    const n = await svc.get(req.params.id);
    if (!n) throw E.val("EC-NOTE-005", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    const blocks = NoteBlocks.ensure(n);
    // Persist the lazy migration so subsequent reads are fast.
    if (n.blocks === undefined || (n.blocks.length === 0 && (n.body || "").length > 0)) {
      await svc.update(n.id, { blocks });
      await indexNote(n);
    }
    return { blocks, total: blocks.length };
  });

  // Append a new block to a note
  app.post<{ Params: { id: string }; Body: { parentId?: string | null; text: string; type?: string; meta?: any } }>(
    "/notes/:id/blocks",
    async (req, reply) => {
      const n = await svc.get(req.params.id);
      if (!n) throw E.val("EC-NOTE-006", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
      const { parentId = null, text, type, meta } = req.body ?? ({} as any);
      if (!text || typeof text !== "string") {
        return reply.code(400).send({ error: "text required" });
      }
      const saneType = typeof type === "string" && ["text", "cloze", "callout", "code", "toggle", "quote"].includes(type) ? type : "text";
      const block = NoteBlocks.append(n, {
        parentId,
        text,
        type: saneType as any,
        meta,
      });
      await svc.update(n.id, { blocks: n.blocks, body: blocksToBody(n.blocks!) });
      await indexNote(n);
      reply.code(201);
      return block;
    },
  );

  // Patch a block
  app.patch<{ Params: { id: string; blockId: string }; Body: { text?: string; type?: string; meta?: any } }>(
    "/notes/:id/blocks/:blockId",
    async (req, reply) => {
      const n = await svc.get(req.params.id);
      if (!n) throw E.val("EC-NOTE-007", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
      const patch: any = { ...req.body };
      if (typeof patch.type !== "string" || !["text", "cloze", "callout", "code", "toggle", "quote"].includes(patch.type)) {
        delete patch.type;
      }
      const patched = NoteBlocks.patch(n, req.params.blockId, patch);
      if (!patched) return reply.code(404).send({ error: "Block not found" });
      await svc.update(n.id, { blocks: n.blocks, body: blocksToBody(n.blocks!) });
      await indexNote(n);
      return patched;
    },
  );

  // Move a block (re-parent + re-order)
  app.patch<{ Params: { id: string; blockId: string }; Body: { newParentId: string | null; newOrder?: number } }>(
    "/notes/:id/blocks/:blockId/move",
    async (req, reply) => {
      const n = await svc.get(req.params.id);
      if (!n) throw E.val("EC-NOTE-008", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
      const ok = NoteBlocks.move(n, req.params.blockId, req.body?.newParentId ?? null, req.body?.newOrder);
      if (!ok) return reply.code(400).send({ error: "Move failed (cycle or not found)" });
      await svc.update(n.id, { blocks: n.blocks, body: blocksToBody(n.blocks!) });
      await indexNote(n);
      return { ok: true };
    },
  );

  // Delete a block (and descendants)
  app.delete<{ Params: { id: string; blockId: string } }>(
    "/notes/:id/blocks/:blockId",
    async (req, reply) => {
      const n = await svc.get(req.params.id);
      if (!n) throw E.val("EC-NOTE-009", "Note no encontrada", { context: { id: req.params.id }, statusCode: 404 });
      const ok = NoteBlocks.remove(n, req.params.blockId);
      if (!ok) return reply.code(404).send({ error: "Block not found" });
      await svc.update(n.id, { blocks: n.blocks, body: blocksToBody(n.blocks!) });
      await indexNote(n);
      return { ok: true };
    },
  );

  // Backlinks for a block (across all notes)
  app.get<{ Params: { blockId: string } }>("/blocks/:blockId/backlinks", async (req) => {
    const list = await backlinksFor(req.params.blockId);
    return { backlinks: list, total: list.length };
  });

  // Extract block-references from arbitrary text (for `[[ ]]` auto-complete in editor)
  app.post<{ Body: { text: string } }>("/blocks/extract-refs", async (req) => {
    const text = req.body?.text ?? "";
    return { refs: extractBlockRefs(text) };
  });

  // Block query (subset of Logseq Datalog; v2.25 starts simple)
  app.post<{ Body: any }>("/notes/query", async (req) => {
    const q = req.body ?? {};
    const list = await svc.all();
    const filtered = list.filter((n) => matchesBlockQuery(n, q));
    return { notes: filtered, total: filtered.length };
  });
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

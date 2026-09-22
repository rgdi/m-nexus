/* ============================================================
 * services/pdfAnnotationStorage.ts — persistence layer for PDF highlights.
 *
 * v2.28.0 — extends the in-memory service with JSON persistence and a
 * `cardId` field on each highlight so we can know if a card was
 * already created from this highlight (idempotent guard).
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_FILE = join(process.cwd(), "data", "pdf-highlights.json");

export interface PdfHighlight {
  id: string;
  documentPath: string;
  page: number;
  format: "text" | "rect";
  /** Original text the user highlighted. */
  text: string;
  /** Optional chunk before the highlight, used as cloze front context. */
  contextBefore?: string;
  /** Optional chunk after, used as cloze back context. */
  contextAfter?: string;
  color: string;
  /** Subject the highlight belongs to (e.g. "anat"). Cards inherit this. */
  subject?: string;
  /** Link to created flashcard (idempotency). */
  cardId?: string;
  noteId?: string;
  /** v2.28: per-highlight state — "raw" → "card-created" → "card-rejected". */
  state?: "raw" | "card-created" | "card-rejected";
  createdAt: number;
  updatedAt: number;
}

let cache: Record<string, PdfHighlight[]> | null = null;
let mtime: number | null = null;

async function load(): Promise<Record<string, PdfHighlight[]>> {
  try {
    const stat = await fs.stat(DATA_FILE);
    if (cache && mtime === stat.mtimeMs) return cache;
    const buf = await fs.readFile(DATA_FILE, "utf-8");
    cache = JSON.parse(buf);
    mtime = stat.mtimeMs;
    return cache!;
  } catch {
    cache = {};
    mtime = null;
    return cache;
  }
}

async function save(): Promise<void> {
  if (!cache) return;
  await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(cache, null, 2));
  try {
    const stat = await fs.stat(DATA_FILE);
    mtime = stat.mtimeMs;
  } catch {}
}

export const pdfAnnotationStorage = {
  async list(documentPath: string): Promise<PdfHighlight[]> {
    const all = await load();
    return all[documentPath] ?? [];
  },

  async listAll(): Promise<Record<string, PdfHighlight[]>> {
    return await load();
  },

  async add(h: Omit<PdfHighlight, "createdAt" | "updatedAt">): Promise<PdfHighlight> {
    const all = await load();
    if (!all[h.documentPath]) all[h.documentPath] = [];
    const created: PdfHighlight = { ...h, createdAt: Date.now(), updatedAt: Date.now() };
    all[h.documentPath].push(created);
    await save();
    return created;
  },

  async update(id: string, documentPath: string, patch: Partial<PdfHighlight>): Promise<PdfHighlight | null> {
    const all = await load();
    const list = all[documentPath] ?? [];
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id: list[i].id, updatedAt: Date.now() };
    await save();
    return list[i];
  },

  async remove(id: string, documentPath: string): Promise<boolean> {
    const all = await load();
    const list = all[documentPath] ?? [];
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return false;
    all[documentPath] = next;
    await save();
    return true;
  },

  async findById(id: string): Promise<PdfHighlight | null> {
    const all = await load();
    for (const list of Object.values(all)) {
      const h = list.find((x) => x.id === id);
      if (h) return h;
    }
    return null;
  },

  /** Reset for tests. */
  async _reset(): Promise<void> {
    cache = {};
    mtime = null;
  },
};

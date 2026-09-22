/* ============================================================
 * services/pdfOcclusionStorage.ts — Persistencia de oclusiones PDF.
 *
 * v2.29.0 — Image Occlusion v2 sobre páginas PDF reales.
 *
 * Modelo: una PdfOcclusion = una caja rectangular sobre una página de un PDF,
 * almacenada con coordenadas normalizadas (0..1) para sobrevivir a zoom/cambios
 * de tamaño. Cada oclusión pertenece a un PDF y a un subject opcional.
 *
 * Estado (state machine):
 *   raw          — recién creada, sin card asociada
 *   card-created — convertida en flashcard atómica
 *   card-rejected — rechazada por validación cognitiva
 *
 * Relación:
 *   - oclussion.cardId → flashcardId (idempotencia)
 *   - oclussion.highlightId → highlight origen (trazabilidad)
 *
 * Persistencia: backend/data/pdf-occlusions.json
 * Estructura: { [documentPath]: PdfOcclusion[] }
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const FILE = join(DATA_DIR, "pdf-occlusions.json");

export type OcclusionState = "raw" | "card-created" | "card-rejected";

export interface PdfOcclusion {
  id: string;
  documentPath: string;
  page: number;
  /** Coordenadas normalizadas (0..1) respecto al tamaño de la página. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Etiqueta opcional: muestra este texto debajo de la máscara al revelar. */
  label?: string;
  /** Materia / subject (para FSRS + filtros). */
  subject?: string;
  /** Color hex de la máscara. */
  color?: string;
  /** Estado de la oclusión en el pipeline. */
  state: OcclusionState;
  /** Id de la flashcard creada a partir de esta oclusión (si state=card-created). */
  cardId?: string;
  /** Id del highlight origen (si se creó a partir de uno). */
  highlightId?: string;
  createdAt: number;
  updatedAt: number;
}

type Store = Record<string, PdfOcclusion[]>;

let cache: Store | null = null;
let cacheMtime = 0;

async function loadFresh(): Promise<Store> {
  try {
    const stat = await fs.stat(FILE);
    if (cache && stat.mtimeMs === cacheMtime) return cache;
  } catch {
    // file may not exist yet
  }
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as Store;
    cache = parsed;
    try { cacheMtime = (await fs.stat(FILE)).mtimeMs; } catch { cacheMtime = 0; }
    return parsed;
  } catch {
    const empty: Store = {};
    cache = empty;
    cacheMtime = 0;
    return empty;
  }
}

async function persist(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf-8");
  cache = store;
  try { cacheMtime = (await fs.stat(FILE)).mtimeMs; } catch { cacheMtime = 0; }
}

function normalizeRange(o: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  // clamp 0..1 + ensure non-negative w/h
  const x = Math.max(0, Math.min(1, o.x));
  const y = Math.max(0, Math.min(1, o.y));
  const w = Math.max(0, Math.min(1 - x, o.w));
  const h = Math.max(0, Math.min(1 - y, o.h));
  return { x, y, w, h };
}

export const pdfOcclusionStorage = {
  async _reset(): Promise<void> {
    cache = null;
    cacheMtime = 0;
  },

  async list(documentPath: string): Promise<PdfOcclusion[]> {
    const s = await loadFresh();
    return s[documentPath] ?? [];
  },

  async listAll(): Promise<Store> {
    return loadFresh();
  },

  async add(input: Omit<PdfOcclusion, "createdAt" | "updatedAt" | "state"> & { state?: OcclusionState }): Promise<PdfOcclusion> {
    const s = await loadFresh();
    const now = Date.now();
    const norm = normalizeRange(input);
    const ocl: PdfOcclusion = {
      id: input.id,
      documentPath: input.documentPath,
      page: input.page,
      x: norm.x,
      y: norm.y,
      w: norm.w,
      h: norm.h,
      label: input.label,
      subject: input.subject,
      color: input.color ?? "#000000",
      state: input.state ?? "raw",
      cardId: input.cardId,
      highlightId: input.highlightId,
      createdAt: now,
      updatedAt: now,
    };
    const list = s[ocl.documentPath] ?? [];
    list.push(ocl);
    s[ocl.documentPath] = list;
    await persist(s);
    return ocl;
  },

  async update(id: string, documentPath: string, patch: Partial<Omit<PdfOcclusion, "id" | "documentPath" | "createdAt">>): Promise<PdfOcclusion | null> {
    const s = await loadFresh();
    const list = s[documentPath];
    if (!list) return null;
    const idx = list.findIndex((o) => o.id === id);
    if (idx === -1) return null;
    const prev = list[idx];
    const normPatch = patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined
      ? normalizeRange({
          x: patch.x ?? prev.x,
          y: patch.y ?? prev.y,
          w: patch.w ?? prev.w,
          h: patch.h ?? prev.h,
        })
      : null;
    const next: PdfOcclusion = {
      ...prev,
      ...patch,
      x: normPatch?.x ?? prev.x,
      y: normPatch?.y ?? prev.y,
      w: normPatch?.w ?? prev.w,
      h: normPatch?.h ?? prev.h,
      updatedAt: Date.now(),
    };
    list[idx] = next;
    s[documentPath] = list;
    await persist(s);
    return next;
  },

  async remove(id: string, documentPath: string): Promise<boolean> {
    const s = await loadFresh();
    const list = s[documentPath];
    if (!list) return false;
    const next = list.filter((o) => o.id !== id);
    if (next.length === list.length) return false;
    s[documentPath] = next;
    await persist(s);
    return true;
  },

  async findById(id: string): Promise<PdfOcclusion | null> {
    const s = await loadFresh();
    for (const list of Object.values(s)) {
      const found = list.find((o) => o.id === id);
      if (found) return found;
    }
    return null;
  },

  /** Devuelve oclusiones en estado raw para un documento. */
  async listRaw(documentPath: string): Promise<PdfOcclusion[]> {
    const list = await this.list(documentPath);
    return list.filter((o) => o.state === "raw");
  },
};

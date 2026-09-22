/* ============================================================
 * services/pdfOcclusionAtomic.ts — Oclusión PDF → flashcard atómica.
 *
 * v2.29.0 — image occlusion v2: dibuja una caja sobre una página PDF,
 * se vincula con un label (texto que aparece al revelar), y se transforma
 * en una flashcard basic usando el label como back y una pregunta derivada.
 *
 * Diferencia vs. pdfAtomicCard (highlights): las oclusiones son máscaras
 * rectangulares que ocultan una zona visual. La "pregunta" es revelar la
 * zona (front = "Identifica la zona oculta", back = label + descripción).
 *
 * Tipos de flashcard soportados:
 *   - "basic"     — front pregunta, back label
 *   - "image_occlusion" — tarjeta nativa con campo de máscara (reutiliza
 *                         la estructura de imageOcclusionService para soportar
 *                         el rendering visual del modo estudio)
 *
 * Idempotencia: dedup por signature (front::back).
 * ============================================================ */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pdfOcclusionStorage, type PdfOcclusion } from "./pdfOcclusionStorage.js";
import { validateCard, type CardValidationResult } from "./cognitiveValidator.js";
import { logOp } from "../utils/log.js";

const DATA_DIR = join(process.cwd(), "data");
const FLASHCARDS_FILE = join(DATA_DIR, "flashcards.json");

interface ExistingFlashcard {
  id: string;
  front: string;
  back: string;
  cardType?: string;
  subject?: string;
  tags?: string[];
  sourceNoteId?: string;
}

async function readFlashcards(): Promise<ExistingFlashcard[]> {
  try {
    const raw = await readFile(FLASHCARDS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as ExistingFlashcard[];
    if (Array.isArray(parsed.cards)) return parsed.cards as ExistingFlashcard[];
    if (Array.isArray(parsed.flashcards)) return parsed.flashcards as ExistingFlashcard[];
    return [];
  } catch {
    return [];
  }
}

async function writeFlashcards(cards: ExistingFlashcard[]): Promise<void> {
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FLASHCARDS_FILE, JSON.stringify(cards, null, 2), "utf-8");
}

export interface ShapeOcclusionInput {
  occlusion: PdfOcclusion;
  /** "basic" = pregunta + label; "image_occlusion" = tarjeta con máscara embebida. */
  preferType?: "basic" | "image_occlusion";
  /** Subject opcional; si no se pasa, usa el subject de la oclusión. */
  subject?: string;
}

export interface ShapeOcclusion {
  cardType: "basic" | "image_occlusion";
  front: string;
  back: string;
  warnings: string[];
  hash: string;
}

/**
 * Deriva la forma de la flashcard a partir de la oclusión y (opcional) el label.
 *
 * Si hay label → "basic": front = "¿Qué hay en la zona oculta de p.X?"; back = label.
 * Si NO hay label → "image_occlusion": la card tiene solo la metadata visual y
 * el back se descubre al revelar la máscara.
 */
export function shapeOcclusion(input: ShapeOcclusionInput): ShapeOcclusion {
  const prefer = input.preferType ?? (input.occlusion.label ? "basic" : "image_occlusion");
  const pageRef = `p.${input.occlusion.page}`;
  const warnings: string[] = [];

  let front: string;
  let back: string;
  let cardType: "basic" | "image_occlusion";

  if (prefer === "basic") {
    cardType = "basic";
    front = `¿Qué hay oculto en ${pageRef} de ${shortDocName(input.occlusion.documentPath)}?`;
    back = input.occlusion.label?.trim() || `[zona enmascarada ${Math.round(input.occlusion.x * 100)}%,${Math.round(input.occlusion.y * 100)}%]`;
    if (!input.occlusion.label || input.occlusion.label.trim().length < 1) {
      warnings.push("label_empty_fallback");
    }
  } else {
    cardType = "image_occlusion";
    front = `[oclusión ${pageRef}] ${shortDocName(input.occlusion.documentPath)}`;
    back = input.occlusion.label?.trim() || "(revelar para ver)";
  }

  // Pasa por validateCard para mantener la disciplina cognitiva.
  const validated: CardValidationResult | null = validateCard(front, back, cardType);
  if (validated) {
    warnings.push(...validated.warnings);
  } else {
    warnings.push("card_validation_failed_basic_fallback");
  }

  const hash = simpleHash(`${front}\u0000${back}`);

  return { cardType, front, back, warnings, hash };
}

function shortDocName(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.pdf$/i, "").slice(0, 40);
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

export interface OcclusionCardResult {
  ok: boolean;
  cardId?: string;
  cardType?: "basic" | "image_occlusion";
  front?: string;
  back?: string;
  warnings: string[];
  hash?: string;
  occlusionId: string;
  persisted: boolean;
  duplicatesSkipped: number;
  error?: string;
}

/**
 * Crea una flashcard atómica a partir de una oclusión PDF.
 *
 * - Lee todas las flashcards existentes y hace dedup por signature (front::back).
 * - Persiste la nueva card en /api/v1/flashcards (formato flashcards.json).
 * - Actualiza la oclusión: state="card-created" + cardId link.
 * - Idempotente: si ya existe una card con el mismo front/back y la oclusión
 *   no tiene cardId, se enlaza la existente.
 */
export async function createAtomicCardFromOcclusion(input: ShapeOcclusionInput): Promise<OcclusionCardResult> {
  const shape = shapeOcclusion(input);
  const occlusionId = input.occlusion.id;
  const allWarnings = [...shape.warnings];

  // Idempotencia: si esta oclusión ya tiene cardId, devolverla.
  if (input.occlusion.cardId) {
    return {
      ok: true,
      cardId: input.occlusion.cardId,
      cardType: shape.cardType,
      front: shape.front,
      back: shape.back,
      warnings: allWarnings,
      hash: shape.hash,
      occlusionId,
      persisted: false,
      duplicatesSkipped: 1,
    };
  }

  const subject = input.subject ?? input.occlusion.subject ?? "general";

  const existing = await readFlashcards();
  const sig = `${shape.front}\u0000${shape.back}`;
  const dupes = existing.filter((c) => `${c.front}\u0000${c.back}` === sig);
  if (dupes.length > 0) {
    await pdfOcclusionStorage.update(occlusionId, input.occlusion.documentPath, {
      cardId: dupes[0].id,
      state: "card-created",
    });
    return {
      ok: true,
      cardId: dupes[0].id,
      cardType: shape.cardType,
      front: shape.front,
      back: shape.back,
      warnings: allWarnings,
      hash: shape.hash,
      occlusionId,
      persisted: false,
      duplicatesSkipped: dupes.length,
    };
  }

  // Crear nueva card.
  const now = Date.now();
  const newCard: ExistingFlashcard = {
    id: `fc-${randomUUID()}`,
    front: shape.front,
    back: shape.back,
    cardType: shape.cardType,
    subject,
    tags: [subject, "pdf-occlusion", `pdf-${shortDocName(input.occlusion.documentPath)}`],
    sourceNoteId: `pdf:${input.occlusion.documentPath}#o=${occlusionId}`,
    ...(shape.cardType === "image_occlusion"
      ? { occlusion: { documentPath: input.occlusion.documentPath, page: input.occlusion.page, x: input.occlusion.x, y: input.occlusion.y, w: input.occlusion.w, h: input.occlusion.h } }
      : {}),
  } as ExistingFlashcard;

  existing.push(newCard);
  await writeFlashcards(existing);
  await pdfOcclusionStorage.update(occlusionId, input.occlusion.documentPath, {
    cardId: newCard.id,
    state: "card-created",
  });

  logOp("pdf-occlusion", "card_created", true, { occlusionId, cardId: newCard.id });

  return {
    ok: true,
    cardId: newCard.id,
    cardType: shape.cardType,
    front: shape.front,
    back: shape.back,
    warnings: allWarnings,
    hash: shape.hash,
    occlusionId,
    persisted: true,
    duplicatesSkipped: 0,
  };
}

export interface BatchOcclusionResult {
  total: number;
  ok: number;
  failed: number;
  persisted: number;
  items: OcclusionCardResult[];
}

/**
 * Procesa todas las oclusiones raw de un documento en batch.
 * Devuelve un resultado por oclusión.
 */
export async function batchFromOcclusions(documentPath: string): Promise<BatchOcclusionResult> {
  const raws = await pdfOcclusionStorage.listRaw(documentPath);
  const items: OcclusionCardResult[] = [];
  for (const ocl of raws) {
    const r = await createAtomicCardFromOcclusion({ occlusion: ocl });
    items.push(r);
  }
  const ok = items.filter((r) => r.ok).length;
  const failed = items.length - ok;
  const persisted = items.filter((r) => r.persisted).length;
  return { total: items.length, ok, failed, persisted, items };
}

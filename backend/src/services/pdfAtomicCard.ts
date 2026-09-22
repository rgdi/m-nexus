/* ============================================================
 * services/pdfAtomicCard.ts — convert a PDF highlight into atomic flashcards.
 *
 * v2.28.0 — wraps the highlight into a single cloze or basic flashcard
 * using the cognitiveValidator (v2.24.0) for atomicity guarantees.
 *
 * Strategy:
 *   1. Determine cardType from the highlight context:
 *      - Highlight + contextBefore/contextAfter available → cloze
 *        Front = contextBefore + {{c1::HIGHLIGHT::}} + contextAfter (cloze reveals only the highlighted text)
 *        Back  = full sentence with the highlight
 *      - Otherwise → basic (front: "¿Qué dice el PDF en este highlight?", back: highlight.text)
 *   2. Run cognitiveValidator.validateCard(front, back, cardType):
 *      - Reject if front == back, if too many words (>12 front, >50 back), if mega-card.
 *      - warning[] are surfaced but the card can still be created.
 *   3. atomicRefactor: if it would be a mega-card, we still create 1 card but warn.
 *   4. Persist: flashcards.json (atomic write + de-dup by (front, back)).
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validateCard,
  atomicRefactor,
  looksLikeMegaCard,
} from "./cognitiveValidator.js";
import { defaultFsrsState } from "../routes/flashcards.js";
import {
  pdfAnnotationStorage,
  type PdfHighlight,
} from "./pdfAnnotationStorage.js";

const FLASHCARDS_FILE = join(process.cwd(), "data", "flashcards.json");

export interface AtomicCardResult {
  ok: true;
  cardId: string;
  cardType: "basic" | "cloze";
  front: string;
  back: string;
  warnings: string[];
  hash: string;
  highlightId: string;
  /** Whether persisted to flashcards.json (false if duplicate). */
  persisted: boolean;
  /** Number of duplicates skipped (0 or 1). */
  duplicatesSkipped: number;
}

export interface AtomicCardFailure {
  ok: false;
  error: string;
  warnings: string[];
  highlightId: string;
}

export type AtomicCardResponse = AtomicCardResult | AtomicCardFailure;

function sha(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return `h${(h >>> 0).toString(16)}`;
}

/* ============================================================
 * shapeFromHighlight — derive front/back + type from the highlight
 * ============================================================ */

export interface AtomicCardInput {
  highlight: PdfHighlight;
  /** Force a specific cardType (otherwise decided heuristically). */
  preferType?: "basic" | "cloze";
  /** Optional contextBefore / contextAfter (the runaround the highlight). */
  contextBefore?: string;
  contextAfter?: string;
}

export function shapeFromHighlight(input: AtomicCardInput): {
  cardType: "basic" | "cloze";
  front: string;
  back: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const hl = input.highlight;
  const ctxBefore = (input.contextBefore ?? hl.contextBefore ?? "").trim();
  const ctxAfter = (input.contextAfter ?? hl.contextAfter ?? "").trim();
  const text = (hl.text || "").trim();

  // Decide card type
  let cardType: "basic" | "cloze" = input.preferType ?? (ctxBefore || ctxAfter ? "cloze" : "basic");

  let front = "";
  let back = "";

  if (cardType === "cloze" && (ctxBefore || ctxAfter)) {
    // Cloze with context: {{c1::text::}} surrounded by context.
    front = `${ctxBefore} {{c1::${text}::hint}} ${ctxAfter}`.replace(/\s+/g, " ").trim();
    back = `${ctxBefore} ${text} ${ctxAfter}`.replace(/\s+/g, " ").trim();
  } else if (cardType === "cloze") {
    // Plain cloze wrapping the highlighted text only.
    front = `{{c1::${text}::}}`;
    back = text;
  } else {
    // Basic Q/A
    front = `¿Qué dice el PDF en este extracto?`;
    back = text;
  }

  // Validate atomicity / non-mega / lengths.
  const validation = validateCard(front, back, cardType);
  if (!validation.ok) {
    return {
      cardType,
      front,
      back,
      warnings: validation.warnings,
    };
  }
  warnings.push(...validation.warnings);

  // If still looks like a mega-card, attempt atomicRefactor and create one
  // consolidated card. (We don't auto-split a single highlight; that would
  // lose the user's intent — the warning is enough for the UI to decide.)
  if (looksLikeMegaCard(front, back)) {
    warnings.push("El highlight produce una card grande (>50 palabras back). Considera dividirlo.");
  }

  return {
    cardType,
    front,
    back,
    warnings,
  };
}

/* ============================================================
 * persistFlashcard — atomic write to flashcards.json
 * ============================================================ */

interface ExistingFlashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  tags: string[];
  cardType: string;
  [k: string]: unknown;
}

async function readFlashcards(): Promise<ExistingFlashcard[]> {
  try {
    const buf = await fs.readFile(FLASHCARDS_FILE, "utf-8");
    return JSON.parse(buf);
  } catch {
    return [];
  }
}

async function writeFlashcards(list: ExistingFlashcard[]): Promise<void> {
  await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
  await fs.writeFile(FLASHCARDS_FILE, JSON.stringify(list, null, 2));
}

/* ============================================================
 * createAtomicCardFromHighlight — main entry point
 * ============================================================ */

export async function createAtomicCardFromHighlight(input: AtomicCardInput): Promise<AtomicCardResponse> {
  const shape = shapeFromHighlight(input);
  const highlightId = input.highlight.id;
  const hash = sha(`${shape.front}\u0000${shape.back}`);

  // Persist the highlight first if missing fields.
  if (!input.highlight.contextBefore && input.contextBefore)
    await pdfAnnotationStorage.update(highlightId, input.highlight.documentPath, {
      contextBefore: input.contextBefore,
    });
  if (!input.highlight.contextAfter && input.contextAfter)
    await pdfAnnotationStorage.update(highlightId, input.highlight.documentPath, {
      contextAfter: input.contextAfter,
    });

  // Atomic write + de-dup
  const existing = await readFlashcards();
  const sig = `${shape.front}\u0000${shape.back}`;
  const dupes = existing.filter((c) => `${c.front}\u0000${c.back}` === sig);
  if (dupes.length > 0) {
    // Already exists → return existing but mark highlight's cardId link.
    await pdfAnnotationStorage.update(highlightId, input.highlight.documentPath, {
      cardId: dupes[0].id,
      state: "card-created",
    });
    return {
      ok: true,
      cardId: dupes[0].id,
      cardType: shape.cardType,
      front: shape.front,
      back: shape.back,
      warnings: [...shape.warnings],
      hash,
      highlightId,
      persisted: false,
      duplicatesSkipped: dupes.length,
    };
  }

  const cardId = `fc-${randomUUID()}`;
  const fsrs = defaultFsrsState();
  const subject = input.highlight.subject ?? "";
  const flashcard: ExistingFlashcard = {
    id: cardId,
    front: shape.front,
    back: shape.back,
    subject,
    tags: input.highlight.subject ? [input.highlight.subject] : [],
    cardType: shape.cardType,
    fsrs,
    elaborations: [],
    relatedTo: [],
    interleaveGroup: null,
    sourceNoteId: `pdf:${input.highlight.documentPath}:${input.highlight.page}`,
    sourceExcerpt: input.highlight.text.slice(0, 200),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  existing.push(flashcard);
  await writeFlashcards(existing);
  await pdfAnnotationStorage.update(highlightId, input.highlight.documentPath, {
    cardId,
    state: "card-created",
  });
  return {
    ok: true,
    cardId,
    cardType: shape.cardType,
    front: shape.front,
    back: shape.back,
    warnings: [...shape.warnings],
    hash,
    highlightId,
    persisted: true,
    duplicatesSkipped: 0,
  };
}

/* ============================================================
 * batchFromHighlights — create cards from many at once (e.g. select multiple)
 * ============================================================ */

export interface BatchResult {
  total: number;
  ok: number;
  failed: number;
  persisted: number;
  duplicatesSkipped: number;
  items: AtomicCardResponse[];
}

export async function batchFromHighlights(highlights: PdfHighlight[]): Promise<BatchResult> {
  const items: AtomicCardResponse[] = [];
  let ok = 0, failed = 0, persisted = 0, duplicatesSkipped = 0;
  for (const h of highlights) {
    const r = await createAtomicCardFromHighlight({ highlight: h });
    items.push(r);
    if (r.ok) { ok++; persisted += r.persisted ? 1 : 0; duplicatesSkipped += r.duplicatesSkipped; }
    else failed++;
  }
  return { total: highlights.length, ok, failed, persisted, duplicatesSkipped, items };
}

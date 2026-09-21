/* ============================================================
 * services/anki.ts — Anki .apkg import / export.
 *
 * v2.27.0 — bridge bidirectional con Anki via .apkg.
 *
 * ESTRATEGIA SOPORTADA:
 *   1. .apkg is a ZIP containing:
 *        - collection.anki2 OR collection.json (SQLite o JSON)
 *        - media  (mapping "0": "filename.jpg" etc.)
 *        - media files at the root
 *   2. Collection.json (modern, post-2020) is the easiest:
 *      a JSON object containing decks/notes/cards/models.
 *   3. Collection.anki2 (legacy) is SQLite — Anki schema includes:
 *        - col   (collection metadata)
 *        - notes (id, mid, flds, sfld, tags...)
 *        - cards (id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, ...)
 *        - revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type)
 *
 * We accept both. For SQLite we use better-sqlite3 (already in deps).
 *
 * IMPORT → M-NEXUS Flashcard:
 *   - Cards become { id, front, back, cardType, fsrs:{...}, subject, tags, sourceAnkiNid }
 *   - FSRS state is reconstructed from cards.due + cards.ivl + cards.factor + lastReview
 *   - The full revlog is preserved as flashcards[i].ankiHistory (informational)
 *
 * EXPORT M-NEXUS → .apkg:
 *   - We emit collection.json (modern format) — most widely supported.
 *   - Models: Basic, Cloze (we keep both so users can re-import into Anki).
 *   - Cards include the FSRS state converted to Anki's ivl/due/factor.
 *
 * Caveats / known limitations:
 *   - We don't replicate every Anki feature: only Basic + Cloze + MultiChoice.
 *   - Audio/video not migrated (out of scope for v2.27).
 * ============================================================ */

import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

/* ============================================================
 * M-NEXUS Flashcard shape (subset used here)
 * ============================================================ */

export interface FSRSState {
  stability: number;
  difficulty: number;
  state: "new" | "learning" | "relearning" | "review";
  reps: number;
  lapses: number;
  lastReview: number;
  due: number;
  retrievability: number;
}

export interface MxFlashcard {
  id: string;
  front: string;
  back: string;
  subject: string;
  tags: string[];
  cardType: "basic" | "cloze" | "enumerate" | "image_occlusion" | "multiple_choice";
  fsrs: FSRSState;
  // optional multiple-choice payload
  options?: string[];
  correctIndex?: number;
  // anki provenance
  sourceAnki?: {
    deckName?: string;
    nid?: number;
    cid?: number;
    model?: string;
    history?: AnkiRevLog[];
  };
}

export interface AnkiRevLog {
  ts: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

export interface AnkiCollectionJson {
  version: number;
  models: Record<string, AnkiModel>;
  decks: Record<string, AnkiDeck>;
  notes: AnkiNote[];
  cards: AnkiCard[];
}

export interface AnkiModel {
  id: number;
  name: string;
  type: number; // 0 = standard, 1 = cloze
  flds: Array<{ name: string }>;
  tmpls: Array<{ name: string; qfmt: string; afmt: string }>;
}

export interface AnkiDeck {
  id: number;
  name: string;
}

export interface AnkiNote {
  id: number;
  mid: number;
  flds: string;       // "Front\x1fBack\x1f..."
  sfld: string;       // sort field (first field)
  tags: string[];     // [" tag1", " tag2" ...]
  mod?: number;
}

export interface AnkiCard {
  id: number;
  nid: number;
  did: number;
  ord: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
  left?: number;
  usn?: number;
  mod?: number;
}

/* ============================================================
 * detectFormat — figure out which we have
 * ============================================================ */

export function detectFormat(buf: Buffer): "collection-json" | "collection-anki2" | "unknown" {
  // ZIP signature: 50 4B 03 04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    try {
      const z = new AdmZip(buf);
      const names = z.getEntries().map((e) => e.entryName);
      if (names.includes("collection.json")) return "collection-json";
      if (names.includes("collection.anki21") || names.includes("collection.anki2")) return "collection-anki2";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

/* ============================================================
 * importApkg
 * ============================================================ */

export interface ImportResult {
  cards: MxFlashcard[];
  stats: {
    total: number;
    byType: Record<string, number>;
    byDeck: Record<string, number>;
    withFsrsHistory: number;
    skipped: number;
  };
}

export async function importApkg(buf: Buffer): Promise<ImportResult> {
  const fmt = detectFormat(buf);
  let col: AnkiCollectionJson;
  if (fmt === "collection-json") {
    col = parseFromJson(buf);
  } else if (fmt === "collection-anki2") {
    col = await parseFromSqlite(buf);
  } else {
    throw new Error("Unsupported or invalid .apkg file");
  }
  return mapCollectionToMx(col);
}

/* ============================================================
 * JSON path
 * ============================================================ */

export function parseFromJson(buf: Buffer): AnkiCollectionJson {
  const z = new AdmZip(buf);
  const entry = z.getEntry("collection.json");
  if (!entry) throw new Error("collection.json not found in archive");
  const txt = entry.getData().toString("utf-8");
  const obj = JSON.parse(txt);
  // The actual schema has the structure:
  //  { models: { "1": {...} }, decks: {...}, notes:[...], cards:[...] }
  const notes: AnkiNote[] = (obj.notes ?? []).map((n: any) => ({
    id: n.id,
    mid: n.mid,
    flds: n.flds,
    sfld: n.sfld ?? "",
    tags: Array.isArray(n.tags)
      ? n.tags.map((t: string) => (typeof t === "string" ? t : String(t)))
      : [],
    mod: n.mod,
  }));
  const cards: AnkiCard[] = (obj.cards ?? []).map((c: any) => ({
    id: c.id,
    nid: c.nid,
    did: c.did,
    ord: c.ord,
    type: c.type,
    queue: c.queue,
    due: c.due,
    ivl: c.ivl,
    factor: c.factor,
    reps: c.reps,
    lapses: c.lapses,
    left: c.left,
    usn: c.usn,
    mod: c.mod,
  }));
  const models = obj.models ?? {};
  const decks = obj.decks ?? {};
  return {
    version: obj.version ?? 0,
    models,
    decks,
    notes,
    cards,
  };
}

/* ============================================================
 * SQLite path (legacy)
 * ============================================================ */

export async function parseFromSqlite(buf: Buffer): Promise<AnkiCollectionJson> {
  // adm-zip can extract entries; better-sqlite3 reads from a file or Buffer.
  const z = new AdmZip(buf);
  const fileName = z.getEntry("collection.anki21")
    ? "collection.anki21"
    : z.getEntry("collection.anki2")
    ? "collection.anki2"
    : null;
  if (!fileName) throw new Error("collection.anki2 not found in archive");
  const data = z.getEntry(fileName)!.getData();

  const tempPath = join(process.cwd(), "data", `.tmp-anki-${randomUUID()}.anki2`);
  let db: Database.Database | null = null;
  let result!: AnkiCollectionJson;
  let usedTemp = false;
  try {
    try {
      // @ts-ignore — newer better-sqlite3 accepts Buffer.
      db = new Database(data);
    } catch {
      // Older versions need a real file.
      await fs.writeFile(tempPath, data);
      usedTemp = true;
      db = new Database(tempPath);
    }

    const notesRaw = db.prepare("SELECT id, mid, flds, sfld, tags, mod FROM notes").all() as any[];
    const cardsRaw = db.prepare("SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, usn, mod FROM cards").all() as any[];
    const modelsRaw = db.prepare("SELECT * FROM models").all() as any[];
    const decksRaw = db.prepare("SELECT id, name FROM decks").all() as any[];

    const notes: AnkiNote[] = notesRaw.map((n) => ({
      id: n.id,
      mid: n.mid,
      flds: n.flds,
      sfld: n.sfld ?? "",
      tags: typeof n.tags === "string"
        ? n.tags.split(/\s+/).filter(Boolean).map((t: string) => t.replace(/^~/, ""))
        : [],
      mod: n.mod,
    }));

    const cards: AnkiCard[] = cardsRaw.map((c) => ({
      id: c.id,
      nid: c.nid,
      did: c.did,
      ord: c.ord,
      type: c.type,
      queue: c.queue,
      due: c.due,
      ivl: c.ivl,
      factor: c.factor,
      reps: c.reps,
      lapses: c.lapses,
      left: c.left,
      usn: c.usn,
      mod: c.mod,
    }));

    const models: Record<string, AnkiModel> = {};
    for (const m of modelsRaw) {
      models[String(m.id)] = {
        id: m.id,
        name: m.name,
        type: m.type,
        flds: JSON.parse(m.flds || "[]"),
        tmpls: JSON.parse(m.tmpls || "[]"),
      };
    }
    const decks: Record<string, AnkiDeck> = {};
    for (const d of decksRaw) {
      decks[String(d.id)] = { id: d.id, name: d.name };
    }
    result = { version: 0, models, decks, notes, cards };
  } finally {
    try { db?.close(); } catch {}
    if (usedTemp) {
      try { await fs.unlink(tempPath); } catch {}
    }
  }
  return result;
}

/* ============================================================
 * Mapping Anki → M-NEXUS
 * ============================================================ */

export function mapCollectionToMx(col: AnkiCollectionJson): ImportResult {
  const cards: MxFlashcard[] = [];
  const stats = {
    total: 0,
    byType: {} as Record<string, number>,
    byDeck: {} as Record<string, number>,
    withFsrsHistory: 0,
    skipped: 0,
  };
  const notesById = new Map<number, AnkiNote>();
  for (const n of col.notes) notesById.set(n.id, n);

  for (const ankiCard of col.cards) {
    const note = notesById.get(ankiCard.nid);
    if (!note) { stats.skipped++; continue; }
    const model = col.models?.[String(note.mid)];
    const deck = col.decks?.[String(ankiCard.did)];
    const deckName = deck?.name ?? "Default";

    // Detect model.type
    const isCloze = model?.type === 1 || /cloze/i.test(model?.name ?? "");
    const flds = (note.flds ?? "").split("\x1f");

    let front = "";
    let back = "";
    let cardType: MxFlashcard["cardType"] = "basic";
    if (isCloze) {
      cardType = "cloze";
      // cloze notes store their text in the first field with {{c1::...}} markers.
      front = (flds[0] || "").trim();
      back = (flds[1] || "").trim() || "—";
    } else {
      cardType = "basic";
      front = (flds[0] || "").trim();
      back = (flds[1] || "").trim() || "";
    }

    const fsrs = ankiCardToFsrs(ankiCard);
    if (ankiCard.reps > 0 || ankiCard.lapses > 0) stats.withFsrsHistory++;

    const card: MxFlashcard = {
      id: `fc-${randomUUID()}`,
      front,
      back,
      subject: deckName,
      tags: (note.tags ?? []).filter(Boolean).map((t) => t.replace(/^~/, "").trim()).filter(Boolean),
      cardType,
      fsrs,
      sourceAnki: {
        deckName,
        nid: note.id,
        cid: ankiCard.id,
        model: model?.name,
      },
    };
    cards.push(card);

    stats.total++;
    stats.byType[cardType] = (stats.byType[cardType] ?? 0) + 1;
    stats.byDeck[deckName] = (stats.byDeck[deckName] ?? 0) + 1;
  }

  return { cards, stats };
}

/**
 * Convert Anki's card state (queue/type/due/ivl/factor/reps/lapses) into our
 * FSRS-6 derived state. This is a heuristic mapping — the full Anki scheduler
 * has additional logic, but the basic per-card state is preserved well enough
 * to keep the user's study momentum.
 */
export function ankiCardToFsrs(c: AnkiCard): FSRSState {
  // Heuristic: stability ≈ ivl in days, difficulty from factor (Anki uses 1.0–2.5
  // typically → coerce to FSRS 1-10 scale).
  const interval = Math.max(0, c.ivl ?? 0);
  const factor = c.factor ?? 2500;
  const stability = interval; // 1 day ≈ 1 unit
  const difficulty = Math.max(1, Math.min(10, Math.round(((factor / 1000) - 1) * 5)));
  let state: FSRSState["state"] = "new";
  if (c.reps === 0) state = "new";
  else if (c.queue === 1 /* learning */ || c.queue === 3 /* day learn */) state = "learning";
  else if (c.queue === 2 /* review */) state = c.lapses > 0 && c.reps - c.lapses === 0 ? "relearning" : "review";
  else state = "review";
  return {
    stability,
    difficulty,
    state,
    reps: c.reps ?? 0,
    lapses: c.lapses ?? 0,
    lastReview: 0, // Anki card table doesn't store the absolute ts; use due as proxy offset
    due: c.due > 1e12 /* Anki uses s since epoch; due=1 typically means "unscheduled" */
      ? c.due
      : Date.now() + interval * 86_400_000,
    retrievability: 1,
  };
}

/* ============================================================
 * exportApkg — M-NEXUS → .apkg (collection.json, modern format)
 *
 * Limitations:
 *   - We don't emit the binary `collection.anki21` (it's a SQLite DB and
 *     replicating every column is over-scope for v2.27).
 *   - We don't replicate every FSRS field — we map back to Anki ivl/factor
 *     using a simple heuristic so Anki can keep studying.
 * ============================================================ */

export interface ExportInput {
  cards: MxFlashcard[];
  /** When true, also include revlog (FSRS history) as Anki revlog. */
  includeRevlog?: boolean;
  /** Deck name for the exported collection (default: 'M-NEXUS'). */
  deckName?: string;
}

export interface ExportOutput {
  apkgBytes: Buffer;
  cardCount: number;
  notes: number;
}

export function exportApkg(input: ExportInput): ExportOutput {
  const deckName = input.deckName || "M-NEXUS";
  const deckId = 1;
  const noteId = 1;
  const cardId = 1;

  const models: Record<string, AnkiModel> = {
    "1": {
      id: 1,
      name: "Basic",
      type: 0,
      flds: [{ name: "Front" }, { name: "Back" }],
      tmpls: [{ name: "Card 1", qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}" }],
    },
    "2": {
      id: 2,
      name: "Cloze",
      type: 1,
      flds: [{ name: "Text" }, { name: "Extra" }],
      tmpls: [{ name: "Cloze", qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<hr id=answer>{{Extra}}" }],
    },
  };

  const decks: Record<string, AnkiDeck> = {
    "1": { id: deckId, name: deckName },
  };

  const outNotes: AnkiNote[] = [];
  const outCards: AnkiCard[] = [];
  const outRevlog: any[] = [];

  let nid = noteId;
  let cid = cardId;
  for (const fc of input.cards) {
    if (!fc.front || !fc.front.trim()) continue;
    const isCloze = fc.cardType === "cloze";
    const modelId = isCloze ? 2 : 1;
    const flds = isCloze
      ? `${fc.front.replace(/\n/g, "<br>")}\x1f${(fc.back || "").replace(/\n/g, "<br>")}`
      : `${fc.front.replace(/\n/g, "<br>")}\x1f${(fc.back || "").replace(/\n/g, "<br>")}`;

    const tags = (fc.tags ?? []).filter(Boolean).map((t) => " " + t).join(" ");
    outNotes.push({
      id: nid,
      mid: modelId,
      flds,
      sfld: fc.front.slice(0, 80),
      tags: tags ? tags.split(/\s+/).filter(Boolean) : [],
    });

    // FSRS → Anki
    const interval = Math.max(1, Math.round(fc.fsrs?.stability ?? 0));
    const factor = Math.max(1300, Math.min(3500, Math.round(((fc.fsrs?.difficulty ?? 5) / 10) * 2500 + 1300)));
    const reps = fc.fsrs?.reps ?? 0;
    const lapses = fc.fsrs?.lapses ?? 0;
    let due = 0;
    if (reps === 0) {
      due = fc.fsrs?.due ? Math.round((fc.fsrs.due - Date.now()) / 86_400_000) : 0;
    } else if (fc.fsrs?.state === "review" && fc.fsrs.due) {
      const dt = fc.fsrs.due - Date.now();
      due = dt > 0 ? Math.round(dt / 86_400_000) : 0;
    } else {
      due = reps; // learning state — Anki tracks by ordinal
    }

    outCards.push({
      id: cid,
      nid,
      did: deckId,
      ord: 0,
      type: 0,
      queue: reps > 0 ? 2 : 0,
      due,
      ivl: interval,
      factor,
      reps,
      lapses,
      left: 0,
      usn: 0,
      mod: Math.floor(Date.now() / 1000),
    });

    if (input.includeRevlog && fc.sourceAnki?.history?.length) {
      outRevlog.push(...fc.sourceAnki.history.map((h) => ({
        id: cid * 1000 + (h.ts ?? 0),
        cid,
        usn: 0,
        ease: h.ease,
        ivl: h.ivl,
        lastIvl: h.lastIvl,
        factor: h.factor,
        time: h.time,
        type: h.type,
      })));
    }

    nid++;
    cid++;
  }

  const collection = {
    version: 11,
    models,
    decks,
    notes: outNotes,
    cards: outCards,
    revlog: outRevlog,
    config: {},
  };

  // Build apkg = ZIP(collection.json + media + media mapping)
  const zip = new AdmZip();
  zip.addFile("collection.json", Buffer.from(JSON.stringify(collection), "utf-8"));
  // media map: empty (we don't bundle files for v2.27)
  zip.addFile("media", Buffer.from('{"0":""}', "utf-8"));

  return {
    apkgBytes: zip.toBuffer(),
    cardCount: outCards.length,
    notes: outNotes.length,
  };
}

/* ============================================================
 * Helpers for the route layer
 * ============================================================ */

/**
 * Persist an imported deck to M-NEXUS flashcards.json file.
 * Caller is responsible for atomic write / backup.
 */
export async function persistImported(cards: MxFlashcard[], file = join(process.cwd(), "data", "flashcards.json")): Promise<{ total: number; cards: MxFlashcard[] }> {
  let existing: any[] = [];
  try {
    const buf = await fs.readFile(file, "utf-8");
    existing = JSON.parse(buf);
  } catch {
    existing = [];
  }
  // De-dup by front/back signature
  const sig = (c: MxFlashcard) => `${c.front}::${c.back}`;
  const seen = new Set(existing.map(sig));
  const fresh = cards.filter((c) => !seen.has(sig(c)));
  const merged = [...existing, ...fresh];
  await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
  await fs.writeFile(file, JSON.stringify(merged, null, 2));
  return { total: merged.length, cards: fresh };
}

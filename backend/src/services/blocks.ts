/* ============================================================
 * services/blocks.ts — Block-level outliner model + migration.
 *
 * v2.25.0 (cognitive + PKM integration):
 *   - Each Note now has an optional `blocks: Block[]` array
 *   - Each Block has a UUID, parentId (for hierarchy), text, type
 *   - Backward-compatible migration: if note exists but lacks
 *     blocks, we derive them lazily from `body` (Markdown lines)
 *   - Block-references: `[[uuid]]` and `[[note#^uuid]]` syntax
 *
 * Why: RemNote / Obsidian / Logseq all share the "atomic block
 * as unit" principle. Notes are now containers of blocks; the
 * outliner is the canonical editor (replaces the textarea body
 * for narrow layout in the next sprint).
 * ============================================================ */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Note } from "../routes/notes.js";

export type BlockType = "text" | "cloze" | "callout" | "code" | "toggle" | "quote";

export interface Block {
  id: string;              // "block-<uuid>" — globally unique
  parentId: string | null; // null = root, otherwise the parent's id
  order: number;           // position within siblings (sparse; we re-pack on write)
  text: string;            // raw text incl. inline markdown (==, {{c1::...}}, [[ref]])
  type: BlockType;
  // v2.25.0 optional inline data (e.g. cloze has c1, c2 marker hints)
  meta?: Record<string, unknown>;
  // v2.25.0 backlinks are computed on demand from index; we keep updatedAt here
  // only for UI sort.
  createdAt: number;
  updatedAt: number;
}

export interface BlockIndexEntry {
  blockId: string;
  noteId: string;
  text: string;
}

const BACKLINK_INDEX_FILE = join(process.cwd(), "data", "block-backlinks.json");

/**
 * NoteBlocks — typed accessor for blocks of a Note.
 * Lazily migrates `body` → blocks on first access for legacy notes.
 */
export class NoteBlocks {
  /**
   * Ensure the given note has blocks. Returns the (possibly newly derived) blocks array.
   * Idempotent and safe to call on every read.
   */
  static ensure(note: Note): Block[] {
    if (note.blocks && note.blocks.length > 0) return note.blocks;
    const derived = bodyToBlocks(note.body || "");
    note.blocks = derived;
    return derived;
  }

  static get(note: Note): Block[] {
    return note.blocks ?? [];
  }

  /**
   * Append a new block at root (or under parentId). Returns the new block.
   */
  static append(note: Note, partial: Partial<Block> & { parentId?: string | null; text: string }): Block {
    const blocks = NoteBlocks.ensure(note);
    const siblings = blocks.filter((b) => b.parentId === (partial.parentId ?? null));
    const next: Block = {
      id: `block-${randomUUID()}`,
      parentId: partial.parentId ?? null,
      order: siblings.length,
      text: partial.text,
      type: partial.type ?? "text",
      meta: partial.meta,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    blocks.push(next);
    return next;
  }

  /**
   * Patch a block by id. Throws if not found.
   */
  static patch(note: Note, blockId: string, patch: Partial<Block>): Block | null {
    const blocks = NoteBlocks.ensure(note);
    const i = blocks.findIndex((b) => b.id === blockId);
    if (i < 0) return null;
    blocks[i] = { ...blocks[i], ...patch, id: blocks[i].id, updatedAt: Date.now() };
    return blocks[i];
  }

  /**
   * Move block to a new parent / order. Reparents the whole subtree if needed.
   */
  static move(note: Note, blockId: string, newParentId: string | null, newOrder?: number): boolean {
    const blocks = NoteBlocks.ensure(note);
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return false;
    // Prevent making a node its own ancestor (cycle).
    // Prevent cycle: refuse if `blockId` is itself an ancestor of `newParentId`
    // (would make newParentId a child of one of its own descendants).
    if (newParentId && NoteBlocks.isAncestor(blocks, blockId, newParentId)) return false;
    block.parentId = newParentId;
    if (typeof newOrder === "number") {
      // Re-pack orders in new sibling set.
      const siblings = blocks.filter((b) => b.parentId === newParentId && b.id !== blockId);
      siblings.splice(newOrder, 0, block);
      siblings.forEach((s, i) => (s.order = i));
    }
    block.updatedAt = Date.now();
    return true;
  }

  /**
   * Remove a block (and descendants). Returns true if removed.
   */
  static remove(note: Note, blockId: string): boolean {
    const blocks = NoteBlocks.ensure(note);
    const toRemove = new Set<string>([blockId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of blocks) {
        if (b.parentId && toRemove.has(b.parentId) && !toRemove.has(b.id)) {
          toRemove.add(b.id);
          changed = true;
        }
      }
    }
    note.blocks = blocks.filter((b) => !toRemove.has(b.id));
    return true;
  }

  /** Rebuild mutable state from a flat children array. */
  static isAncestor(blocks: Block[], ancestorId: string, descendantId: string): boolean {
    if (ancestorId === descendantId) return false;
    let cur = blocks.find((b) => b.id === descendantId);
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = blocks.find((b) => b.id === cur!.parentId);
    }
    return false;
  }
}

/**
 * bodyToBlocks — derive blocks from legacy markdown body.
 *
 * Rules (intentionally simple — we keep the user's structure intact):
 *   - Blank lines split into separate blocks.
 *   - Indented lines (leading spaces) become children of the previous root.
 *   - Lines starting with `- `, `* `, `+ ` are bullets → type="text".
 *   - Lines starting with `# ` are headings → type="text" (kept flat).
 *   - Inline `{{cN::...}}` is detected → type="cloze" for the whole block.
 *
 * This is one-way: once blocks exist, body is regenerated FROM blocks on save
 * (so blocks stay canonical). Legacy notes that were never touched still
 * see the same body; only when the user opens the outliner editor do we
 * materialize blocks.
 */
export function bodyToBlocks(body: string): Block[] {
  if (!body) return [];
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let prevRootId: string | null = null;
  let indentStack: { id: string; indent: number }[] = [];

  const indentOf = (line: string): number => {
    const m = /^(\s*)/.exec(line);
    return m ? m[1].length : 0;
  };

  const stripBullet = (line: string): string =>
    line.replace(/^[ \t]*([-*+]|\d+\.)\s+/, "");

  for (const raw of lines) {
    if (raw.trim() === "") continue;
    const indent = indentOf(raw);
    const text = stripBullet(raw.trim());

    // Pop stack until we find parent with smaller indent
    while (indentStack.length > 0 && indentStack[indentStack.length - 1].indent >= indent) {
      indentStack.pop();
    }
    const parentId = indentStack.length > 0 ? indentStack[indentStack.length - 1].id : null;

    const isCloze = /\{\{c\d+::/.test(text);
    const isCode = /^```/.test(text);
    const isQuote = /^>\s/.test(raw);

    const block: Block = {
      id: `block-${randomUUID()}`,
      parentId,
      order: blocks.filter((b) => b.parentId === parentId).length,
      text,
      type: isCloze ? "cloze" : isCode ? "code" : isQuote ? "quote" : "text",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    blocks.push(block);
    indentStack.push({ id: block.id, indent });
    if (parentId === null) prevRootId = block.id;
  }
  return blocks;
}

/**
 * blocksToBody — inverse of bodyToBlocks for export / legacy compatibility.
 * (Markdown bullets with 2-space indent per level.)
 */
export function blocksToBody(blocks: Block[]): string {
  if (!blocks || blocks.length === 0) return "";
  const roots = blocks
    .filter((b) => b.parentId === null)
    .sort((a, b) => a.order - b.order);
  const out: string[] = [];
  const walk = (b: Block, depth: number) => {
    out.push(" ".repeat(depth * 2) + "- " + b.text);
    const children = blocks
      .filter((c) => c.parentId === b.id)
      .sort((a, b) => a.order - b.order);
    for (const c of children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return out.join("\n");
}

/* ============================================================
 * Block Backlink Index
 *
 * Indexes `[[block-id]]` and `[[note-id#^block-id]]` references
 * so the UI can answer "what blocks reference this one?" in O(1).
 * Persisted to data/block-backlinks.json (lazy rebuild on demand).
 * ============================================================ */

interface BacklinkIndex {
  // referenceId → [BlockIndexEntry...]
  references: Record<string, BlockIndexEntry[]>;
}

let backlinkCache: BacklinkIndex | null = null;

async function loadIndex(): Promise<BacklinkIndex> {
  if (backlinkCache) return backlinkCache;
  try {
    const buf = await fs.readFile(BACKLINK_INDEX_FILE, "utf-8");
    backlinkCache = JSON.parse(buf);
    return backlinkCache!;
  } catch {
    backlinkCache = { references: {} };
    return backlinkCache;
  }
}

async function saveIndex(): Promise<void> {
  if (!backlinkCache) return;
  await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
  await fs.writeFile(BACKLINK_INDEX_FILE, JSON.stringify(backlinkCache, null, 2), "utf-8");
}

/** Extract all block-reference tokens from a text. */
export function extractBlockRefs(text: string): string[] {
  const out = new Set<string>();
  if (!text) return [];
  // [[block-id]] — note: Logseq uses ((uuid)) but Obsidian/RN use [[]]
  // We support both: ((block-uuid)) and [[block-uuid]] and [[note#^block-uuid]]
  const re1 = /\[\[\s*([^\]]+?)\s*\]\]/g;
  const re2 = /\(\(\s*([^\)]+?)\s*\)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(text))) {
    const inner = m[1];
    const blockRef = inner.includes("#^") ? inner.split("#^")[1] : inner;
    if (blockRef.startsWith("block-")) out.add(blockRef);
  }
  while ((m = re2.exec(text))) {
    const inner = m[1].trim();
    const blockRef = inner.startsWith("^") ? inner.slice(1) : inner;
    if (blockRef.startsWith("block-")) out.add(blockRef);
  }
  return Array.from(out);
}

/**
 * Rebuild the index for a note. Cheap; O(blocks * refs).
 */
export async function indexNote(note: Note): Promise<void> {
  const idx = await loadIndex();
  // Remove prior entries that referenced this note's blocks.
  for (const key of Object.keys(idx.references)) {
    idx.references[key] = idx.references[key].filter((e) => e.noteId !== note.id);
    if (idx.references[key].length === 0) delete idx.references[key];
  }
  const blocks = NoteBlocks.ensure(note);
  for (const b of blocks) {
    const refs = extractBlockRefs(b.text);
    for (const r of refs) {
      if (!idx.references[r]) idx.references[r] = [];
      idx.references[r].push({ blockId: b.id, noteId: note.id, text: b.text.slice(0, 200) });
    }
  }
  await saveIndex();
}

/** Get all blocks (across all notes) that reference the given blockId. */
export async function backlinksFor(blockId: string): Promise<BlockIndexEntry[]> {
  const idx = await loadIndex();
  return idx.references[blockId] ?? [];
}

/** Force-reset cache (used by tests). */
export function _resetBacklinkCache(): void {
  backlinkCache = null;
}

/* ============================================================
 * Block Query predicates (subset of Logseq Datalog for v2.25)
 *
 * Syntax:
 *   queryNotes({ tag: "anatomy", subject: "anat", containsBlock: "cloze",
 *                dueBefore: ts, isJournal: true })
 *
 * Returns matching notes. (Future v2.29: live block-level queries.)
 * ============================================================ */

export interface BlockQuery {
  tag?: string;
  subject?: string;
  containsBlock?: BlockType | "any-cloze";
  isJournal?: boolean;
  hasBlocks?: boolean;
  textMatches?: string | RegExp;
}

export function matchesBlockQuery(note: Note, q: BlockQuery): boolean {
  if (q.tag && !(note.tags ?? []).includes(q.tag)) return false;
  if (q.subject && note.subject !== q.subject) return false;
  if (q.isJournal && !(note as any).isJournal) return false;
  const blocks = NoteBlocks.get(note);
  if (q.hasBlocks && blocks.length === 0) return false;
  if (q.containsBlock) {
    const wantCloze = q.containsBlock === "any-cloze";
    const ok = blocks.some((b) => (wantCloze ? b.type === "cloze" : b.type === q.containsBlock));
    if (!ok) return false;
  }
  if (q.textMatches) {
    const re = q.textMatches instanceof RegExp ? q.textMatches : new RegExp(q.textMatches, "i");
    const hit = (note.title && re.test(note.title)) || (note.body && re.test(note.body)) ||
      blocks.some((b) => re.test(b.text));
    if (!hit) return false;
  }
  return true;
}

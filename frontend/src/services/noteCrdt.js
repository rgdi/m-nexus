/* services/noteCrdt.js — v2.38.1
 *
 * Concurrent editing for notes, at block granularity.
 *
 * ── Why LWW on the whole note was not enough ──────────────────────
 * `crdt.js` already ships an LWW register per key. Applied to a note as
 * a single key, it is last-write-wins on the entire document: you open
 * a note on the phone, rewrite the third paragraph on the laptop, and
 * the phone silently discards it. No error, no conflict, no record that
 * anything happened — which is the worst failure mode there is, because
 * the user finds out by noticing a paragraph they wrote is gone.
 *
 * ── The model ─────────────────────────────────────────────────────
 * A note is a set of blocks (v2.25.0 already made them the atomic unit,
 * each with a UUID). Each block is its own CRDT key, so two devices
 * editing different blocks never collide, and two devices editing the
 * same block resolve per block rather than per document.
 *
 * For the text inside a block it is a sequence CRDT, so two people
 * typing in the same paragraph both survive: their characters interleave
 * by position rather than one of them vanishing.
 *
 * Block-level deletes are tombstones, so a block deleted on one device
 * stays deleted when it arrives on another, and a concurrent edit to a
 * deleted block does not resurrect it.
 */

import {
  lwwRead, lwwWrite, lwwMerge, tombstone, isTombstoned,
  compareVectors, mergeVectors, bumpVector,
} from "./crdt.js";

const NS = "note";

/* ------------------------------------------------------------------ *
 * Sequence CRDT for a block's text
 * ------------------------------------------------------------------ */

const SEQ_KEY = "seq";

/**
 * A character sequence where each element carries the id of the device
 * that inserted it and the vector at insert time. Two concurrent inserts
 * at the same index are ordered by (deviceId, counter) so every replica
 * produces the same string — a real convergence, not a "close enough"
 * merge.
 *
 * @param {string} noteId
 * @param {string} blockId
 * @param {string} deviceId
 */
export function seqRead(noteId, blockId, deviceId) {
  const key = `${NS}.${noteId}.${blockId}.${SEQ_KEY}`;
  // lwwRead returns the ENTRY — { value, ts, v } — not the payload.
  // Returning it wholesale makes every caller read state.items off an
  // object that has none.
  const entry = lwwRead(key, null);
  if (entry && entry.value) return entry.value;
  return { items: [], counter: 0, v: {} };
}

function seqWrite(noteId, blockId, state) {
  lwwWrite(`${NS}.${noteId}.${blockId}.${SEQ_KEY}`, state, deviceIdOf(state));
  return state;
}

/** The device that last wrote is the one the vector belongs to. */
function deviceIdOf(state) {
  const keys = Object.keys(state.v || {});
  return keys.length ? keys[keys.length - 1] : "unknown";
}

export function seqText(state) {
  return state.items
    .filter((it) => !it.del)
    .map((it) => it.ch)
    .join("");
}

/** Insert `text` at index `at`, tagging each char with this device. */
export function seqInsert(state, text, deviceId) {
  const items = [...state.items];
  let counter = state.counter || 0;
  for (const ch of text) {
    const item = { ch, id: `${deviceId}:${counter}`, by: deviceId, del: false };
    counter++;
    const at = Math.max(0, Math.min(items.length, at_insert(items, item, deviceId)));
    items.splice(at, 0, item);
  }
  return { ...state, items, counter };
}

/** Where a new item goes among concurrent ones: deterministic ordering. */
function at_insert(items, item, deviceId) {
  let i = 0;
  while (i < items.length) {
    const cur = items[i];
    if (cur.del) { i++; continue; }
    // Same-origin: keep insert order. Different origin: sort by id so
    // every replica agrees.
    if (cur.by === deviceId) {
      if (cur.id < item.id) { i++; continue; }
      return i;
    }
    if (cur.by < item.by) { i++; continue; }
    return i;
  }
  return items.length;
}

/** Delete a range by index over the live characters. */
export function seqDelete(state, from, count) {
  const items = [...state.items];
  let live = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].del) continue;
    live++;
    if (live >= from && live < from + count) items[i] = { ...items[i], del: true };
  }
  return { ...state, items };
}

/**
 * Merge a remote state into a local one.
 *
 * Union of items by id, OR of the tombstones. An item only the remote
 * has is taken whole; an item both have with different `del` keeps the
 * delete, because resurrection after a delete is surprising and
 * unrecoverable, while a stale undeleted char is merely visible.
 */
export function seqMerge(local, remote) {
  const byId = new Map();
  for (const it of local.items || []) byId.set(it.id, it);
  for (const it of remote.items || []) {
    const mine = byId.get(it.id);
    if (!mine) { byId.set(it.id, it); continue; }
    if (it.del && !mine.del) byId.set(it.id, it);
  }
  const items = [...byId.values()].sort(compareItems);
  return {
    items,
    counter: Math.max(local.counter || 0, remote.counter || 0),
    v: mergeVectors(local.v || {}, remote.v || {}),
  };
}

/** Total order: same order everywhere, so the string converges. */
function compareItems(a, b) {
  if (a.by !== b.by) return a.by < b.by ? -1 : 1;
  const na = Number(String(a.id).split(":")[1] || 0);
  const nb = Number(String(b.id).split(":")[1] || 0);
  if (na !== nb) return na - nb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Block-level state
 * ------------------------------------------------------------------ */

/** Key for a whole block's LWW register (its order, colour, indent). */
function blockKey(noteId, blockId) {
  return `${NS}.${noteId}.${blockId}.block`;
}

export function readBlock(noteId, blockId) {
  const entry = lwwRead(blockKey(noteId, blockId), null);
  return entry ? entry.value : null;
}

export function writeBlock(noteId, blockId, value, deviceId) {
  return lwwWrite(blockKey(noteId, blockId), value, deviceId);
}

export function mergeBlock(noteId, blockId, remoteEntry, localDeviceId) {
  return lwwMerge(blockKey(noteId, blockId), remoteEntry, localDeviceId);
}

/* ------------------------------------------------------------------ *
 * Tombstones — a deleted block stays deleted
 * ------------------------------------------------------------------ */

function tombKey(noteId, blockId) {
  return `${NS}.${noteId}.${blockId}`;
}

export function isBlockDeleted(noteId, blockId) {
  return isTombstoned(tombKey(noteId, blockId));
}

export function deleteBlock(noteId, blockId, deviceId = "local") {
  // Routed through crdt.js so the tombstone lands in the same store the
  // sync layer already replicates. Writing to localStorage directly here
  // would create a second, unreplicated copy under a different key — the
  // delete would vanish on the next device.
  tombstone(tombKey(noteId, blockId), deviceId);
}

export function deletedBlocks(noteId, blocks) {
  return (blocks || []).filter((b) => isBlockDeleted(noteId, b.id)).map((b) => b.id);
}

/* ------------------------------------------------------------------ *
 * Note-level helpers
 * ------------------------------------------------------------------ */

/** Build the initial sequence state for a block from existing text. */
export function initBlockText(text, deviceId) {
  const base = { items: [], counter: 0, v: { [deviceId]: 0 } };
  return text ? seqInsert(base, text, deviceId) : base;
}

/** Reconcile a note's blocks against the local CRDT state. */
export function reconcile(note, deviceId) {
  const blocks = note?.blocks ?? [];
  const out = [];
  const changed = [];
  for (const b of blocks) {
    if (isBlockDeleted(note.id, b.id)) continue;
    let st = seqRead(note.id, b.id, deviceId);
    if (!st.items.length && b.text) {
      st = initBlockText(b.text, deviceId);
      changed.push({ blockId: b.id, text: seqText(st) });
    }
    out.push({ id: b.id, text: seqText(st), state: st });
  }
  return { blocks: out, changed };
}

/** Apply a remote block state, returning the new text. */
export function applyRemote(noteId, blockId, remoteState, localDeviceId) {
  const local = seqRead(noteId, blockId, localDeviceId);
  const merged = seqMerge(local, remoteState);
  lwwWrite(`${NS}.${noteId}.${blockId}.${SEQ_KEY}`, merged, localDeviceId);
  return seqText(merged);
}

export { compareVectors, mergeVectors, bumpVector };

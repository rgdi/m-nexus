// field_history.js — v2.21.1
//
// Per-field undo/redo for note text fields (title, body, tags, ...).
// The CRDT layer in services/crdt.ts already keeps per-field vector
// clocks + LWW semantics; this module adds a *local* history layer on
// top so users can press Cmd/Ctrl+Z to undo their own edits without
// rolling back merges from other clients.
//
// Design:
//   - History is per (noteId, field). Each entry is a "snapshot"
//     { value, ts, clock, origin }. Snapshots are pushed on debounced
//     change (300ms) + on focus blur.
//   - undo() pops one snapshot, applies the previous value to the DOM
//     + to the underlying note state, and pushes a redo entry.
//   - redo() restores the popped snapshot.
//   - When a remote CRDT update arrives for the same field while the
//     user is typing, we *clear* the history for that field (the local
//     timeline is now out of sync with the canonical state; preserving
//     it would re-apply the user's stale edit on top of the remote one).
//   - History is kept in memory only. Survives navigation within the
//     SPA via a Map on window.__mnexus_field_history. Lost on reload —
//     acceptable for v2.21.1 (no persistence yet).
//
// Public API:
//   - trackField(noteId, field, currentValue, opts): returns
//     { setValue, undo, redo, canUndo, canRedo, clear }
//   - applyRemoteUpdate(noteId, field): discards history for that field.
//   - getHistorySize(noteId, field): number (for tests).

const DEBOUNCE_MS = 300;
const MAX_HISTORY = 50;

function getStore() {
  if (typeof window === "undefined") return null;
  if (!window.__mnexus_field_history) {
    window.__mnexus_field_history = new Map();
  }
  return window.__mnexus_field_history;
}

/**
 * Make a key for a (noteId, field) pair.
 */
function key(noteId, field) {
  return noteId + "::" + field;
}

/**
 * Get the history record for a field, creating it lazily.
 */
function getRecord(noteId, field) {
  const store = getStore();
  if (!store) return null;
  const k = key(noteId, field);
  let rec = store.get(k);
  if (!rec) {
    rec = {
      past: [],
      future: [],
      current: { value: undefined, ts: 0 },
      timer: null,
      lastCommittedValue: undefined,
    };
    store.set(k, rec);
  }
  return rec;
}

/**
 * Track a field's history. Returns an object with setValue/undo/redo.
 *
 *   const t = trackField(noteId, "title", currentValue);
 *   t.setValue(newValue);           // user edited
 *   if (t.canUndo()) t.undo();      // back one step
 *   if (t.canRedo()) t.redo();      // forward one step
 *   t.clear();                       // drop all history (e.g. note deleted)
 *
 * @param {string} noteId
 * @param {string} field
 * @param {*} initialValue
 * @returns {Object|null} API object, or null if SSR.
 */
export function trackField(noteId, field, initialValue) {
  const rec = getRecord(noteId, field);
  if (!rec) return null;
  rec.current = { value: initialValue, ts: Date.now() };
  rec.lastCommittedValue = initialValue;

  function commitSnapshot(force) {
    if (rec.timer) {
      clearTimeout(rec.timer);
      rec.timer = null;
    }
    // Don't commit if the value hasn't changed since last commit.
    if (!force && rec.lastCommittedValue === rec.current.value) return;
    rec.past.push({
      value: rec.lastCommittedValue,
      ts: Date.now(),
      origin: "local",
    });
    if (rec.past.length > MAX_HISTORY) rec.past.shift();
    rec.future = []; // a new edit invalidates the redo stack.
    rec.lastCommittedValue = rec.current.value;
  }

  function scheduleCommit() {
    if (rec.timer) clearTimeout(rec.timer);
    rec.timer = setTimeout(() => commitSnapshot(false), DEBOUNCE_MS);
  }

  return {
    /** Update the current value (called on every input event). */
    setValue(v) {
      rec.current.value = v;
      scheduleCommit();
    },
    /** Force-flush the pending snapshot (call on blur, save, route change). */
    flush() {
      commitSnapshot(true);
    },
    undo() {
      // Flush pending so we don't lose the in-flight edit.
      commitSnapshot(false);
      if (rec.past.length === 0) return null;
      const prev = rec.past.pop();
      rec.future.push({
        value: rec.current.value,
        ts: Date.now(),
        origin: "undo",
      });
      rec.current.value = prev.value;
      rec.lastCommittedValue = prev.value;
      return prev.value;
    },
    redo() {
      if (rec.future.length === 0) return null;
      const next = rec.future.pop();
      rec.past.push({
        value: rec.current.value,
        ts: Date.now(),
        origin: "redo",
      });
      rec.current.value = next.value;
      rec.lastCommittedValue = next.value;
      return next.value;
    },
    canUndo() {
      return rec.past.length > 0;
    },
    canRedo() {
      return rec.future.length > 0;
    },
    size() {
      return rec.past.length + rec.future.length;
    },
    clear() {
      if (rec.timer) clearTimeout(rec.timer);
      rec.past = [];
      rec.future = [];
      rec.current = { value: rec.lastCommittedValue, ts: Date.now() };
    },
  };
}

/**
 * Discard history for a (noteId, field) — called when a remote CRDT
 * update overwrites the field. The local timeline is no longer
 * consistent with the canonical state.
 */
export function applyRemoteUpdate(noteId, field) {
  const store = getStore();
  if (!store) return;
  const rec = store.get(key(noteId, field));
  if (!rec) return;
  // Reset to the new canonical state — we don't know what value the
  // remote set, so we just drop the local history.
  rec.past = [];
  rec.future = [];
  rec.lastCommittedValue = rec.current.value;
}

/** Test-only: clear everything. */
export function _resetAll() {
  const store = getStore();
  if (!store) return;
  for (const rec of store.values()) {
    if (rec.timer) clearTimeout(rec.timer);
  }
  store.clear();
}

/** Test-only: get raw record for inspection. */
export function _getRecord(noteId, field) {
  return getRecord(noteId, field);
}

/** Test-only: get history size. */
export function getHistorySize(noteId, field) {
  const rec = getRecord(noteId, field);
  if (!rec) return 0;
  return rec.past.length + rec.future.length;
}

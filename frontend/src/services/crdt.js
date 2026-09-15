/* ============================================================
 * crdt.js — Yjs-inspired minimal CRDT for notes/flashcards sync.
 * v2.1.3 — implements a Last-Write-Wins (LWW) per-field CRDT with
 * vector clocks + tombstones for deletes. No external deps.
 *
 * The frontend uses this locally; the backend relay just forwards
 * CRDT ops to all peers. Each device converges to the same state.
 * ============================================================ */

const VKEY = "mnexus.crdt.vector";
const DELKEY = "mnexus.crdt.tombstones";

/**
 * Vector clock: per-device monotonic counter map.
 */
export function getVector() {
  try { return JSON.parse(localStorage.getItem(VKEY) || "{}"); }
  catch { return {}; }
}
function setVector(v) {
  localStorage.setItem(VKEY, JSON.stringify(v));
}
export function bumpVector(deviceId) {
  const v = getVector();
  v[deviceId] = (v[deviceId] || 0) + 1;
  setVector(v);
  return v;
}
export function mergeVectors(a, b) {
  const out = { ...a };
  for (const k in b) out[k] = Math.max(out[k] || 0, b[k]);
  return out;
}
export function compareVectors(a, b) {
  // returns true if a > b (a happened after b)
  let ag = false, bg = false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const av = a[k] || 0, bv = b[k] || 0;
    if (av > bv) ag = true;
    if (bv > av) bg = true;
  }
  return ag && !bg; // a > b
}

/**
 * LWW Register — last write wins per device.
 */
const LWW_PREFIX = "mnexus.crdt.lww.";
export function lwwRead(key, fallback = null) {
  try {
    const raw = localStorage.getItem(LWW_PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}
export function lwwWrite(key, value, deviceId) {
  const ts = Date.now();
  const v = bumpVector(deviceId);
  const entry = { value, ts, v };
  try {
    localStorage.setItem(LWW_PREFIX + key, JSON.stringify(entry));
  } catch {}
  return entry;
}

/**
 * Merge remote LWW entry into local.
 * @returns "local" | "remote" | "tie"
 */
export function lwwMerge(key, remoteEntry, localDeviceId) {
  const localRaw = localStorage.getItem(LWW_PREFIX + key);
  const local = localRaw ? JSON.parse(localRaw) : null;
  if (!local) {
    localStorage.setItem(LWW_PREFIX + key, JSON.stringify(remoteEntry));
    return "remote";
  }
  if (remoteEntry.ts > local.ts) {
    localStorage.setItem(LWW_PREFIX + key, JSON.stringify(remoteEntry));
    return "remote";
  }
  if (remoteEntry.ts === local.ts) {
    // tiebreak by deviceId
    if (remoteEntry.v[remoteEntry.deviceId || "?"] > (local.v?.[localDeviceId] || 0)) {
      localStorage.setItem(LWW_PREFIX + key, JSON.stringify(remoteEntry));
      return "remote";
    }
  }
  return "local";
}

/**
 * Tombstones — track deleted items so they stay deleted across
 * concurrent edits. After 7 days, garbage-collected.
 */
export function getTombstones() {
  try { return JSON.parse(localStorage.getItem(DELKEY) || "{}"); }
  catch { return {}; }
}
function setTombstones(t) {
  localStorage.setItem(DELKEY, JSON.stringify(t));
}
export function tombstone(key, deviceId) {
  const t = getTombstones();
  t[key] = { by: deviceId, at: Date.now() };
  setTombstones(t);
}
export function isTombstoned(key) {
  return !!getTombstones()[key];
}
export function gcTombstones(maxAgeMs = 7 * 86400 * 1000) {
  const t = getTombstones();
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(t)) {
    if (now - t[k].at > maxAgeMs) { delete t[k]; changed = true; }
  }
  if (changed) setTombstones(t);
}

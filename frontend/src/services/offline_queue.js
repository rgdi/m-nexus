// offline_queue.js — IndexedDB-backed mutation queue for offline writes (v2.19.0).
//
// When the app is offline (no network), mutations (POST/PATCH/DELETE
// against notes, flashcards, tasks, events) are pushed to this queue
// instead of being sent directly. The queue persists across reloads.
//
// When connectivity returns, the queue is drained in batches of up
// to 50 entries via POST /api/v1/sync/replay. The backend applies
// each entry via the same CRDT pipeline used by the realtime WS
// sync, so conflict semantics are consistent.
//
// Storage: IndexedDB database `mnexus-offline` with object store
// `queue` keyed by auto-incremented id. Entries are inserted in
// FIFO order and replayed in FIFO order too.

const DB_NAME = "mnexus-offline";
const DB_VERSION = 1;
const STORE = "queue";

let dbPromise = null;

/**
 * Enqueue a mutation. Persisted to IndexedDB synchronously (i.e. before
 * the function returns) so a page reload won't drop it.
 *
 * @param {Object} entry
 * @param {"note"|"flashcard"|"task"|"event"|"recording"|"subject"} entry.type
 * @param {"create"|"update"|"delete"} entry.op
 * @param {string} entry.resourceId
 * @param {any} [entry.data]
 * @param {number} entry.ts
 */
export async function enqueue(entry) {
  const full = { ...entry, retries: 0 };
  return withStore("readwrite", (store) => p(store.add(full)));
}

export async function enqueueMany(entries) {
  return withStore("readwrite", (store) =>
    Promise.all(entries.map((e) => p(store.add({ ...e, retries: 0 }))))
  );
}

export async function size() {
  return withStore("readonly", (store) => p(store.count()));
}

export async function peekAll(limit = 200) {
  return withStore("readonly", (store) =>
    p(store.getAll()).then((all) => all.slice(0, limit))
  );
}

export async function removeMany(ids) {
  await withStore("readwrite", async (store) => {
    for (const id of ids) {
      await p(store.delete(id));
    }
  });
}

export async function bumpRetries(id, errMsg) {
  await withStore("readwrite", async (store) => {
    const cur = await p(store.get(id));
    if (cur) {
      cur.retries += 1;
      cur.lastError = String(errMsg).slice(0, 200);
      await p(store.put(cur));
    }
  });
}

export async function clear() {
  await withStore("readwrite", (store) => p(store.clear()));
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("byTs", "ts", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        Promise.resolve(fn(store))
          .then((r) => {
            result = r;
          })
          .catch((e) => reject(e))
          .finally(() => {
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
      })
  );
}

function p(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Replay all queued entries against the backend. Returns a summary.
 *   - onApplied: called with each successfully applied entry id
 *   - onFailed:  called with (id, error) for permanent failures
 *
 * Errors are classified:
 *   - Network error → leave entry in queue, retry next online cycle
 *   - 4xx → mark for retry (will bump retries up to 5 then drop)
 *   - 5xx → leave in queue
 */
export async function replay(deviceId, apiBase, authToken, options = {}) {
  const all = await peekAll();
  if (all.length === 0) {
    return { total: 0, applied: 0, superseded: 0, rejected: 0, remaining: 0 };
  }
  const batchSize = options.batchSize ?? 50;
  let applied = 0;
  let superseded = 0;
  let rejected = 0;
  const toDelete = [];
  const toBumpRetry = [];

  for (let i = 0; i < all.length; i += batchSize) {
    const batch = all.slice(i, i + batchSize);
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;

    let resp;
    try {
      resp = await fetch(`${apiBase}/api/v1/sync/replay`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          deviceId,
          entries: batch.map(({ id: _id, retries: _r, lastError: _le, ...rest }) => rest),
        }),
      });
    } catch (e) {
      for (const e2 of batch) toBumpRetry.push({ id: e2.id, err: String(e?.message || e) });
      options.onProgress?.(i, all.length);
      break;
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      for (const e2 of batch) toBumpRetry.push({ id: e2.id, err: `HTTP ${resp.status}: ${text.slice(0, 120)}` });
      options.onProgress?.(i, all.length);
      break;
    }

    const j = await resp.json();
    const results = (j && j.results) || [];
    const byId = new Map(results.map((r) => [String(r.id), r]));
    for (const entry of batch) {
      const r = byId.get(String(entry.id));
      if (!r) {
        rejected++;
        toBumpRetry.push({ id: entry.id, err: "no result from backend" });
        continue;
      }
      if (r.status === "applied" || r.status === "superseded") {
        if (r.status === "applied") applied++;
        else superseded++;
        toDelete.push(entry.id);
      } else if (r.status === "duplicate") {
        toDelete.push(entry.id);
      } else {
        rejected++;
        if (entry.retries >= 4) {
          toDelete.push(entry.id);
        } else {
          toBumpRetry.push({ id: entry.id, err: r.status });
        }
      }
    }
    options.onProgress?.(i + batch.length, all.length);
  }

  await removeMany(toDelete);
  for (const { id, err } of toBumpRetry) {
    await bumpRetries(id, err);
  }

  const remaining = await size();
  return { total: all.length, applied, superseded, rejected, remaining };
}

/* ============================================================
 * store.js — minimal localStorage wrapper with namespacing.
 * v1.0.0 — fallback when backend is offline.
 * ============================================================ */

const PREFIX = "mnexus.v1.";

export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch {}
  },
  has(key) {
    try { return localStorage.getItem(PREFIX + key) != null; } catch { return false; }
  },
  keys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  },

  /**
   * Bind a CRUD-shaped resource to a namespace in localStorage.
   * Returns helpers { list, get, create, update, remove } that
   * operate on local data so the app can run fully offline.
   */
  bind: (_api) => { /* placeholder for future hooks */ },

  /**
   * Generate a stable id (ULID-ish).
   */
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
};

/**
 * Resource: a typed collection persisted in localStorage.
 */
export function collection(name) {
  const KEY = `col.${name}`;
  return {
    list() {
      return store.get(KEY, []);
    },
    get(id) {
      return this.list().find((x) => x.id === id);
    },
    create(input) {
      const items = this.list();
      const item = { id: store.uid(), createdAt: Date.now(), ...input };
      items.push(item);
      store.set(KEY, items);
      return item;
    },
    update(id, patch) {
      const items = this.list();
      const i = items.findIndex((x) => x.id === id);
      if (i < 0) return null;
      items[i] = { ...items[i], ...patch, updatedAt: Date.now() };
      store.set(KEY, items);
      return items[i];
    },
    remove(id) {
      const items = this.list().filter((x) => x.id !== id);
      store.set(KEY, items);
      return true;
    },
  };
}

/* ============================================================
 * dataSource.js — abstrae API vs localStorage.
 * v1.1.0 — cada llamada intenta API; si falla, usa local.
 *
 * Las screens consumen `dataSource.subjects.list()` y similares.
 * Esto permite que el frontend funcione con o sin backend.
 * ============================================================ */

import { api } from "./api.js";
import { store, collection } from "./store.js";

let backendOnline = false;

export async function detectBackend() {
  const prev = backendOnline;
  try {
    await api.health();
    backendOnline = true;
  } catch {
    backendOnline = false;
  }
  if (prev !== backendOnline) {
    // Emit to listeners (offline pill, etc.)
    document.dispatchEvent(new CustomEvent("backend-status", { detail: { online: backendOnline } }));
    document.documentElement.dataset.backend = backendOnline ? "online" : "offline";
  }
  return backendOnline;
}

export function isOnline() { return backendOnline; }

/**
 * Build a unified resource: tries backend first; on failure uses localStorage.
 * Each method returns the same shape regardless of source.
 */
function resource(name, apiMethods) {
  const col = collection(name);
  return {
    async list() {
      if (backendOnline) {
        try { return await apiMethods.list(); }
        catch (e) { console.warn(`[${name}] falling back to local`, e); }
      }
      return col.list();
    },
    async get(id) {
      if (backendOnline) {
        try { return await apiMethods.get(id); }
        catch (e) { console.warn(`[${name}] falling back to local`, e); }
      }
      return col.get(id);
    },
    async create(input) {
      if (backendOnline) {
        try {
          const created = await apiMethods.create(input);
          // Mirror locally so cache stays consistent
          col.create({ ...created, id: created.id });
          return created;
        } catch (e) { console.warn(`[${name}] create remote failed`, e); }
      }
      return col.create(input);
    },
    async update(id, patch) {
      if (backendOnline) {
        try {
          const updated = await apiMethods.update(id, patch);
          col.update(id, updated);
          return updated;
        } catch (e) { console.warn(`[${name}] update remote failed`, e); }
      }
      return col.update(id, patch);
    },
    async remove(id) {
      if (backendOnline) {
        try { await apiMethods.remove(id); } catch (e) { console.warn(e); }
      }
      return col.remove(id);
    },
  };
}

export const dataSource = {
  subjects: resource("subjects", api.subjects),
  notes: resource("notes", api.notes),
  events: resource("events", api.events),
  tasks: resource("tasks", api.tasks),
  folders: resource("folders", api.folders),

  async notes_appendStroke(noteId, page, stroke) {
    if (backendOnline) {
      try { return await api.notes.appendStroke(noteId, page, stroke); } catch (e) { console.warn(e); }
    }
    // local fallback
    const col = collection("notes");
    const n = col.get(noteId);
    if (!n) return null;
    if (!n.pages[page]) n.pages[page] = { strokes: [], placeholders: [] };
    n.pages[page].strokes.push(stroke);
    col.update(noteId, { pages: n.pages });
    return { ok: true };
  },

  async tasks_toggle(id) {
    if (backendOnline) {
      try { return await api.tasks.toggle(id); } catch (e) { console.warn(e); }
    }
    const col = collection("tasks");
    const t = col.get(id);
    if (!t) return null;
    return col.update(id, { done: !t.done });
  },
};

// Boot: detect backend on import
detectBackend();

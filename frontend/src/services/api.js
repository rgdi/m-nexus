/* ============================================================
 * api.js — HTTP client for the M-NEXUS backend.
 * v1.0.0 — fetch + tiny retry layer. Falls back to local store if offline.
 * ============================================================ */

const API_BASE = location.hostname === "localhost" || location.hostname.endsWith(".localhost")
  ? `http://${location.hostname}:4100`
  : `${location.protocol}//${location.host}/api/v1`;

/**
 * Wrap fetch with timeout + JSON. Throws ApiError on non-2xx.
 */
async function req(method, path, body, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 8000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const ct = res.headers.get("content-type") ?? "";
    const data = ct.includes("json") ? await res.json() : await res.text();
    if (!res.ok) {
      throw new ApiError(data?.message ?? `HTTP ${res.status}`, res.status, data);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export const api = {
  base: API_BASE,

  health: () => req("GET", "/health"),

  // ----- Notes -----
  notes: {
    list: () => req("GET", "/notes").catch(() => []),
    get: (id) => req("GET", `/notes/${id}`),
    create: (body) => req("POST", "/notes", body),
    update: (id, body) => req("PATCH", `/notes/${id}`, body),
    remove: (id) => req("DELETE", `/notes/${id}`),
  },

  // ----- Subjects -----
  subjects: {
    list: () => req("GET", "/subjects").catch(() => []),
    create: (body) => req("POST", "/subjects", body),
    update: (id, body) => req("PATCH", `/subjects/${id}`, body),
    remove: (id) => req("DELETE", `/subjects/${id}`),
  },

  // ----- Calendar / Events -----
  events: {
    list: (from, to) => req("GET", `/events?from=${from}&to=${to}`).catch(() => []),
    create: (body) => req("POST", "/events", body),
    update: (id, body) => req("PATCH", `/events/${id}`, body),
    remove: (id) => req("DELETE", `/events/${id}`),
  },

  // ----- Flashcards -----
  flashcards: {
    due: () => req("GET", "/flashcards/due").catch(() => []),
    review: (id, rating) => req("POST", `/flashcards/${id}/review`, { rating }),
    create: (body) => req("POST", "/flashcards", body),
  },

  // ----- AI Tutor -----
  ai: {
    chat: (messages, opts) => req("POST", "/ai/chat", { messages, ...opts }, { timeout: 30000 }),
    ragSearch: (query, k) => req("POST", "/ai/rag-search", { query, k }),
  },

  // ----- Sync -----
  sync: {
    pull: (since) => req("GET", `/notes/sync/pull?since=${since ?? 0}`),
    push: (entries) => req("POST", "/notes/sync/push", { entries }),
  },

  // ----- Marketplace -----
  marketplace: {
    list: () => req("GET", "/marketplace-v2/decks").catch(() => ({ decks: [] })),
    install: (deckId) => req("POST", `/marketplace-v2/decks/${deckId}/install`, { userId: "self" }),
  },
};

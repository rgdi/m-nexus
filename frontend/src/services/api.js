/* ============================================================
 * api.js — HTTP client for the M-NEXUS backend.
 * v1.0.0 — fetch + tiny retry layer. Falls back to local store if offline.
 * v2.6.0 — auto-attaches Bearer token + handles 401 → refresh → retry.
 * ============================================================ */

import { auth } from "./auth.js";

// v2.1.5: build API base URL robustly
// - Dev: hardcode http://localhost:4100
// - Prod: same origin (so we work behind any reverse proxy / domain)
const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? `http://${location.hostname}:4100/api/v1`
  : `${location.protocol}//${location.host}/api/v1`;

let refreshInFlight = null;

async function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;
  const rt = auth.getRefreshToken();
  if (!rt) return false;
  refreshInFlight = (async () => {
    try {
      const r = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: rt }),
      });
      if (!r.ok) {
        auth.clearTokens();
        return false;
      }
      const data = await r.json();
      if (data.accessToken) {
        auth.saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        return true;
      }
      return false;
    } catch {
      auth.clearTokens();
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Wrap fetch with timeout + JSON + auto-Bearer + 401-refresh-retry.
 * Throws ApiError on non-2xx.
 */
async function req(method, path, body, opts = {}) {
  const doFetch = () => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeout ?? 8000);
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const access = auth.getAccessToken();
    if (access) headers.Authorization = `Bearer ${access}`;
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    }).finally(() => clearTimeout(timer));
  };

  let res = await doFetch();

  // 401 → try refresh once, then retry
  if (res.status === 401 && auth.getRefreshToken()) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await doFetch();
  }

  // Final 401 → session expired, redirect to login
  if (res.status === 401) {
    auth.clearTokens();
    if (!location.hash.startsWith("#/login") && !location.hash.startsWith("#/setup")) {
      location.hash = "#/login";
    }
  }

  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ApiError(data?.message ?? data?.error ?? `HTTP ${res.status}`, res.status, data);
  }
  return data;
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
    list: () => req("GET", "/notes").then(r => r.notes ?? []).catch(() => []),
    get: (id) => req("GET", `/notes/${id}`),
    create: (body) => req("POST", "/notes", body),
    update: (id, body) => req("PATCH", `/notes/${id}`, body),
    remove: (id) => req("DELETE", `/notes/${id}`),
    appendStroke: (id, page, stroke) => req("POST", `/notes/${id}/pages/${page}/strokes`, { stroke }),
  },

  // ----- Folders (v2.3.0-B) -----
  folders: {
    list: () => req("GET", "/folders").then(r => r.folders ?? []).catch(() => []),
    create: (body) => req("POST", "/folders", body),
    update: (id, body) => req("PATCH", `/folders/${id}`, body),
    remove: (id) => req("DELETE", `/folders/${id}`),
  },

  // ----- Subjects -----
  subjects: {
    list: () => req("GET", "/subjects").then(r => r.subjects ?? []).catch(() => []),
    get: (id) => req("GET", `/subjects/${id}`),
    create: (body) => req("POST", "/subjects", body),
    update: (id, body) => req("PATCH", `/subjects/${id}`, body),
    remove: (id) => req("DELETE", `/subjects/${id}`),
  },

  // ----- Calendar / Events -----
  events: {
    list: (from, to) => req("GET", `/events?from=${from ?? 0}&to=${to ?? Date.now() + 365 * 86400000}`).then(r => r.events ?? []).catch(() => []),
    get: (id) => req("GET", `/events/${id}`),
    create: (body) => req("POST", "/events", body),
    update: (id, body) => req("PATCH", `/events/${id}`, body),
    remove: (id) => req("DELETE", `/events/${id}`),
  },

  // ----- Tasks (to-do's) -----
  tasks: {
    list: () => req("GET", "/tasks").then(r => r.tasks ?? []).catch(() => []),
    get: (id) => req("GET", `/tasks/${id}`),
    create: (body) => req("POST", "/tasks", body),
    update: (id, body) => req("PATCH", `/tasks/${id}`, body),
    remove: (id) => req("DELETE", `/tasks/${id}`),
    toggle: (id) => req("POST", `/tasks/${id}/toggle`),
  },

  // ----- Flashcards -----
  flashcards: {
    due: () => req("GET", "/flashcards/due").catch(() => []),
    review: (id, rating) => req("POST", `/flashcards/${id}/review`, { rating }),
    create: (body) => req("POST", "/flashcards", body),
    filter: (noteId) => req("GET", `/flashcards/filter?noteId=${encodeURIComponent(noteId)}`),
  },

  // ----- AI Tutor -----
  ai: {
    chat: (messages, opts) => req("POST", "/ai/chat", { messages, ...opts }, { timeout: 30000 }),
    ragSearch: (query, k) => req("POST", "/ai/rag-search", { query, k }),
    tutor: (question, snippets) => req("POST", "/ai/tutor", { question, snippets }, { timeout: 30000 }),
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

  // ----- v2.6.0: auth + admin -----
  auth: {
    status: () => req("GET", "/auth/status"),
    me: () => req("GET", "/auth/me"),
    setup: (username, password) => req("POST", "/auth/setup", { username, password }),
    logout: () => req("POST", "/auth/logout", {}),
  },
  admin: {
    getAI: () => req("GET", "/admin/ai"),
    setAI: (cfg) => req("POST", "/admin/ai", cfg),
    testAI: () => req("POST", "/admin/ai/test", {}),
    getBackup: () => req("GET", "/admin/backup"),
    setBackup: (cfg) => req("POST", "/admin/backup/config", cfg),
    runBackup: () => req("POST", "/admin/backup/run", {}),
  },

  // ----- v2.8.0: study planner -----
  study: {
    generateDiagnostic: (topicId, syllabus, maxQuestions = 10) =>
      req("POST", "/study/diagnostic/generate", { topicId, syllabus, maxQuestions }),
    runDiagnostic: (topicId, questions, answers) =>
      req("POST", "/study/diagnostic/run", { topicId, questions, answers }),
    planStudy: (exams, diagnostics, config) =>
      req("POST", "/study/scheduler/plan", { exams, diagnostics, config }),
    pendingCandidates: (topicId) =>
      req("GET", `/study/generation/pending${topicId ? `?topicId=${encodeURIComponent(topicId)}` : ""}`),
    decideCandidate: (id, status, reason) =>
      req("POST", "/study/generation/decide", { id, status, reason }),
    addCandidate: (body) => req("POST", "/study/generation/add", body),
  },

  // ----- v2.8.0: image occlusion -----
  occlusion: {
    createCard: (body) => req("POST", "/occlusion/card", body),
    listCards: (topicId) =>
      req("GET", `/occlusion/cards${topicId ? `?topicId=${encodeURIComponent(topicId)}` : ""}`),
    getCard: (id) => req("GET", `/occlusion/card/${id}`),
    addMask: (id, mask) => req("POST", `/occlusion/card/${id}/mask`, mask),
    removeMask: (id, maskId) => req("DELETE", `/occlusion/card/${id}/mask/${maskId}`),
  },
};

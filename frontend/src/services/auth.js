/* ============================================================
 * auth.js — Token storage + helpers (v2.6.0)
 *
 * Access token  → sessionStorage (1h TTL, in-memory + survives page reload)
 * Refresh token → localStorage (90d TTL, persistent across sessions)
 *
 * The refresh token rotates on every /auth/refresh call. This prevents
 * replay attacks if a token is stolen. Old refresh tokens are revoked
 * server-side once rotated.
 * ============================================================ */

const ACCESS_KEY = "mnexus.auth.access";
const REFRESH_KEY = "mnexus.auth.refresh";

// In-memory cache so we don't pay a sessionStorage read every request.
let memAccess = null;

function safeStorage(storage, op, key, value) {
  try {
    if (op === "get") return storage.getItem(key);
    if (op === "set") storage.setItem(key, value);
    if (op === "remove") storage.removeItem(key);
  } catch {
    // private mode / quota exceeded — silently degrade
  }
}

export const auth = {
  saveTokens({ accessToken, refreshToken }) {
    if (accessToken) {
      memAccess = accessToken;
      safeStorage(sessionStorage, "set", ACCESS_KEY, accessToken);
    }
    if (refreshToken) {
      safeStorage(localStorage, "set", REFRESH_KEY, refreshToken);
    }
  },

  getAccessToken() {
    if (memAccess) return memAccess;
    memAccess = safeStorage(sessionStorage, "get", ACCESS_KEY);
    return memAccess;
  },

  getRefreshToken() {
    return safeStorage(localStorage, "get", REFRESH_KEY);
  },

  clearTokens() {
    memAccess = null;
    safeStorage(sessionStorage, "remove", ACCESS_KEY);
    safeStorage(localStorage, "remove", REFRESH_KEY);
  },

  isAuthed() {
    return !!(this.getAccessToken() || this.getRefreshToken());
  },

  /** True if we have any token at all. Doesn't guarantee validity — that's checked server-side. */
  hasRefreshToken() {
    return !!this.getRefreshToken();
  },
};

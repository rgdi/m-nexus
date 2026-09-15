/* ============================================================
 * storage.js — localStorage wrapper with quota/error handling.
 * v2.1.5+ W5 — Centralize localStorage to avoid 15 sites using
 * raw localStorage directly.
 *
 * Why: localStorage can throw (QuotaExceededError, SecurityError in
 * sandboxed iframes, etc). Without try/catch, the whole UI can break.
 *
 * Usage:
 *   import { storage } from "./services/storage.js";
 *   storage.set("key", { foo: "bar" });
 *   const x = storage.get("key", { foo: "default" });
 * ============================================================ */

const NS = "mnexus.";

/**
 * Storage wrapper with JSON serialization + error handling.
 * All keys are auto-prefixed with "mnexus." to avoid collisions.
 */
export const storage = {
  /**
   * Get a value by key (with optional default).
   * Returns defaultValue if key missing OR parse error OR storage unavailable.
   */
  get(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      if (raw === null) return defaultValue;
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`[storage] get(${key}) failed:`, e.message);
      return defaultValue;
    }
  },

  /**
   * Set a value (auto-serialized to JSON).
   * Returns true on success, false on quota/security errors.
   */
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn(`[storage] set(${key}) failed:`, e.message);
      return false;
    }
  },

  /**
   * Remove a key. Returns true on success.
   */
  remove(key) {
    try {
      localStorage.removeItem(NS + key);
      return true;
    } catch (e) {
      console.warn(`[storage] remove(${key}) failed:`, e.message);
      return false;
    }
  },

  /**
   * Check if a key exists.
   */
  has(key) {
    try {
      return localStorage.getItem(NS + key) !== null;
    } catch (e) {
      return false;
    }
  },

  /**
   * Get all keys with the "mnexus." prefix (used for migration).
   */
  keys() {
    try {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NS)) out.push(k.slice(NS.length));
      }
      return out;
    } catch (e) {
      return [];
    }
  },

  /**
   * Clear all M-NEXUS keys (NOT other apps).
   */
  clear() {
    try {
      const keys = this.keys();
      for (const k of keys) this.remove(k);
      return keys.length;
    } catch (e) {
      return 0;
    }
  },

  /**
   * Estimate quota usage (0..1). Returns null if not available.
   */
  quotaUsage() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then((est) => {
          if (est.quota && est.usage) return est.usage / est.quota;
          return null;
        });
      }
      return Promise.resolve(null);
    } catch (e) {
      return Promise.resolve(null);
    }
  },
};

/**
 * Legacy string-only helpers (for code that doesn't want JSON).
 * Use sparingly — prefer storage.get/set with JSON values.
 */
export const storageRaw = {
  get(key, defaultValue = null) {
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? defaultValue : raw;
    } catch (e) {
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  },
};

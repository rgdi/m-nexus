/* ============================================================
 * safe.js — escape HTML to prevent XSS.
 * v2.1.5+ W7 — Centralize escapeHtml/escapeAttr/escapeJs.
 *
 * Why: 92 innerHTML assignments in frontend. Currently 3 sites have
 * their own escapeHtml() copy-pasted. Centralize for consistency.
 * ============================================================ */

/**
 * Escape a string for safe insertion into HTML body.
 * Use this whenever interpolating user data into innerHTML.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/**
 * Escape a string for safe insertion into an HTML attribute value
 * (surrounded by double quotes).
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeAttr(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape a string for safe insertion inside a <script> block
 * (e.g. JSON in <script type="application/json">).
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeJs(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Escape a URL component (path segment). Encodes everything except
 * RFC3986 unreserved characters.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeUrl(str) {
  if (str === null || str === undefined) return "";
  return encodeURIComponent(String(str));
}

/**
 * Sanitize a string for display in CSS context (style attribute).
 * Closes injection vectors like "javascript:" or "expression(".
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeCss(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[<>{}()'"\\]/g, (c) => `\\${c}`);
}

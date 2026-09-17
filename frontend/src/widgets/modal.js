/* ============================================================
 * modal.js — shared modal helpers (v2.6.0 audit fix)
 *
 * Provides:
 *  - makeModal(html, onClose) → returns { scrim, close }
 *  - escapeToClose(modal) → adds Escape keyboard listener
 *  - clickOutsideToClose(modal) → adds click-outside listener (default)
 *
 * Usage:
 *   import { makeModal } from "../widgets/modal.js";
 *   const { scrim, close } = makeModal(html);
 *   document.body.appendChild(scrim);
 *   // ...later: close() removes from DOM and removes listener
 * ============================================================ */

/**
 * Create a modal scrim with the given inner HTML.
 * Returns the scrim element and a close() function.
 * Closes on:
 *   - Click on the scrim backdrop (not the content)
 *   - Escape key
 *   - Click on any [data-close] button inside
 */
export function makeModal(html, opts = {}) {
  const scrim = document.createElement("div");
  scrim.className = opts.className || "scrim";
  scrim.innerHTML = html;
  scrim.setAttribute("role", "dialog");
  scrim.setAttribute("aria-modal", "true");

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    document.removeEventListener("keydown", onKey);
  };

  // Click outside to close
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
    if (e.target.closest("[data-close]")) close();
  });

  // Escape to close
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener("keydown", onKey);

  return { scrim, close };
}

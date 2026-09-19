// ocrToast.js — Transient toast for OCR feedback (v2.14.0).
//
// Shows a small overlay with the recognized text after a successful
// OCR round-trip. Auto-dismisses after 3.5 seconds. Multiple toasts
// stack vertically.

const TTL_MS = 3500;
const FADE_MS = 250;
let container = null;

function ensureContainer() {
  // Check if cached container is still attached to body
  if (container && container.parentElement === document.body) {
    return container;
  }
  container = document.createElement("div");
  container.className = "ocr-toast-container";
  Object.assign(container.style, {
    position: "fixed",
    bottom: "80px",
    right: "16px",
    display: "flex",
    flexDirection: "column-reverse",
    gap: "8px",
    zIndex: "220",
    pointerEvents: "none",
    maxWidth: "320px",
  });
  document.body.appendChild(container);
  return container;
}

const STYLE_ID = "ocr-toast-styles";
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ocr-toast {
      background: var(--bg-elevated, #fff);
      border: 1px solid var(--border, #e5e7eb);
      border-left: 3px solid var(--accent, #8c5cf6);
      border-radius: 8px;
      padding: 8px 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      font-size: 13px;
      color: var(--fg, #1a1d24);
      opacity: 0;
      transform: translateX(20px);
      transition: opacity 200ms, transform 250ms;
    }
    .ocr-toast.visible {
      opacity: 1;
      transform: translateX(0);
    }
    .ocr-toast-meta {
      font-size: 11px;
      color: var(--fg-muted, #6b7280);
      margin-bottom: 2px;
    }
    .ocr-toast-text {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 12px;
    }
  `;
  document.head.appendChild(s);
}

/**
 * Show an OCR result toast.
 * @param text - recognized text
 * @param confidence - 0..1
 * @param source - "tesseract" | "heuristic" | "hybrid"
 */
export function showOcrToast(text, confidence = 0.7, source = "tesseract") {
  if (!text || text.trim().length < 1) return;
  ensureStyles();
  const c = ensureContainer();
  const el = document.createElement("div");
  el.className = "ocr-toast";
  el.innerHTML = `
    <div class="ocr-toast-meta">OCR · ${source} · conf ${(confidence * 100).toFixed(0)}%</div>
    <div class="ocr-toast-text"></div>
  `;
  el.querySelector(".ocr-toast-text").textContent = text.length > 60 ? text.slice(0, 60) + "…" : text;
  c.appendChild(el);
  // Animate in
  requestAnimationFrame(() => el.classList.add("visible"));
  // Auto-dismiss
  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), FADE_MS);
  }, TTL_MS);
}

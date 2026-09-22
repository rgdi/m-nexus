/* ============================================================
 * widgets/pdf_viewer.js — Visor PDF con highlights atómicos.
 *
 * v2.28.0 — pipeline PDF → flashcard:
 *   - Carga PDF con pdf.js
 *   - Selección de texto → floating "Crear flashcard" button
 *   - Selección de área → floating button (rect highlight)
 *   - Side panel con todos los highlights del documento
 *   - Click highlight → crear/regenerar flashcard con un click
 *
 * Stack: pdfjs-dist (CDN lazy-loaded), IntersectionObserver,
 * role="application" para ARIA, prefers-reduced-motion respetado.
 * ============================================================ */

import { makeModal } from "./modal.js";
import { attachOcclusionMode, renderOcclusions } from "./pdf_occlusion.js";
import { mountSyncIndicator } from "./pdf_sync_indicator.js";

const API = "/api/v1/pdf";
let pdfjsPromise = null;

/** Lazy-load pdf.js from CDN; ensures single-flight */
function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";
    script.type = "module";
    script.onload = () => {
      // pdfjs-dist ESM export attached differently; fallback to UMD if needed
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const umd = document.createElement("script");
      umd.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js";
      umd.onload = () => resolve(window.pdfjsLib);
      umd.onerror = reject;
      document.head.appendChild(umd);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

/**
 * Open PDF viewer modal.
 * @param {object} opts
 * @param {string} opts.pdfUrl  URL to the PDF
 * @param {string} opts.title   Modal title
 * @param {(highlights: any[]) => void} [opts.onChange]
 */
export async function openPdfViewer({ pdfUrl, title = "Visor PDF", onChange = () => {} }) {
  const modal = makeModal({
    title,
    body: `
      <div class="pdf-viewer" role="application" aria-label="Visor PDF con highlights">
        <div class="pdf-toolbar" role="toolbar" aria-label="Herramientas del PDF">
          <button class="pdf-tool" data-tool="text" aria-pressed="true" type="button">
            <span aria-hidden="true">🖊</span> Texto
          </button>
          <button class="pdf-tool" data-tool="rect" aria-pressed="false" type="button">
            <span aria-hidden="true">▭</span> Área
          </button>
          <button class="pdf-tool" data-tool="occlusion" aria-pressed="false" type="button">
            <span aria-hidden="true">▮</span> Oclusión
          </button>
          <span class="pdf-stat" data-stat="count">0 highlights</span>
          <button class="pdf-tool" data-action="batch" type="button">
            Convertir todas a cards
          </button>
          <div class="pdf-sync-mount" data-sync-mount></div>
        </div>
        <div class="pdf-body">
          <div class="pdf-pages" data-pdf-pages role="region" aria-label="Páginas"></div>
          <aside class="pdf-sidepanel" aria-label="Highlights y flashcards">
            <h3 class="pdf-side-title">Highlights</h3>
            <ul class="pdf-highlight-list" data-highlight-list></ul>
          </aside>
        </div>
        <button class="pdf-floating" data-floating hidden type="button" aria-label="Crear flashcard desde selección">
          ✨ Crear flashcard
        </button>
      </div>
    `,
    actions: [
      { id: "close", label: "Cerrar", variant: "secondary" },
    ],
  });

  const root = modal.body.querySelector(".pdf-viewer");
  const pagesHost = root.querySelector("[data-pdf-pages]");
  const listEl = root.querySelector("[data-highlight-list]");
  const statEl = root.querySelector("[data-stat]");
  const floating = root.querySelector("[data-floating]");

  // State
  let tool = "text";
  let documentPath = pdfUrl;
  let highlights = [];
  let pdfDoc = null;
  let scale = 1.25;

  // ===== PDF rendering =====
  try {
    const pdfjs = await loadPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js";
    pdfDoc = await pdfjs.getDocument(pdfUrl).promise;
    await renderPages();
  } catch (e) {
    pagesHost.innerHTML = `<p class="pdf-error">Error cargando PDF: ${escapeHtml(String(e))}</p>`;
    return modal;
  }

  async function renderPages() {
    pagesHost.innerHTML = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale });
      const wrap = document.createElement("div");
      wrap.className = "pdf-page";
      wrap.dataset.page = String(i);
      wrap.style.width = `${viewport.width}px`;
      wrap.style.height = `${viewport.height}px`;
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.setAttribute("aria-label", `Página ${i}`);
      wrap.appendChild(canvas);
      const textLayer = document.createElement("div");
      textLayer.className = "pdf-text-layer";
      textLayer.style.width = `${viewport.width}px`;
      textLayer.style.height = `${viewport.height}px`;
      wrap.appendChild(textLayer);
      pagesHost.appendChild(wrap);
      // eslint-disable-next-line no-await-in-loop
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      // eslint-disable-next-line no-await-in-loop
      await renderTextLayer(page, textLayer, viewport);
    }
    bindSelectionHandlers();
    await loadExistingHighlights();
    // v2.29.0: occlusion mode + cross-device sync indicator
    attachOcclusionMode(pagesHost, () => {
      loadExistingHighlights().then(() => renderOcclusions(pagesHost, documentPath));
    }, () => documentPath);
    await renderOcclusions(pagesHost, documentPath);
    const syncMount = root.querySelector("[data-sync-mount]");
    if (syncMount) {
      const handle = mountSyncIndicator(syncMount);
      handle.setDocumentPath(documentPath);
    }
  }

  async function renderTextLayer(page, host, viewport) {
    const txt = await page.getTextContent();
    for (const item of txt.items) {
      const [a, b, c, d, , , , , , , x, y] = item.transform;
      const fontHeight = Math.hypot(a, b);
      const span = document.createElement("span");
      span.textContent = item.str;
      span.className = "pdf-text-span";
      span.style.left = `${x}px`;
      span.style.top = `${viewport.height - y}px`;
      span.style.fontSize = `${fontHeight}px`;
      span.style.width = `${item.width}px`;
      span.style.height = `${item.height}px`;
      host.appendChild(span);
    }
  }

  // ===== Highlights: load + create =====
  async function loadExistingHighlights() {
    try {
      const r = await fetch(`${API}/highlights?documentPath=${encodeURIComponent(documentPath)}`);
      const j = await r.json();
      highlights = j.highlights || [];
      renderList();
      renderOverlayHighlights();
    } catch (e) {
      console.warn("[pdf-viewer] load highlights failed", e);
    }
  }

  function renderOverlayHighlights() {
    document.querySelectorAll(".pdf-hl-overlay").forEach((n) => n.remove());
    for (const h of highlights) {
      const pageWrap = pagesHost.querySelector(`[data-page="${h.page}"]`);
      if (!pageWrap) continue;
      const overlay = document.createElement("div");
      overlay.className = `pdf-hl-overlay ${h.state === "card-created" ? "pdf-hl--done" : ""}`;
      overlay.dataset.highlightId = h.id;
      overlay.title = h.text;
      overlay.textContent = h.text.slice(0, 60);
      pageWrap.appendChild(overlay);
    }
  }

  function renderList() {
    listEl.innerHTML = "";
    statEl.textContent = `${highlights.length} highlight${highlights.length === 1 ? "" : "s"}`;
    if (highlights.length === 0) {
      listEl.innerHTML = `<li class="pdf-empty">Selecciona texto en el PDF para empezar.</li>`;
      return;
    }
    for (const h of highlights) {
      const li = document.createElement("li");
      li.className = `pdf-highlight-item pdf-hl-item--${h.state}`;
      li.dataset.highlightId = h.id;
      li.innerHTML = `
        <div class="pdf-hl-meta">
          <span class="pdf-hl-page">p.${h.page}</span>
          <span class="pdf-hl-state">${stateEmoji(h.state)}</span>
          ${h.subject ? `<span class="pdf-hl-subject">${escapeHtml(h.subject)}</span>` : ""}
        </div>
        <p class="pdf-hl-text">"${escapeHtml(h.text.slice(0, 140))}${h.text.length > 140 ? "…" : ""}"</p>
        <div class="pdf-hl-actions">
          <button class="pdf-hl-btn" data-action="card" type="button">✨ Crear flashcard</button>
          <button class="pdf-hl-btn" data-action="delete" type="button" aria-label="Eliminar highlight">🗑</button>
        </div>
      `;
      li.querySelector('[data-action="card"]').addEventListener("click", () => createCardFromHighlight(h.id));
      li.querySelector('[data-action="delete"]').addEventListener("click", () => deleteHighlight(h.id));
      listEl.appendChild(li);
    }
  }

  function stateEmoji(state) {
    if (state === "card-created") return "✅";
    if (state === "card-rejected") return "❌";
    return "📝";
  }

  // ===== Selection handling =====
  function bindSelectionHandlers() {
    pagesHost.querySelectorAll(".pdf-page").forEach((pageEl) => {
      pageEl.addEventListener("mouseup", () => {
        setTimeout(() => showFloating(pageEl), 50);
      });
      pageEl.addEventListener("keyup", () => {
        showFloating(pageEl);
      });
    });
  }

  function showFloating(pageEl) {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 3) {
      floating.hidden = true;
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    floating.style.left = `${rect.right - pageRect.left + 8}px`;
    floating.style.top = `${rect.top - pageRect.top + 4}px`;
    floating.hidden = false;
    floating.dataset.text = text;
    floating.dataset.page = pageEl.dataset.page;
    // capture context
    floating.dataset.contextBefore = captureContext(pageEl, range.startContainer, true);
    floating.dataset.contextAfter = captureContext(pageEl, range.endContainer, false);
  }

  function captureContext(pageEl, container, isBefore) {
    const text = pageEl.innerText || "";
    return isBefore ? text.slice(0, 100).trim() : text.slice(-100).trim();
  }

  floating.addEventListener("click", async () => {
    const text = floating.dataset.text;
    const page = parseInt(floating.dataset.page, 10);
    if (!text) return;
    floating.disabled = true;
    try {
      const r = await fetch(`${API}/highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentPath,
          page,
          format: tool === "text" ? "text" : "rect",
          text,
          contextBefore: floating.dataset.contextBefore,
          contextAfter: floating.dataset.contextAfter,
          color: tool === "text" ? "#FFEB3B" : "#FF9800",
        }),
      });
      if (r.ok) {
        const created = await r.json();
        highlights.push(created);
        floating.hidden = true;
        window.getSelection()?.removeAllRanges();
        renderList();
        renderOverlayHighlights();
        onChange(highlights);
      }
    } catch (e) {
      console.warn("[pdf-viewer] create highlight failed", e);
    } finally {
      floating.disabled = false;
    }
  });

  async function createCardFromHighlight(highlightId) {
    try {
      const r = await fetch(`${API}/highlights/${encodeURIComponent(highlightId)}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferType: "cloze" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const result = await r.json();
      // Update local state
      const idx = highlights.findIndex((h) => h.id === highlightId);
      if (idx >= 0) {
        highlights[idx].state = "card-created";
        highlights[idx].cardId = result.cardId;
      }
      renderList();
      renderOverlayHighlights();
      onChange(highlights);
      // Toast
      showToast(
        result.persisted
          ? `✅ Card creada: ${result.cardType}`
          : `↻ Ya existía: ${result.cardId} (${result.duplicatesSkipped} dup)`,
      );
    } catch (e) {
      showToast(`❌ Error: ${e.message}`, true);
    }
  }

  async function deleteHighlight(highlightId) {
    if (!confirm("¿Eliminar este highlight?")) return;
    try {
      const r = await fetch(
        `${API}/highlights/${encodeURIComponent(highlightId)}?documentPath=${encodeURIComponent(documentPath)}`,
        { method: "DELETE" },
      );
      if (r.ok) {
        highlights = highlights.filter((h) => h.id !== highlightId);
        renderList();
        renderOverlayHighlights();
        onChange(highlights);
      }
    } catch (e) {
      showToast(`❌ Error: ${e.message}`, true);
    }
  }

  // ===== Toolbar =====
  root.querySelectorAll(".pdf-tool[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tool = btn.dataset.tool;
      root.querySelectorAll(".pdf-tool[data-tool]").forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.tool === tool)),
      );
      pagesHost.classList.toggle("pdf-mode--occlusion", tool === "occlusion");
    });
  });

  root.querySelector('[data-action="batch"]').addEventListener("click", async () => {
    const raw = highlights.filter((h) => h.state === "raw");
    if (raw.length === 0) return showToast("No hay highlights nuevos");
    if (!confirm(`¿Convertir ${raw.length} highlights a flashcards?`)) return;
    try {
      const r = await fetch(`${API}/batch/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentPath, highlightIds: raw.map((h) => h.id) }),
      });
      const result = await r.json();
      // Refresh
      await loadExistingHighlights();
      showToast(`✅ ${result.persisted}/${result.total} cards creadas`);
      onChange(highlights);
    } catch (e) {
      showToast(`❌ Error: ${e.message}`, true);
    }
  });

  return modal;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".pdf-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "pdf-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("pdf-toast--error", isError);
  t.textContent = msg;
  t.classList.add("pdf-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("pdf-toast--show"), 2500);
}

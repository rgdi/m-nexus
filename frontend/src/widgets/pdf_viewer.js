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
import { detectApiBase } from "../services/api_base.js";

const API = `${detectApiBase()}/api/v1/pdf`;
let pdfjsPromise = null;

/** Lazy-load pdf.js from CDN; ensures single-flight */
function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;

  // v2.38.15 — pdf.js va en la app, no en un CDN.
  //
  // Venia de cdnjs. En un PWA eso significa que el visor de PDF —la
  // pantalla donde se lee el material y se subrayan las flashcards—
  // no abria sin conexion, justo lo contrario de lo que se promete al
  // instalarla. Ahora va servida desde /vendor y el service worker
  // la precachea. Si aun asi no esta (una instalacion vieja), se cae
  // al CDN: mejor un visor lento que ninguno.
  const LOCAL = "/vendor/pdf.min.mjs";
  const CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs";

  pdfjsPromise = (async () => {
    if (window.pdfjsLib) return window.pdfjsLib;
    for (const url of [LOCAL, CDN]) {
      try {
        const mod = await import(/* @vite-ignore */ url);
        if (mod && mod.getDocument) {
          if (mod.GlobalWorkerOptions) {
            // El worker va con la misma copia: si el visor y el
            // worker son de versiones distintas, pdf.js avisa y se
            // rompe al procesar la primera pagina.
            mod.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";
          }
          return mod;
        }
      } catch { /* el siguiente */ }
    }
    throw new Error("pdf.js no está disponible ni local ni en el CDN");
  })().catch((e) => {
    // Sin reintentos eternos: si la copia local no esta, el siguiente
    // visito vuelve a probar y ya esta.
    pdfjsPromise = null;
    throw e;
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
          <button class="pdf-tool pdf-tool--print" data-action="print" type="button" title="Imprimir con look premium">
            <span aria-hidden="true">🖨</span> Imprimir
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
    // v2.38.15 — el modal mide lo que mida el resto, y una hoja A4
    // con un panel lateral al lado no caben: la pagina salia con una
    // franja de 260 px y no se leia. El visor necesita sitio.
    className: "scrim scrim--wide",
  });

  // v2.38.2: makeModal returns { root, scrim, close, getValue } — there
  // is no `body`. `modal.body.querySelector` threw "cannot read
  // properties of undefined", so the viewer died at the first line after
  // opening and no PDF ever rendered, on any device.
  const root = modal.root.querySelector(".pdf-viewer");
  if (!root) throw new Error("el modal no contiene el visor");
  const pagesHost = root.querySelector("[data-pdf-pages]");
  /** Una superficie por página, y un solo sync para todas. */
  const inkPads = new Map();
  let inkSync = null;
  const listEl = root.querySelector("[data-highlight-list]");
  const statEl = root.querySelector("[data-stat]");
  const floating = root.querySelector("[data-floating]");

  // State
  let tool = "text";
  let documentPath = pdfUrl;
  let highlights = [];
  let pdfDoc = null;
  let scale = 1.25;

  // Un id estable por documento, para que la tinta vuelva al mismo
  // sitio mañana. Con la ruta basta: es lo que el usuario reconoce.
  // Va aqui y no junto a su uso: renderPages() se llama mas abajo, y
  // declarado despues el nombre estaria en TDZ.
  const docId = "pdf:" + String(pdfUrl || title).slice(0, 160);

  // v2.38.15 — makeModal() DEVUELVE la raiz: el que la llama tiene que
  // montarla en el documento. Este visor la montaba y se la guardaba, y
  // se quedaba fuera del arbol: el boton "Abrir PDF local" no
  // abria nada, en ningun dispositivo, y `document.querySelector`
  // (.pdf-viewer) no encontraba nada. Una funcion async que acaba
  // devolviendo `modal` mientras su UI no existe nunca.
  if (!root.isConnected) document.body.appendChild(modal.root);

  // ===== PDF rendering =====
  try {
    const pdfjs = await loadPdfJs();
    // v2.38.15 — aqui se pisaba el worker con la URL del CDN, encima
    // de la local que acaba de dejar loadPdfJs(). El visor se servia
    // pdf.js del disco y luego le mandaba a buscar el worker a
    // internet: sin red, "Failed to fetch" y ni una pagina. La version
    // ya la fija loadPdfJs, y es la misma copia que la del visor.
    pdfDoc = await pdfjs.getDocument(pdfUrl).promise;
    await renderPages();
  } catch (e) {
    pagesHost.innerHTML = `<p class="pdf-error">Error cargando PDF: ${escapeHtml(String(e))}</p>`;
    return modal;
  }

  /**
   * Una superficie de tinta por página.
   *
   * El número de página va en los trazos, no en la posición, que es lo
   * que hace que al cambiar de zoom o de tamaño siga encima de lo
   * mismo.
   */
  async function mountInkForPage(host, pageNumber, docId) {
    const { mountInkPad } = await import("./ink_pad.js");
    const { createInkSync, loadInk } = await import("../services/inkSync.js");

    const doc = await loadInk(docId);
    const strokes = (doc.pages || [])
      .filter((p) => p.page === pageNumber - 1)
      .flatMap((p) => p.strokes || []);

    // Un solo sync por documento, compartido por todas sus páginas: si
    // no, cada página abre su propio canal y no se sincronizan entre sí
    // entre sí.
    if (!inkSync) {
      inkSync = createInkSync(docId, {
        onRemote: (incoming) => {
          for (const s of incoming) {
            const pad = inkPads.get(s.page);
            if (pad) pad.merge([s]);
          }
        },
      });
      inkSync.start(3000);
    }

    const pad = mountInkPad(host, {
      strokes,
      // El PDF es papel: lapiz oscuro. Con la paleta de la superficie
      // oscura se escribia en #e8e8ef sobre blanco y no se veia.
      ton: "light",
      deviceId: docId.slice(0, 24),
      onStrokeEnd: (_s, nuevos) => {
        for (const s of nuevos) s.page = pageNumber - 1;
        inkSync.push(nuevos);
        // Un?. no protege un nombre no declarado: eso es ReferenceError.
        if (typeof setInkStatus === "function") setInkStatus("Guardado");
      },
    });
    inkPads.set(pageNumber - 1, pad);
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

      // v2.38.15 — la capa de escritura a mano, por página.
      //
      // Se monta UNA SUPERFICIE POR PÁGINA y no una gigante: es lo
      // único que hace que lo que escribes en la página 3 siga
      // encima de la página 3 al hacer scroll, y no se mueva con la
      // pantalla. Un trazo anclado a la poscision del scroll se
      // despega de su pagina en cuanto se toca.
      const inkHost = document.createElement("div");
      inkHost.className = "pdf-ink-layer";
      wrap.appendChild(inkHost);

      pagesHost.appendChild(wrap);
      // eslint-disable-next-line no-await-in-loop
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      // eslint-disable-next-line no-await-in-loop
      await renderTextLayer(page, textLayer, viewport);

      // eslint-disable-next-line no-await-in-loop
      await mountInkForPage(inkHost, i, docId);
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
      showToast(`❌ Error: ${e.message}`);
    }
  });

  // v2.33.1: print PDF with live preview modal (instead of native dialog).
  // Same print stylesheet as notes (print.css). Highlights + occlusions
  // are revealed at print time so the printed artifact matches the
  // on-screen reading experience.
  root.querySelector('[data-action="print"]').addEventListener("click", async () => {
    try {
      const html = await buildPdfPrintHTML({ title, highlights, occlusions, pagesHost, documentPath });
      const { openPrintPreview } = await import("./print_preview.js");
      await openPrintPreview({
        html,
        title: title || "PDF",
        note: null,
        kind: "pdf",
      });
      showToast("🖨 Preview abierto");
    } catch (e) {
      console.error("print preview failed", e);
      showToast(`❌ Print failed: ${e.message}`);
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

/* ============================================================
 * v2.33.0 — Print PDF document with the same premium look as notes.
 *
 * Approach:
 * - Render each page to canvas (already done by pdf.js).
 * - Serialize canvas → PNG dataURL.
 * - Build an HTML fragment with the same `.print-document` shell used
 *   by notes: header (title + path + date) + each page as a section
 *   with the page image, plus a "Highlights" appendix that lists each
 *   highlight as an atomic-flashcard block (so they look identical to
 *   note-side flashcards).
 * - Print via hidden iframe (same trick as `printNote` in notes.js).
 *
 * Output is byte-identical in typography, colors and structure to a
 * printed note — that's the whole point of v2.33.0: notas y PDFs
 * comparten el mismo aspecto al imprimir.
 * ============================================================ */

async function buildPdfPrintHTML({ title, highlights, occlusions, pagesHost, documentPath }) {
  const escHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
  const dateStr = new Date().toLocaleDateString("es-ES", {
    year: "numeric", month: "long", day: "numeric",
  });
  const vaultName = (() => {
    try { return localStorage.getItem("mnexus.vault.name") || "M-NEXUS"; }
    catch { return "M-NEXUS"; }
  })();

  // Snapshot every canvas in the pages host (pdf.js renders one per page).
  const canvases = Array.from(pagesHost.querySelectorAll("canvas"));
  const pagesHTML = canvases.map((canvas, i) => {
    let dataUrl = "";
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch (e) {
      console.warn("canvas toDataURL failed for page", i, e);
    }
    return `
      <section class="pdf-page no-break">
        <figure class="pdf-page-figure">
          ${dataUrl ? `<img src="${dataUrl}" alt="Página ${i + 1}" />` : `<div class="pdf-page-fallback">Página ${i + 1} (no se pudo capturar)</div>`}
          <figcaption class="pdf-page-number">Página ${i + 1} de ${canvases.length}</figcaption>
        </figure>
      </section>
    `;
  }).join("");

  // Highlights as atomic flashcards — same look as notes.
  const highlightsHTML = (highlights || [])
    .filter((h) => h.text)
    .map((h) => `
      <div class="atomic-flashcard no-break">
        <div class="fc-front">${escHtml(h.text || "")}</div>
        <div class="fc-back">${escHtml(h.note || h.context || "")}</div>
      </div>
    `).join("");

  // Occlusions are revealed at print time (the masked area becomes a
  // flashcard-style box with the answer revealed).
  const occlusionsHTML = (occlusions || [])
    .filter((o) => o.answer || o.text)
    .map((o) => `
      <div class="atomic-flashcard no-break">
        <div class="fc-front">▣ Oclusión (página ${o.page || "?"})</div>
        <div class="fc-back">${escHtml(o.answer || o.text || "")}</div>
      </div>
    `).join("");

  const html = `
    <article class="pdf-print print-document">
      <header class="print-header">
        <h1>${escHtml(title || "Documento PDF")}</h1>
        <div class="print-meta">
          ${documentPath ? `<span><span class="meta-key">Archivo</span>${escHtml(documentPath.split("/").pop() || documentPath)}</span>` : ""}
          <span><span class="meta-key">Fecha</span>${escHtml(dateStr)}</span>
          <span><span class="meta-key">Vault</span>${escHtml(vaultName)}</span>
          <span><span class="meta-key">Páginas</span>${canvases.length}</span>
          <span><span class="meta-key">Highlights</span>${(highlights || []).length}</span>
        </div>
      </header>

      <section class="pdf-pages-print">${pagesHTML}</section>

      ${highlightsHTML ? `
        <section class="print-highlights no-break">
          <h2>🖊 Highlights (${(highlights || []).length})</h2>
          ${highlightsHTML}
        </section>
      ` : ""}

      ${occlusionsHTML ? `
        <section class="print-occlusions no-break">
          <h2>▮ Oclusiones (${(occlusions || []).length})</h2>
          ${occlusionsHTML}
        </section>
      ` : ""}
    </article>
  `;

  return html;
}

function printHtmlInIframe(html) {
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("tabindex", "-1");
  iframe.title = "print-frame";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  const parentLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((l) => l.outerHTML).join("");
  const parentStyles = Array.from(document.querySelectorAll("style"))
    .map((s) => s.outerHTML).join("");

  doc.open();
  doc.write(`<!doctype html><html><head>
    <meta charset="utf-8" />
    <title>Print</title>
    ${parentLinks}
    ${parentStyles}
  </head><body>${html}</body></html>`);
  doc.close();

  return new Promise((resolve) => {
    const trigger = () => {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        console.error("print failed", e);
      }
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 500);
    };
    if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
      setTimeout(trigger, 200);
    } else {
      iframe.addEventListener("load", () => setTimeout(trigger, 200), { once: true });
    }
  });
}

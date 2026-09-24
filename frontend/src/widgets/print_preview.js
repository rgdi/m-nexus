/* ============================================================
 * widgets/print_preview.js — Live print preview modal.
 *
 * v2.33.1 — En lugar de abrir el print dialog nativo directamente,
 * abre un modal con preview live de cómo quedará la nota/PDF.
 *
 * Controles:
 *   - Toggle "Media: print" para ver el aspecto impreso en pantalla.
 *   - Zoom in/out (50%-150%).
 *   - Selector de tamaño: A4 / Letter / A5.
 *   - Orientación: portrait / landscape.
 *   - Botones: 🖨 Imprimir / 📄 Descargar PDF / ✕ Cerrar.
 *
 * Implementación:
 *   - Iframe con el fragmento `.note-print` / `.pdf-print`.
 *   - Aplica el print.css (mismo que ya existe).
 *   - Para "media print" en pantalla, el iframe recibe un `@media print`
 *     emulado via toggle CSS class.
 *   - Para zoom, transform: scale() sobre el contenido.
 *
 * Output:
 *   - Botón Imprimir → window.print() del iframe.
 *   - Botón Descargar PDF → llama downloadNoteAsPDF() (existente)
 *     o downloadPrintAsPDF() (nuevo wrapper que captura el iframe).
 * ============================================================ */

import { makeModal } from "./modal.js";

const HTML_ESCAPES = {
  "&": String.fromCharCode(38) + "amp;",
  "<": String.fromCharCode(38) + "lt;",
  ">": String.fromCharCode(38) + "gt;",
  '"': String.fromCharCode(38) + "quot;",
  "'": String.fromCharCode(38) + "#39;",
};

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * openPrintPreview({ html, title, note, onAfterRender })
 *
 * @param html    string — the print-document HTML (already includes
 *                       .note-print or .pdf-print wrapper).
 * @param title   string — used in modal header + iframe title.
 * @param note    object — the source note (used by PDF download).
 * @param opts.kind "note" | "pdf"
 * @param opts.onDownload callback() — called when user clicks PDF.
 */
export async function openPrintPreview({ html, title, note, kind = "note", opts = {} }) {
  // Build modal
  const modal = makeModal({
    title: "🖨 Preview — " + (title || "Document"),
    size: "xl",
    body: `
      <div class="print-preview">
        <div class="print-preview-toolbar" role="toolbar" aria-label="Controles de preview">
          <div class="print-preview-controls">
            <label class="print-preview-control">
              <span>Tamaño</span>
              <select class="print-preview-size" data-pp-size>
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="A5">A5</option>
              </select>
            </label>
            <label class="print-preview-control">
              <span>Orient.</span>
              <select class="print-preview-orient" data-pp-orient>
                <option value="portrait">Vertical</option>
                <option value="landscape">Horizontal</option>
              </select>
            </label>
            <label class="print-preview-control">
              <span>Zoom</span>
              <input type="range" min="50" max="150" step="10" value="100" data-pp-zoom />
              <span class="print-preview-zoom-label" data-pp-zoom-label>100%</span>
            </label>
            <label class="print-preview-control print-preview-toggle">
              <input type="checkbox" data-pp-print-media />
              <span>Ver como impreso</span>
            </label>
          </div>
          <div class="print-preview-actions">
            <button class="btn btn-secondary" type="button" data-pp-cancel>✕ Cerrar</button>
            <button class="btn btn-secondary" type="button" data-pp-download-pdf>📄 PDF</button>
            <button class="btn btn-primary" type="button" data-pp-print>🖨 Imprimir</button>
          </div>
        </div>

        <div class="print-preview-stage" data-pp-stage>
          <div class="print-preview-page" data-pp-page>
            <iframe class="print-preview-iframe" data-pp-iframe title="Print preview" tabindex="0" src="about:blank"></iframe>
          </div>
        </div>

        <div class="print-preview-status" data-pp-status aria-live="polite">
          Vista previa: ${kind === "pdf" ? "PDF" : "Nota"} · ${title || "Document"}
        </div>
      </div>
    `,
    actions: [],
  });

  // Wire controls — makeModal returns { root, scrim, close }.
  // The body lives inside `.modal-body` of `root`.
  const modalBody = modal.root.querySelector(".modal-body");
  const iframe = modalBody.querySelector("[data-pp-iframe]");
  const stage = modalBody.querySelector("[data-pp-stage]");
  const pageEl = modalBody.querySelector("[data-pp-page]");
  const statusEl = modalBody.querySelector("[data-pp-status]");
  const sizeSelect = modalBody.querySelector("[data-pp-size]");
  const orientSelect = modalBody.querySelector("[data-pp-orient]");
  const zoomInput = modalBody.querySelector("[data-pp-zoom]");
  const zoomLabel = modalBody.querySelector("[data-pp-zoom-label]");
  const printMediaToggle = modalBody.querySelector("[data-pp-print-media]");

  function applySize() {
    const size = sizeSelect.value;
    const dims = {
      A4:     { w: 210, h: 297 }, // mm
      Letter: { w: 216, h: 279 },
      A5:     { w: 148, h: 210 },
    }[size] || { w: 210, h: 297 };
    const orient = orientSelect.value;
    pageEl.style.setProperty("--page-w", dims.w + "mm");
    pageEl.style.setProperty("--page-h", dims.h + "mm");
    if (orient === "landscape") {
      pageEl.style.setProperty("--page-w", dims.h + "mm");
      pageEl.style.setProperty("--page-h", dims.w + "mm");
    }
  }

  function applyZoom() {
    const z = parseInt(zoomInput.value, 10) || 100;
    zoomLabel.textContent = z + "%";
    iframe.style.transform = "scale(" + (z / 100) + ")";
    iframe.style.transformOrigin = "top left";
    iframe.style.width = (10000 / z) + "%";
    iframe.style.height = (10000 / z) + "%";
  }

  function applyPrintMedia() {
    if (printMediaToggle.checked) {
      stage.classList.add("print-preview--print-media");
      try { iframe.contentWindow.__emulatePrint(true); } catch (e) {}
      statusEl.textContent = "Vista previa: " + (kind === "pdf" ? "PDF" : "Nota") + " · modo impresión activado";
    } else {
      stage.classList.remove("print-preview--print-media");
      try { iframe.contentWindow.__emulatePrint(false); } catch (e) {}
      statusEl.textContent = "Vista previa: " + (kind === "pdf" ? "PDF" : "Nota") + " · modo pantalla";
    }
  }

  function loadContent() {
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const parentLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((l) => l.outerHTML).join("");
    const parentStyles = Array.from(document.querySelectorAll("style"))
      .map((s) => s.outerHTML).join("");

    const bridgeScript = `
      <script>
        (function () {
          window.__emulatePrint = function (on) {
            document.body.classList.toggle('print-emulated', !!on);
          };
        })();
      </script>
    `;

    const extraCSS = `
      <style>
        body.print-emulated {
          background: var(--print-paper, #fafaf6) !important;
          color: var(--print-ink, #1a1a1a) !important;
          font-family: "Charter", "Iowan Old Style", "Source Serif Pro",
                       "Cambria", "Georgia", serif !important;
        }
        body.print-emulated .note-print,
        body.print-emulated .pdf-print {
          display: block !important;
          background: var(--print-paper, #fafaf6) !important;
        }
      </style>
    `;

    doc.open();
    doc.write('<!doctype html><html><head>'
      + '<meta charset="utf-8" />'
      + '<title>Print Preview — ' + escapeHtml(title || "") + '</title>'
      + parentLinks + parentStyles + extraCSS
      + '</head><body>' + html + bridgeScript + '</body></html>');
    doc.close();
    applyZoom();
  }

  // Mount the modal in the DOM (makeModal does NOT auto-append).
  document.body.appendChild(modal.root);

  // Initial — wait for iframe to be ready before loading content.
  applySize();
  // about:blank loads synchronously, but give it a tick to settle.
  await new Promise((r) => setTimeout(r, 80));
  loadContent();

  // Events
  sizeSelect.addEventListener("change", applySize);
  orientSelect.addEventListener("change", applySize);
  zoomInput.addEventListener("input", applyZoom);
  printMediaToggle.addEventListener("change", applyPrintMedia);

  // Close
  modalBody.querySelector("[data-pp-cancel]").addEventListener("click", () => modal.close());

  // Print
  modalBody.querySelector("[data-pp-print]").addEventListener("click", () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      statusEl.textContent = "🖨 Enviado a impresora";
    } catch (e) {
      console.error("print failed", e);
      statusEl.textContent = "❌ Print failed: " + e.message;
    }
  });

  // Download PDF
  modalBody.querySelector("[data-pp-download-pdf]").addEventListener("click", async () => {
    statusEl.textContent = "📄 Generando PDF...";
    try {
      if (kind === "note" && note) {
        const { downloadNoteAsPDF } = await import("./pdf_export.js");
        await downloadNoteAsPDF(note, { usePrintCSS: true });
        statusEl.textContent = "✅ PDF descargado";
      } else if (opts.onDownload) {
        await opts.onDownload(iframe);
        statusEl.textContent = "✅ PDF descargado";
      } else {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        statusEl.textContent = "🖨 Usar 'Guardar como PDF' en el diálogo";
      }
    } catch (e) {
      console.error("PDF failed", e);
      statusEl.textContent = "❌ PDF failed: " + e.message;
    }
  });

  // Keyboard: Esc closes, Ctrl+P prints
  modalBody.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal.close();
    if ((e.ctrlKey || e.metaKey) && e.key === "p") {
      e.preventDefault();
      modalBody.querySelector("[data-pp-print]").click();
    }
  });

  return modal;
}

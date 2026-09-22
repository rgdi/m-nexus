/* screens/pdf.js — Screen for PDF library + open viewer.

   v2.28.0 — list of PDF documents that have at least one highlight,
   upload via dialog (file picker), opens the PDF viewer modal.
*/

import { openPdfViewer } from "../widgets/pdf_viewer.js";

export async function renderPdfScreen(host) {
  host.innerHTML = `
    <section class="screen pdf-screen">
      <header class="screen-header">
        <h1>📄 PDF Library</h1>
        <p class="screen-subtitle">Documentos con highlights atómicos convertibles a flashcards.</p>
      </header>

      <div class="pdf-library-actions">
        <button class="primary" data-action="open-local" type="button">
          Abrir PDF local
        </button>
        <button data-action="refresh" type="button">
          ↻ Refrescar
        </button>
      </div>

      <div class="pdf-library-list" data-list role="region" aria-label="Lista de PDFs con highlights">
        <p class="pdf-loading">Cargando…</p>
      </div>
    </section>
  `;

  const list = host.querySelector("[data-list]");

  async function refresh() {
    list.innerHTML = `<p class="pdf-loading">Cargando…</p>`;
    try {
      const r = await fetch("/api/v1/pdf/pdfs");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      renderList(data.documents || []);
    } catch (e) {
      list.innerHTML = `<p class="pdf-error">Error: ${escapeHtml(String(e))}</p>`;
    }
  }

  function renderList(docs) {
    if (docs.length === 0) {
      list.innerHTML = `
        <div class="pdf-empty-state">
          <p>Ningún PDF con highlights todavía.</p>
          <ol>
            <li>Abre un PDF con el botón "Abrir PDF local"</li>
            <li>Selecciona texto — aparecerá el botón flotante "✨ Crear flashcard"</li>
            <li>Opcional: haz click en "Convertir todas a cards" para procesar en lote</li>
          </ol>
        </div>`;
      return;
    }
    list.innerHTML = docs
      .map(
        (d) => `
        <article class="pdf-doc-card" data-doc-path="${escapeAttr(d.docPath)}">
          <h3>${escapeHtml(d.docPath)}</h3>
          <p class="pdf-doc-stats">
            <span>${d.count} highlight${d.count === 1 ? "" : "s"}</span>
            <span>·</span>
            <span>${d.withCard} convertidas</span>
            <span>·</span>
            <span>Última actividad ${formatDate(d.lastHighlight)}</span>
          </p>
          <div class="pdf-doc-actions">
            <button data-action="open" type="button">📖 Abrir visor</button>
          </div>
        </article>
      `,
      )
      .join("");
    list.querySelectorAll(".pdf-doc-card").forEach((card) => {
      const path = card.dataset.docPath;
      card.querySelector('[data-action="open"]').addEventListener("click", () => {
        // Open with object URL if same-origin, else just view the URL.
        openPdfViewer({ pdfUrl: `/uploads/${encodeURIComponent(path)}`, title: path });
      });
    });
  }

  host.querySelector('[data-action="refresh"]').addEventListener("click", refresh);
  host.querySelector('[data-action="open-local"]').addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      openPdfViewer({ pdfUrl: url, title: file.name });
      refresh();
    });
    input.click();
  });

  await refresh();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
function escapeAttr(s) { return escapeHtml(s); }
function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString();
}

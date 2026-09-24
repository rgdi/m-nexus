/* ============================================================
 * widgets/print_config_modal.js — Configure print/PDF headers per note.
 *
 * v2.33.1 — Modal that lets the user override:
 *   - customAuthor (default: blank — uses vault author)
 *   - customFooter (free-form text in page footer)
 *   - customSubject (overrides note.subject in header)
 *   - pageSize: A4 / Letter / A5
 *   - orientation: portrait / landscape
 *   - showHeader, showFooter, showFlashcards, showHighlights
 *   - watermark, watermarkOpacity
 *   - pageNumbering: arabic / roman / none
 *
 * Persists to backend via PATCH /notes/:id/print-config.
 * ============================================================ */

import { makeModal } from "./modal.js";

const ESC = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({
  "&": String.fromCharCode(38) + "amp;",
  "<": String.fromCharCode(38) + "lt;",
  ">": String.fromCharCode(38) + "gt;",
  '"': String.fromCharCode(38) + "quot;",
  "'": String.fromCharCode(38) + "#39;",
}[c]));

/**
 * openPrintConfigModal({ noteId, currentConfig, onSaved })
 *
 * @param noteId          string
 * @param currentConfig   object  resolved PrintConfig (with defaults)
 * @param onSaved         fn(updatedNote)
 */
export async function openPrintConfigModal({ noteId, currentConfig, onSaved }) {
  const cfg = { ...currentConfig };

  const modal = makeModal({
    title: "📐 Configurar impresión / PDF",
    size: "lg",
    body: `
      <form class="print-config-form" data-pcf>
        <div class="print-config-grid">
          <fieldset>
            <legend>Encabezado</legend>
            <label class="print-config-row">
              <span>Mostrar encabezado</span>
              <input type="checkbox" name="showHeader" ${cfg.showHeader ? "checked" : ""} />
            </label>
            <label class="print-config-row">
              <span>Autor personalizado</span>
              <input type="text" name="customAuthor" value="${ESC(cfg.customAuthor || "")}" placeholder="${ESC(cfg.watermark || "M-NEXUS")}" />
            </label>
            <label class="print-config-row">
              <span>Asignatura personalizada</span>
              <input type="text" name="customSubject" value="${ESC(cfg.customSubject || "")}" placeholder="(usa la asignatura de la nota)" />
            </label>
          </fieldset>

          <fieldset>
            <legend>Footer</legend>
            <label class="print-config-row">
              <span>Mostrar footer</span>
              <input type="checkbox" name="showFooter" ${cfg.showFooter ? "checked" : ""} />
            </label>
            <label class="print-config-row">
              <span>Texto del footer</span>
              <input type="text" name="customFooter" value="${ESC(cfg.customFooter || "")}" placeholder="Ej: Universidad · 2026 · página X de Y" />
            </label>
            <label class="print-config-row">
              <span>Numeración de página</span>
              <select name="pageNumbering">
                <option value="arabic" ${cfg.pageNumbering === "arabic" ? "selected" : ""}>1, 2, 3 (arábigo)</option>
                <option value="roman"  ${cfg.pageNumbering === "roman"  ? "selected" : ""}>I, II, III (romano)</option>
                <option value="none"   ${cfg.pageNumbering === "none"   ? "selected" : ""}>Sin numeración</option>
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Página</legend>
            <label class="print-config-row">
              <span>Tamaño</span>
              <select name="pageSize">
                <option value="A4"     ${cfg.pageSize === "A4"     ? "selected" : ""}>A4 (210 × 297 mm)</option>
                <option value="Letter" ${cfg.pageSize === "Letter" ? "selected" : ""}>Letter (216 × 279 mm)</option>
                <option value="A5"     ${cfg.pageSize === "A5"     ? "selected" : ""}>A5 (148 × 210 mm)</option>
              </select>
            </label>
            <label class="print-config-row">
              <span>Orientación</span>
              <select name="orientation">
                <option value="portrait"  ${cfg.orientation === "portrait"  ? "selected" : ""}>Vertical</option>
                <option value="landscape" ${cfg.orientation === "landscape" ? "selected" : ""}>Horizontal</option>
              </select>
            </label>
          </fieldset>

          <fieldset>
            <legend>Contenido</legend>
            <label class="print-config-row">
              <span>Incluir flashcards</span>
              <input type="checkbox" name="showFlashcards" ${cfg.showFlashcards ? "checked" : ""} />
            </label>
            <label class="print-config-row">
              <span>Incluir highlights (PDFs)</span>
              <input type="checkbox" name="showHighlights" ${cfg.showHighlights ? "checked" : ""} />
            </label>
          </fieldset>

          <fieldset>
            <legend>Marca de agua</legend>
            <label class="print-config-row">
              <span>Texto</span>
              <input type="text" name="watermark" value="${ESC(cfg.watermark || "")}" placeholder="M-NEXUS" />
            </label>
            <label class="print-config-row">
              <span>Opacidad (0–1)</span>
              <input type="number" name="watermarkOpacity" min="0" max="1" step="0.005" value="${cfg.watermarkOpacity ?? 0.025}" />
            </label>
          </fieldset>
        </div>

        <div class="print-config-actions">
          <button type="button" class="btn btn-secondary" data-pcf-cancel>✕ Cancelar</button>
          <button type="submit" class="btn btn-primary">💾 Guardar</button>
        </div>
      </form>
    `,
    actions: [],
  });

  // Mount in DOM (makeModal does NOT auto-append).
  document.body.appendChild(modal.root);

  const form = modal.root.querySelector(".modal-body").querySelector("[data-pcf]");
  const submit = modal.root.querySelector(".modal-body").querySelector("[type=submit]");
  const cancel = modal.root.querySelector(".modal-body").querySelector("[data-pcf-cancel]");

  cancel.addEventListener("click", () => modal.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = {
      customAuthor: fd.get("customAuthor") || undefined,
      customSubject: fd.get("customSubject") || undefined,
      customFooter: fd.get("customFooter") || undefined,
      pageSize: fd.get("pageSize"),
      orientation: fd.get("orientation"),
      pageNumbering: fd.get("pageNumbering"),
      watermark: fd.get("watermark") || undefined,
      watermarkOpacity: parseFloat(String(fd.get("watermarkOpacity") || "0.025")),
      showHeader: !!fd.get("showHeader"),
      showFooter: !!fd.get("showFooter"),
      showFlashcards: !!fd.get("showFlashcards"),
      showHighlights: !!fd.get("showHighlights"),
    };
    // Strip undefined values so the backend uses defaults
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    submit.disabled = true;
    submit.textContent = "💾 Guardando...";
    try {
      const { api } = await import("../services/api.js");
      const updated = await api.patch(`/notes/${noteId}/print-config`, patch);
      if (onSaved) onSaved(updated);
      modal.close();
    } catch (err) {
      submit.disabled = false;
      submit.textContent = "💾 Guardar";
      // eslint-disable-next-line no-alert
      alert(`❌ No se pudo guardar: ${err.message}`);
    }
  });

  return modal;
}

/* ============================================================
 * widgets/flashcard_popup.js — Floating flashcard creator popup.
 *
 * v2.34.0 — Opens in a floating window (NOT inline in the note body).
 * Triggered by /f slash command or the flashcard toolbar button.
 * ============================================================ */

import { openFloatingWindow } from "./floating_window.js";
import { api } from "../services/api.js";

const escHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({
  "&": String.fromCharCode(38) + "amp;",
  "<": String.fromCharCode(38) + "lt;",
  ">": String.fromCharCode(38) + "gt;",
  '"': String.fromCharCode(38) + "quot;",
  "'": String.fromCharCode(38) + "#39;",
}[c]));

/**
 * openFlashcardPopup({ noteId, defaultFront, defaultBack, onCreated })
 */
export function openFlashcardPopup(opts = {}) {
  const noteId = opts.noteId;
  const fwId = "flashcard-popup-" + (noteId || "global");

  const body = document.createElement("div");
  body.className = "flashcard-popup-body";
  body.innerHTML = `
    <div class="flashcard-popup-fields">
      <label class="flashcard-popup-row">
        <span>Pregunta (front)</span>
        <textarea class="fc-front" placeholder="¿Cuál es la presión aórtica normal en sístole?" rows="3">${escHtml(opts.defaultFront || "")}</textarea>
      </label>
      <label class="flashcard-popup-row">
        <span>Respuesta (back)</span>
        <textarea class="fc-back" placeholder="~120 mmHg (rango 100-140)" rows="3">${escHtml(opts.defaultBack || "")}</textarea>
      </label>
      <label class="flashcard-popup-row flashcard-popup-meta">
        <span>Asignatura</span>
        <input type="text" class="fc-subject" placeholder="(opcional)" />
      </label>
      <label class="flashcard-popup-row flashcard-popup-meta">
        <span>Tags (separados por coma)</span>
        <input type="text" class="fc-tags" placeholder="cardiología, sístole" />
      </label>
    </div>
    <div class="flashcard-popup-hint">
      💡 Esta flashcard se guarda en el FSRS scheduler pero NO se inyecta en el
      cuerpo de la nota. Cierra este popup cuando termines.
    </div>
    <div class="flashcard-popup-actions">
      <button type="button" class="flashcard-popup-btn flashcard-popup-btn--secondary" data-fc-action="cancel">Cancelar</button>
      <button type="button" class="flashcard-popup-btn flashcard-popup-btn--primary" data-fc-action="save">💾 Guardar flashcard</button>
    </div>
    <div class="flashcard-popup-status" data-fc-status aria-live="polite"></div>
  `;

  const win = openFloatingWindow({
    id: fwId,
    title: "🎴 Crear flashcard",
    icon: "🎴",
    body,
    width: 520,
    height: 460,
    onClose: () => {},
  });

  const statusEl = body.querySelector("[data-fc-status]");

  body.querySelector('[data-fc-action="cancel"]').addEventListener("click", () => win.close());
  body.querySelector('[data-fc-action="save"]').addEventListener("click", async () => {
    const front = body.querySelector(".fc-front").value.trim();
    const back = body.querySelector(".fc-back").value.trim();
    const subject = body.querySelector(".fc-subject").value.trim();
    const tags = body.querySelector(".fc-tags").value
      .split(",").map((t) => t.trim()).filter(Boolean);

    if (!front || !back) {
      statusEl.textContent = "❌ Pregunta y respuesta son requeridas";
      return;
    }

    statusEl.textContent = "💾 Guardando...";
    try {
      const card = await api.post("/flashcards", {
        front, back, subject, tags,
        sourceNoteId: noteId || null,
      });
      statusEl.textContent = "✅ Flashcard guardada · FSRS due " + new Date(card.due || Date.now()).toLocaleDateString();
      if (opts.onCreated) opts.onCreated(card);
      setTimeout(() => win.close(), 1500);
    } catch (e) {
      statusEl.textContent = "❌ " + e.message;
    }
  });

  // Focus first field
  setTimeout(() => body.querySelector(".fc-front")?.focus(), 100);

  return win;
}

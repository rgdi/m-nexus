/* ============================================================
 * widgets/occlusion_popup.js — Floating image occlusion popup.
 *
 * v2.34.0 — Opens in a floating window (NOT inline in the note body).
 * Triggered by /occlusion slash command or the occlusion toolbar button.
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
 * openOcclusionPopup({ noteId, defaultRegion, onCreated })
 */
export function openOcclusionPopup(opts = {}) {
  const noteId = opts.noteId;
  const fwId = "occlusion-popup-" + (noteId || "global");

  const body = document.createElement("div");
  body.className = "occlusion-popup-body";
  body.innerHTML = `
    <div class="occlusion-popup-fields">
      <label class="occlusion-popup-row">
        <span>Región (qué se oculta)</span>
        <textarea class="oc-region" placeholder="Ej: el núcleo / la fórmula del teorema de Pitágoras / el nombre del hueso" rows="2">${escHtml(opts.defaultRegion || "")}</textarea>
      </label>
      <label class="occlusion-popup-row">
        <span>Respuesta (lo que aparece al revelar)</span>
        <textarea class="oc-answer" placeholder="Lo que el estudiante debe recordar al revelar la oclusión" rows="3">${escHtml(opts.defaultAnswer || "")}</textarea>
      </label>
      <label class="occlusion-popup-row">
        <span>Tipo</span>
        <select class="oc-type">
          <option value="text">Texto</option>
          <option value="image">Imagen (subir abajo)</option>
          <option value="diagram">Diagrama (selección libre)</option>
        </select>
      </label>
      <label class="occlusion-popup-row" data-oc-image-row hidden>
        <span>Imagen (opcional)</span>
        <input type="file" class="oc-image" accept="image/*" />
      </label>
    </div>
    <div class="occlusion-popup-hint">
      💡 Las oclusiones se almacenan por separado y aparecen como flashcard
      inversa: la región está oculta y se revela al pedir "Mostrar respuesta".
      No se inyectan en el texto de la nota.
    </div>
    <div class="occlusion-popup-actions">
      <button type="button" class="occlusion-popup-btn occlusion-popup-btn--secondary" data-oc-action="cancel">Cancelar</button>
      <button type="button" class="occlusion-popup-btn occlusion-popup-btn--primary" data-oc-action="save">▮ Guardar oclusión</button>
    </div>
    <div class="occlusion-popup-status" data-oc-status aria-live="polite"></div>
  `;

  const win = openFloatingWindow({
    id: fwId,
    title: "▮ Crear oclusión",
    icon: "▮",
    body,
    width: 520,
    height: 440,
  });

  const statusEl = body.querySelector("[data-oc-status]");
  const typeSel = body.querySelector(".oc-type");
  const imageRow = body.querySelector("[data-oc-image-row]");

  typeSel.addEventListener("change", () => {
    imageRow.hidden = typeSel.value !== "image";
  });

  body.querySelector('[data-oc-action="cancel"]').addEventListener("click", () => win.close());
  body.querySelector('[data-oc-action="save"]').addEventListener("click", async () => {
    const region = body.querySelector(".oc-region").value.trim();
    const answer = body.querySelector(".oc-answer").value.trim();
    const type = body.querySelector(".oc-type").value;

    if (!region || !answer) {
      statusEl.textContent = "❌ Región y respuesta son requeridas";
      return;
    }

    statusEl.textContent = "▮ Guardando...";
    try {
      const payload = { region, answer, type, noteId: noteId || null };
      const fileInput = body.querySelector(".oc-image");
      if (type === "image" && fileInput.files.length) {
        payload.imageBase64 = await fileToBase64(fileInput.files[0]);
      }
      const oc = await api.post("/occlusions", payload);
      statusEl.textContent = "✅ Oclusión guardada · FSRS due " + new Date(oc.due || Date.now()).toLocaleDateString();
      if (opts.onCreated) opts.onCreated(oc);
      setTimeout(() => win.close(), 1500);
    } catch (e) {
      statusEl.textContent = "❌ " + e.message;
    }
  });

  setTimeout(() => body.querySelector(".oc-region")?.focus(), 100);
  return win;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

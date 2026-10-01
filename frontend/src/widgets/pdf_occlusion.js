/* ============================================================
 * widgets/pdf_occlusion.js — Overlay para dibujar oclusiones sobre páginas PDF.
 *
 * v2.29.0 — Image Occlusion v2.
 *
 * Diseño: cada página del PDF renderiza un canvas + un overlay
 * (position:absolute) que captura los eventos de mouse para dibujar
 * cajas rectangulares. Las coordenadas se guardan normalizadas (0..1)
 * para resistir cambios de zoom.
 *
 * UX:
 *   - Drag-to-create: mousedown→mousemove→mouseup crea una caja
 *   - Click en caja existente: muestra menú (mover/redimensionar/borrar/label)
 *   - Tecla "L" → toggle modo label
 *   - Tecla "Esc" → cancela el rect actual
 *
 * Stack: vanilla DOM, sin dependencias.
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const API = `${detectApiBase()}/api/v1/pdf/occlusions`;

let dragState = null; // { startX, startY, currentEl, page, pageEl }

/**
 * Attach occlusion drawing behavior to the .pdf-pages element inside the
 * pdf viewer modal. Idempotent (safe to call multiple times).
 *
 * @param {HTMLElement} pagesHost  The container of all .pdf-page wrappers
 * @param {(ocl: any) => void} onChange  Callback when occlusions change
 * @param {() => string} getDocumentPath  Getter for the current documentPath
 */
export function attachOcclusionMode(pagesHost, onChange, getDocumentPath) {
  if (pagesHost.dataset.occlusionBound === "1") return;
  pagesHost.dataset.occlusionBound = "1";

  pagesHost.addEventListener("mousedown", (e) => {
    if (!pagesHost.classList.contains("pdf-mode--occlusion")) return;
    const pageEl = e.target.closest(".pdf-page");
    if (!pageEl) return;
    if (e.target.closest(".pdf-oclusion-rect")) return; // clicked existing rect
    const rect = pageEl.getBoundingClientRect();
    dragState = {
      page: parseInt(pageEl.dataset.page, 10),
      pageEl,
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      currentEl: null,
    };
    e.preventDefault();
  });

  pagesHost.addEventListener("mousemove", (e) => {
    if (!dragState) return;
    const rect = dragState.pageEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    if (!dragState.currentEl) {
      const el = document.createElement("div");
      el.className = "pdf-oclusion-rect pdf-oclusion-rect--draft";
      el.style.left = `${Math.min(dragState.startX, x) * 100}%`;
      el.style.top = `${Math.min(dragState.startY, y) * 100}%`;
      el.style.width = `${Math.abs(x - dragState.startX) * 100}%`;
      el.style.height = `${Math.abs(y - dragState.startY) * 100}%`;
      dragState.pageEl.appendChild(el);
      dragState.currentEl = el;
    } else {
      dragState.currentEl.style.left = `${Math.min(dragState.startX, x) * 100}%`;
      dragState.currentEl.style.top = `${Math.min(dragState.startY, y) * 100}%`;
      dragState.currentEl.style.width = `${Math.abs(x - dragState.startX) * 100}%`;
      dragState.currentEl.style.height = `${Math.abs(y - dragState.startY) * 100}%`;
    }
  });

  pagesHost.addEventListener("mouseup", async (e) => {
    if (!dragState) return;
    const x = parseFloat(dragState.currentEl?.style.left ?? "0") / 100;
    const y = parseFloat(dragState.currentEl?.style.top ?? "0") / 100;
    const w = parseFloat(dragState.currentEl?.style.width ?? "0") / 100;
    const h = parseFloat(dragState.currentEl?.style.height ?? "0") / 100;
    dragState.currentEl?.remove();
    dragState = null;
    if (w < 0.01 || h < 0.01) return;

    // Ask user for label
    const label = prompt("Etiqueta de la zona (lo que se revelará al estudiar):", "");
    if (label === null) return; // cancel

    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentPath: getDocumentPath(),
          page: parseInt(e.target.closest(".pdf-page").dataset.page, 10),
          x, y, w, h,
          label: label || undefined,
          color: "#1a1a1a",
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ocl = await r.json();
      onChange(ocl);
      showToast(`✅ Oclusión creada (${Math.round(w * 100)}% × ${Math.round(h * 100)}%)`);
    } catch (err) {
      showToast(`❌ Error: ${err.message}`, true);
    }
  });

  // Escape cancela el drag en curso
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dragState) {
      dragState.currentEl?.remove();
      dragState = null;
    }
  });
}

/**
 * Render existing occlusions on top of the PDF pages.
 */
export async function renderOcclusions(pagesHost, documentPath, occlusions) {
  // Clear existing rendered occlusions
  pagesHost.querySelectorAll(".pdf-oclusion-rect[data-persisted='1']").forEach((n) => n.remove());

  // v2.38.15 — esto no puede tumbar el PDF.
  //
  // La cadena de fetch estaba suelta: sin try/catch, y sin mirar si la
  // respuesta traia siquiera la lista. Con el backend caido salia
  // "Failed to fetch" y el visor se quedaba en cero paginas — no se
  // abria el PDF que el usuario ya tenia en la mano. Y con un 401 la
  // respuesta no trae `occlusions`, asi que el bucle hacia
  // `undefined is not iterable`.
  //
  // Fallar al pedir oclusiones significa "no hay oclusiones", no "no hay
  // documento". Son cosas distintas.
  let ocs = occlusions;
  if (!Array.isArray(ocs)) {
    try {
      const r = await fetch(`${API}?documentPath=${encodeURIComponent(documentPath)}`);
      const d = r.ok ? await r.json() : null;
      ocs = Array.isArray(d?.occlusions) ? d.occlusions : [];
    } catch {
      ocs = [];   // sin servidor: el PDF se lee igual, sin oclusiones
    }
  }
  for (const ocl of ocs) {
    const pageEl = pagesHost.querySelector(`[data-page="${ocl.page}"]`);
    if (!pageEl) continue;
    const el = document.createElement("div");
    el.className = `pdf-oclusion-rect pdf-oclusion-rect--${ocl.state}`;
    el.dataset.persisted = "1";
    el.dataset.occlusionId = ocl.id;
    el.style.left = `${ocl.x * 100}%`;
    el.style.top = `${ocl.y * 100}%`;
    el.style.width = `${ocl.w * 100}%`;
    el.style.height = `${ocl.h * 100}%`;
    el.title = ocl.label ? `Label: ${ocl.label}` : "Sin label";
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `Oclusión en página ${ocl.page}${ocl.label ? `: ${ocl.label}` : ""}`);
    el.innerHTML = `<span class="pdf-oclusion-marker">${ocl.state === "card-created" ? "✅" : "▮"}</span>`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      showOcclusionMenu(ocl, pagesHost, documentPath);
    });
    pageEl.appendChild(el);
  }
}

function showOcclusionMenu(ocl, pagesHost, documentPath) {
  const modal = document.createElement("div");
  modal.className = "pdf-oclusion-menu";
  modal.setAttribute("role", "menu");
  modal.innerHTML = `
    <h4>Oclusión ${ocl.id.slice(0, 12)}…</h4>
    <p>Página ${ocl.page} · Estado: ${ocl.state}</p>
    ${ocl.label ? `<p><strong>Label:</strong> ${escapeHtml(ocl.label)}</p>` : ""}
    <div class="pdf-oclusion-menu-actions">
      <button data-action="card" type="button">✨ Crear flashcard</button>
      <button data-action="label" type="button">✏ Editar label</button>
      <button data-action="delete" type="button" class="danger">🗑 Eliminar</button>
      <button data-action="close" type="button">Cerrar</button>
    </div>
  `;
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.remove();
  });
  modal.querySelector('[data-action="close"]').addEventListener("click", () => modal.remove());
  modal.querySelector('[data-action="card"]').addEventListener("click", async () => {
    modal.remove();
    try {
      const r = await fetch(`${API}/${ocl.id}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferType: ocl.label ? "basic" : "image_occlusion" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const result = await r.json();
      showToast(result.persisted ? `✅ Card creada` : `↻ Ya existía`);
      // refresh
      await renderOcclusions(pagesHost, documentPath);
    } catch (err) {
      showToast(`❌ Error: ${err.message}`, true);
    }
  });
  modal.querySelector('[data-action="label"]').addEventListener("click", async () => {
    const next = prompt("Editar label:", ocl.label ?? "");
    if (next === null) return;
    modal.remove();
    try {
      await fetch(`${API}/${ocl.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentPath, label: next }),
      });
      await renderOcclusions(pagesHost, documentPath);
      showToast("✅ Label actualizado");
    } catch (err) {
      showToast(`❌ Error: ${err.message}`, true);
    }
  });
  modal.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    if (!confirm("¿Eliminar esta oclusión?")) return;
    modal.remove();
    try {
      await fetch(`${API}/${ocl.id}?documentPath=${encodeURIComponent(documentPath)}`, { method: "DELETE" });
      await renderOcclusions(pagesHost, documentPath);
      showToast("🗑 Oclusión eliminada");
    } catch (err) {
      showToast(`❌ Error: ${err.message}`, true);
    }
  });
  document.body.appendChild(modal);
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

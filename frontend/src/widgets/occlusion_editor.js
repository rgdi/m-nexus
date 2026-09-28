/* ============================================================
 * widgets/occlusion_editor.js — Touch-first image occlusion editor.
 *
 * v2.35.0 — "CREA NOTAS HERMOSAS / image occlusion" screen.
 *   - Shape toolbar: rect / square / circle / delete
 *   - Drag on the image to draw a mask
 *   - Tap a mask to select; drag to move; corner handle to resize
 *   - Mask list with per-mask answer fields
 *   - Reveal-all toggle (test mode)
 *   - Save → returns the mask array
 *
 * Data shape:
 *   masks: [{ id, shape:'rect'|'square'|'circle', x, y, w, h, answer }]
 *   Coordinates are 0..1 relative to the image box.
 * ============================================================ */

import { makeModal } from "./modal.js";

let uid = 0;
const nextId = () => `m${Date.now().toString(36)}${(uid++).toString(36)}`;

const SHAPES = [
  { key: "rect", label: "Rectángulo", icon: '<rect x="3" y="5" width="18" height="14" rx="2"/>' },
  { key: "square", label: "Cuadrado", icon: '<rect x="5" y="5" width="14" height="14" rx="2"/>' },
  { key: "circle", label: "Círculo", icon: '<circle cx="12" cy="12" r="8"/>' },
  { key: "erase", label: "Borrar", icon: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>' },
];

/**
 * openOcclusionEditor({ imageSrc, imageAlt, masks, onSave, onDelete })
 */
export async function openOcclusionEditor(opts = {}) {
  const imageSrc = opts.imageSrc;
  const imageAlt = opts.imageAlt || "Imagen";
  let masks = Array.isArray(opts.masks) ? structuredClone(opts.masks) : [];
  let tool = "rect";
  let selectedId = null;
  let revealed = false;

  const modal = makeModal({
    title: "Oclusión de imagen",
    size: "xl",
    className: "scrim m-sheet-scrim",
    body: `
      <div class="m-occ" data-occ>
        <div class="m-occ-tools" role="toolbar" aria-label="Herramientas de máscara">
          ${SHAPES.map((s, i) => `
            <button class="m-occ-tool${i === 0 ? " is-active" : ""}${s.key === "erase" ? " m-occ-tool--danger" : ""}"
                    data-occ-tool="${s.key}" aria-label="${s.label}" title="${s.label}">
              <svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg>
            </button>`).join("")}
          <span class="m-occ-count" data-occ-count>0 máscaras</span>
        </div>
        <div class="m-occ-stage" data-occ-stage>
          ${imageSrc ? `<img src="${imageSrc}" alt="${escapeAttr(imageAlt)}" draggable="false" />` : ""}
        </div>
        <div class="m-occ-hint" data-occ-hint>
          Arrastra sobre la imagen para dibujar una máscara. Toca una máscara para seleccionarla y arrastra para moverla.
        </div>
      </div>

      <div style="margin-top:14px">
        <div class="m-row m-row--between" style="margin-bottom:10px">
          <h4 class="m-chart-title">Respuestas</h4>
          <button class="m-btn m-btn--quiet" data-occ-reveal>👁 Revelar todo</button>
        </div>
        <div data-occ-list class="m-stack"></div>
      </div>
    `,
    actions: [
      { id: "cancel", label: "Cancelar", kind: "secondary", value: false },
      { id: "save", label: "Guardar", kind: "primary", value: true },
    ],
  });
  document.body.appendChild(modal.root);

  const stage = modal.root.querySelector("[data-occ-stage]");
  const listEl = modal.root.querySelector("[data-occ-list]");
  const countEl = modal.root.querySelector("[data-occ-count]");
  const revealBtn = modal.root.querySelector("[data-occ-reveal]");
  const toolsEl = modal.root.querySelector(".m-occ-tools");

  /* ---------- Tool selection ---------- */
  toolsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-occ-tool]");
    if (!b) return;
    tool = b.dataset.occTool;
    toolsEl.querySelectorAll("[data-occ-tool]").forEach((x) => x.classList.toggle("is-active", x === b));
    stage.style.cursor = tool === "erase" ? "not-allowed" : "crosshair";
  });

  /* ---------- Draw / select / move / resize ---------- */
  let mode = null; // "draw" | "move" | "resize"
  let startPt = null;
  let startBox = null;
  let activeMask = null;

  const rel = (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    return {
      x: clamp((clientX - r.left) / r.width, 0, 1),
      y: clamp((clientY - r.top) / r.height, 0, 1),
    };
  };

  stage.addEventListener("pointerdown", (e) => {
    if (!imageSrc) return;
    const pt = rel(e.clientX, e.clientY);
    startPt = pt;
    stage.setPointerCapture?.(e.pointerId);

    // Tap on an existing mask?
    const hit = e.target.closest(".m-occ-mask");
    if (hit && tool !== "erase") {
      activeMask = masks.find((m) => m.id === hit.dataset.mid);
      selectedId = activeMask?.id ?? null;
      if (activeMask) {
        mode = "move";
        startBox = { x: activeMask.x, y: activeMask.y };
        paintMasks();
        paintList();
        return;
      }
    }

    if (tool === "erase") {
      if (hit) {
        masks = masks.filter((m) => m.id !== hit.dataset.mid);
        selectedId = null;
        paintMasks();
        paintList();
      }
      return;
    }

    // Start drawing
    mode = "draw";
    const m = {
      id: nextId(),
      shape: tool,
      x: pt.x, y: pt.y, w: 0, h: 0,
      answer: "",
    };
    masks.push(m);
    activeMask = m;
    selectedId = m.id;
    paintMasks();
  });

  stage.addEventListener("pointermove", (e) => {
    if (!mode || !activeMask) return;
    const pt = rel(e.clientX, e.clientY);
    if (mode === "draw") {
      activeMask.x = Math.min(startPt.x, pt.x);
      activeMask.y = Math.min(startPt.y, pt.y);
      activeMask.w = Math.abs(pt.x - startPt.x);
      activeMask.h = Math.abs(pt.y - startPt.y);
    } else if (mode === "move") {
      activeMask.x = clamp(startBox.x + (pt.x - startPt.x), 0, 1 - activeMask.w);
      activeMask.y = clamp(startBox.y + (pt.y - startPt.y), 0, 1 - activeMask.h);
    }
    paintMasks();
  });

  const endPointer = () => {
    // Drop degenerate masks
    if (mode === "draw" && activeMask && (activeMask.w < 0.02 || activeMask.h < 0.02)) {
      masks = masks.filter((m) => m.id !== activeMask.id);
      selectedId = null;
    }
    // Enforce square aspect if tool === "square"
    if (tool === "square" && activeMask && activeMask.w > 0 && activeMask.h > 0) {
      const s = Math.max(activeMask.w, activeMask.h);
      if (activeMask.x + s > 1) activeMask.x = 1 - s;
      if (activeMask.y + s > 1) activeMask.y = 1 - s;
      activeMask.w = s;
      activeMask.h = s;
    }
    mode = null;
    activeMask = null;
    startPt = null;
    startBox = null;
    paintMasks();
    paintList();
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  /* ---------- Paint masks ---------- */
  function paintMasks() {
    stage.querySelectorAll(".m-occ-mask").forEach((n) => n.remove());
    countEl.textContent = `${masks.length} máscara${masks.length === 1 ? "" : "s"}`;
    for (const m of masks) {
      const d = document.createElement("div");
      d.className = "m-occ-mask" + (m.id === selectedId ? " is-sel" : "") + (revealed ? " is-revealed" : "");
      d.dataset.mid = m.id;
      d.dataset.shape = m.shape || "rect";
      d.style.left = `${m.x * 100}%`;
      d.style.top = `${m.y * 100}%`;
      d.style.width = `${m.w * 100}%`;
      d.style.height = `${m.h * 100}%`;
      d.innerHTML = `<span class="m-occ-mask-label">${revealed && m.answer ? escapeHtml(m.answer.slice(0, 24)) : (m.answer ? "?" : "")}</span>`;
      stage.appendChild(d);
    }
  }

  /* ---------- Answer list ---------- */
  function paintList() {
    listEl.innerHTML = "";
    if (masks.length === 0) {
      listEl.innerHTML = `<p class="m-muted" style="font-size:14px;margin:0">
        Aún no hay máscaras. Elige una herramienta y dibuja sobre la imagen.</p>`;
      return;
    }
    masks.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "m-card";
      row.style.padding = "12px 14px";
      row.style.marginBottom = "8px";
      if (m.id === selectedId) row.style.borderColor = "var(--m-accent)";
      row.innerHTML = `
        <div class="m-row" style="margin-bottom:8px">
          <span class="m-chip">${i + 1}</span>
          <span class="m-legend-val" style="margin:0">${Math.round(m.w * 100)}×${Math.round(m.h * 100)}%</span>
          <span class="m-spacer"></span>
          <button class="m-btn m-btn--quiet" data-del="${m.id}" style="min-height:34px;font-size:13px">🗑</button>
        </div>
        <input type="text" data-answer="${m.id}" value="${escapeAttr(m.answer || "")}"
          placeholder="Respuesta que se revela…" style="width:100%;min-height:44px;padding:0 12px;
          border-radius:12px;border:1px solid var(--m-hairline);background:var(--m-bg-sunken);
          color:var(--m-ink);font-family:var(--m-font);font-size:16px" />
      `;
      row.querySelector(`[data-answer="${m.id}"]`)?.addEventListener("input", (ev) => {
        m.answer = ev.target.value;
        if (revealed) paintMasks();
      });
      row.querySelector(`[data-del="${m.id}"]`)?.addEventListener("click", () => {
        masks = masks.filter((x) => x.id !== m.id);
        if (selectedId === m.id) selectedId = null;
        paintMasks();
        paintList();
      });
      row.addEventListener("click", () => { selectedId = m.id; paintMasks(); paintList(); });
      listEl.appendChild(row);
    });
  }

  /* ---------- Reveal toggle ---------- */
  revealBtn?.addEventListener("click", () => {
    revealed = !revealed;
    revealBtn.innerHTML = revealed ? "🙈 Ocultar todo" : "👁 Revelar todo";
    paintMasks();
  });

  paintMasks();
  paintList();

  // Return a promise so callers can await save/cancel.
  return new Promise((resolve) => {
    const onClose = (value) => {
      if (value && opts.onSave) opts.onSave(masks);
      if (!value && opts.onDelete) opts.onDelete();
      resolve(value ? masks : null);
    };
    modal.root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const idx = parseInt(btn.dataset.action, 10);
      const act = modal.root.querySelectorAll(".modal-foot button")[idx];
      if (act) onClose(act.dataset.value === "true" || act.textContent.trim() === "Guardar");
    });
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": String.fromCharCode(38) + "amp;",
    "<": String.fromCharCode(38) + "lt;",
    ">": String.fromCharCode(38) + "gt;",
    '"': String.fromCharCode(38) + "quot;",
    "'": String.fromCharCode(38) + "#39;",
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// image_occlusion.js — Image occlusion editor (v2.9.0).
//
// User uploads/picks an image, draws rectangular masks over regions,
// labels each mask, saves as occlusion card. Once approved (via /approvals),
// the card becomes a study item where each mask is hidden and the user
// must identify what is underneath.
//
// Workflow:
//   1. Mount editor on an image (URL or uploaded data URL)
//   2. User drags rectangles over an image to occlude specific parts
//   3. User types a label for each mask
//   4. On save → POST /api/v1/occlusion/card → returns card
//   5. Optionally → POST /api/v1/study/generation/add with kind="occlusion"
//      to enqueue for human approval
//   6. Approved occlusion cards render in study mode with masks hidden

import { api } from "../services/api.js";
import { escapeHtml } from "../services/safe.js";
import { i18n } from "../services/i18n.js";

const STYLE = `
.io-editor {
  position: relative;
  display: inline-block;
  user-select: none;
  cursor: crosshair;
  background: var(--bg-sunken);
  border-radius: 12px;
  overflow: hidden;
  max-width: 100%;
}
.io-editor img {
  display: block;
  max-width: 100%;
  height: auto;
  pointer-events: none;
}
.io-mask {
  position: absolute;
  background: rgba(239, 68, 68, 0.35);
  border: 2px solid #ef4444;
  border-radius: 4px;
  cursor: move;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 4px;
  font-size: 12px;
  color: white;
  font-weight: 600;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}
.io-mask .io-mask-label {
  background: rgba(239, 68, 68, 0.9);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.io-mask .io-mask-del {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #1f2937;
  color: white;
  border: 1px solid white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
}
.io-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px;
  background: var(--bg-elevated);
  border-radius: 8px;
  margin-bottom: 8px;
}
.io-canvas-wrap {
  display: inline-block;
  position: relative;
  border: 1px solid var(--border);
  border-radius: 8px;
}
.io-drawing {
  position: absolute;
  border: 2px dashed var(--accent);
  background: rgba(168, 85, 247, 0.15);
  pointer-events: none;
}
`;

let stylesMounted = false;
function ensureStyles() {
  if (stylesMounted) return;
  const s = document.createElement("style");
  s.textContent = STYLE;
  document.head.appendChild(s);
  stylesMounted = true;
}

export async function openImageOcclusionEditor({ imageUrl, imageBase64, topicId, sourceNoteId, onSave }) {
  ensureStyles();
  const overlay = document.createElement("div");
  overlay.className = "io-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:260;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);padding:20px;";

  const src = imageUrl || imageBase64;
  if (!src) {
    alert("Image required");
    return;
  }

  overlay.innerHTML = `
    <div class="io-card" style="background:var(--bg-elevated);border-radius:16px;padding:20px;max-width:90vw;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;">
      <header class="io-head">
        <h2 class="io-title">${i18n.t("occlusion.title") || "Image Occlusion"}</h2>
        <div class="io-actions">
          <button class="btn primary" id="io-save">${i18n.t("common.save") || "Save"}</button>
          <button class="btn" id="io-queue">${i18n.t("occlusion.saveAndQueue") || "Save + queue for approval"}</button>
          <button class="btn icon" id="io-close" aria-label="Close">✕</button>
        </div>
      </header>
      <div class="io-toolbar">
        <span class="muted">${i18n.t("occlusion.help") || "Drag to draw masks. Click a mask to edit. Press Delete key to remove."}</span>
      </div>
      <div class="io-canvas-wrap" id="io-canvas-wrap">
        <img id="io-img" src="${escapeHtml(src)}" alt="Imagen para oclusión" />
        <div id="io-overlay-masks" style="position:absolute;inset:0;"></div>
        <div id="io-drawing" class="io-drawing" style="display:none;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const wrap = overlay.querySelector("#io-canvas-wrap");
  const img = overlay.querySelector("#io-img");
  const masksLayer = overlay.querySelector("#io-overlay-masks");
  const drawing = overlay.querySelector("#io-drawing");

  let masks = []; // {x, y, w, h, label}
  let drawStart = null;
  let drawingActive = false;

  function nextMaskId() {
    return masks.length;
  }

  /**
   * v2.38.6 — el editor de etiqueta, en la barra. Reemplaza al prompt()
   * nativo: la máscara existe desde ya y se le pone nombre después.
   */
  function openLabelEditor(idx) {
    selected = idx;
    // El resel也需要 repintar: entrar por el botón de la barra tiene que
    // dejar la máscara con el mismo aspecto que si se hubiera tocado.
    renderMasks();
    const m = masks[idx];
    if (!m) return;
    const bar = overlay.querySelector(".io-toolbar");
    let box = overlay.querySelector(".io-label-editor");
    if (box) box.remove();
    box = document.createElement("div");
    box.className = "io-label-editor";
    const m2 = masks[idx];
    box.innerHTML = `
      <input class="input" type="text" value="${escapeHtml(m2.label || "")}"
             placeholder="${escapeHtml(i18n.t("occlusion.labelPlaceholder") || "¿Qué hay aquí?")}" />
      <button class="btn small" data-ok>${escapeHtml(i18n.t("common.confirm") || "Listo")}</button>
      <button class="btn small ghost" data-cancel>${escapeHtml(i18n.t("common.cancel") || "Cancelar")}</button>`;
    bar?.after(box);
    const input = box.querySelector("input");
    const commit = () => {
      m2.label = input.value.trim();
      renderMasks();
      box.remove();
    };
    box.querySelector("[data-ok]").addEventListener("click", commit);
    box.querySelector("[data-cancel]").addEventListener("click", () => box.remove());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") box.remove();
    });
    input.focus();
  }

  let selected = null;

  function renderMasks() {
    masksLayer.innerHTML = "";
    masks.forEach((m, idx) => {
      const el = document.createElement("div");
      el.className = "io-mask" + (selected === idx ? " is-selected" : "");
      el.tabIndex = 0;
      el.setAttribute("aria-selected", selected === idx ? "true" : "false");
      el.style.left = `${m.x * 100}%`;
      el.style.top = `${m.y * 100}%`;
      el.style.width = `${m.w * 100}%`;
      el.style.height = `${m.h * 100}%`;
      el.innerHTML = `
        <span class="io-mask-label">${escapeHtml(m.label || `Mask ${idx + 1}`)}</span>
        <span class="io-mask-del" data-idx="${idx}" title="Remove">✕</span>
      `;
      el.addEventListener("click", (e) => {
        const target = e.target;
        if (target instanceof HTMLElement && target.classList.contains("io-mask-del")) {
          const i = Number(target.dataset.idx);
          masks.splice(i, 1);
          renderMasks();
        } else {
          // v2.38.6: era un prompt() nativo — el segundo del widget.
          // Ahora seleccionar y renombrar van por la barra.
          selected = selected === idx ? null : idx;
          renderMasks();
          if (selected === idx) openLabelEditor(idx);
        }
        e.stopPropagation();
      });
      masksLayer.appendChild(el);
    });
  }

  // v2.38.6 — lo que dice la ayuda tiene que existir. Decía "Delete
  // para borrar" y la tecla no hacía nada: solo se podía borrar con el
  // ✕ de cada máscara, de 10px. Ahora hay selección con teclado.
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (selected === null) return;
    masks.splice(selected, 1);
    selected = null;
    renderMasks();
    e.preventDefault();
  });

  // v2.38.6 — coordenadas normalizadas 0..1, no píxeles.
  //
  // Con píxeles, girar el móvil o cambiar el ancho de la ventana
  // desplazaba todas las máscaras y dejaban de caer donde el usuario
  // las puso. Normalizado, la misma máscara sigue encima de lo mismo
  // que la de ayer. getMousePos devuelve ahora fracciones y quien dibuja
  // multiplica por el tamaño real solo al pintar.
  function getMousePos(e) {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  /** Pixels de dibujo: solo para el borrador, que se ve mientras se arrastra. */
  function toPx(n) {
    const r = wrap.getBoundingClientRect();
    return n * r.width;
  }
  function toPy(n) {
    const r = wrap.getBoundingClientRect();
    return n * r.height;
  }

  wrap.addEventListener("mousedown", (e) => {
    if (e.target !== wrap && !(e.target instanceof HTMLImageElement)) return;
    const p = getMousePos(e);
    drawStart = p;
    drawingActive = true;
    drawing.style.display = "block";
    drawing.style.left = `${toPx(p.x)}px`;
    drawing.style.top = `${toPy(p.y)}px`;
    drawing.style.width = "0px";
    drawing.style.height = "0px";
  });

  wrap.addEventListener("mousemove", (e) => {
    if (!drawingActive) return;
    const p = getMousePos(e);
    const x = Math.min(drawStart.x, p.x);
    const y = Math.min(drawStart.y, p.y);
    const w = Math.abs(p.x - drawStart.x);
    const h = Math.abs(p.y - drawStart.y);
    drawing.style.left = `${toPx(x)}px`;
    drawing.style.top = `${toPy(y)}px`;
    drawing.style.width = `${toPx(w)}px`;
    drawing.style.height = `${toPy(h)}px`;
  });

  wrap.addEventListener("mouseup", (e) => {
    if (!drawingActive) return;
    drawingActive = false;
    drawing.style.display = "none";
    const p = getMousePos(e);
    const x = Math.min(drawStart.x, p.x);
    const y = Math.min(drawStart.y, p.y);
    const w = Math.abs(p.x - drawStart.x);
    const h = Math.abs(p.y - drawStart.y);
    if (w * wrap.getBoundingClientRect().width < 8 || h * wrap.getBoundingClientRect().height < 8) {
      return; // too small
    }
    // v2.38.6: esto era un prompt() nativo. Bloquea la pagina entera,
    // trae sus propios botones en ingles y no se puede estilar. La
    // máscara se crea ya y se nombra en la barra, que es donde se
    // sigue trabajando.
    masks.push({ x, y, w, h, label: "" });
    renderMasks();
    openLabelEditor(masks.length - 1);
  });

  // Touch support
  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    wrap.dispatchEvent(new MouseEvent("mousedown", { clientX: t.clientX, clientY: t.clientY }));
  }, { passive: true });
  wrap.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    wrap.dispatchEvent(new MouseEvent("mousemove", { clientX: t.clientX, clientY: t.clientY }));
  }, { passive: true });
  wrap.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    wrap.dispatchEvent(new MouseEvent("mouseup", { clientX: t.clientX, clientY: t.clientY }));
  });

  img.addEventListener("load", () => {
    // Size masksLayer to image natural size
    masksLayer.style.width = `${img.clientWidth}px`;
    masksLayer.style.height = `${img.clientHeight}px`;
  });

  async function save(queue = false) {
    if (masks.length === 0) {
      alert(i18n.t("occlusion.noMasks") || "Draw at least one mask first");
      return;
    }
    const imgEl = overlay.querySelector("#io-img");
    const W = imgEl.clientWidth;
    const H = imgEl.clientHeight;
    const normMasks = masks.map((m, i) => ({
      id: i,
      x: Math.round((m.x / W) * 1000) / 1000,
      y: Math.round((m.y / H) * 1000) / 1000,
      width: Math.round((m.w / W) * 1000) / 1000,
      height: Math.round((m.h / H) * 1000) / 1000,
      label: m.label,
    }));

    try {
      const card = await api.occlusion.createCard({
        imageUrl: imageUrl || null,
        imageBase64: imageBase64 || null,
        topicId: topicId || "general",
        sourceNoteId,
        masks: normMasks,
      });

      if (queue) {
        await api.study.addCandidate({
          topicId: topicId || "general",
          sourceNoteId,
          kind: "occlusion",
          payload: { occlusionCardId: card.card.id, maskCount: normMasks.length },
          preview: `${normMasks.length} masked region${normMasks.length === 1 ? "" : "s"} on image`,
          answer: normMasks.map((m) => m.label).join(" · "),
          confidence: 0.85,
        });
      }

      if (onSave) onSave(card.card);
      close();
    } catch (e) {
      alert("Error: " + e.message);
    }
  }

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);

  overlay.querySelector("#io-save").addEventListener("click", () => save(false));
  overlay.querySelector("#io-queue").addEventListener("click", () => save(true));
  overlay.querySelector("#io-close").addEventListener("click", close);
}

/**
 * Open editor from a File input — converts to data URL.
 */
export async function openImageOcclusionFromFile(file, opts = {}) {
  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = async () => {
      try {
        await openImageOcclusionEditor({
          imageBase64: reader.result,
          ...opts,
        });
        resolve();
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

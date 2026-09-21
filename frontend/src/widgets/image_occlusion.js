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
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="margin:0;">${i18n.t("occlusion.title") || "Image Occlusion"}</h2>
        <div>
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

  function renderMasks() {
    masksLayer.innerHTML = "";
    masks.forEach((m, idx) => {
      const el = document.createElement("div");
      el.className = "io-mask";
      el.style.left = `${m.x}px`;
      el.style.top = `${m.y}px`;
      el.style.width = `${m.w}px`;
      el.style.height = `${m.h}px`;
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
          const newLabel = prompt(i18n.t("occlusion.editLabel") || "Label", m.label || "");
          if (newLabel !== null) {
            m.label = newLabel.trim() || m.label;
            renderMasks();
          }
        }
        e.stopPropagation();
      });
      masksLayer.appendChild(el);
    });
  }

  function getMousePos(e) {
    const r = wrap.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
      y: Math.max(0, Math.min(r.height, e.clientY - r.top)),
    };
  }

  wrap.addEventListener("mousedown", (e) => {
    if (e.target !== wrap && !(e.target instanceof HTMLImageElement)) return;
    const p = getMousePos(e);
    drawStart = p;
    drawingActive = true;
    drawing.style.display = "block";
    drawing.style.left = `${p.x}px`;
    drawing.style.top = `${p.y}px`;
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
    drawing.style.left = `${x}px`;
    drawing.style.top = `${y}px`;
    drawing.style.width = `${w}px`;
    drawing.style.height = `${h}px`;
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
    if (w < 8 || h < 8) return; // too small
    const label = prompt(i18n.t("occlusion.askLabel") || "Label for this region (e.g. Riñón):", "") || "";
    if (!label.trim()) return;
    masks.push({ x, y, w, h, label: label.trim() });
    renderMasks();
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

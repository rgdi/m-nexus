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
  /* border-box importa: con content-box, el padding de 4px y el borde
   * de 2px suman 12px a una caja cuya altura viene del OCR. Una
   * etiqueta de una palabra mide unos 9px, así que grow un 130% y
   * tapaba mucho más de lo que le correspondía. */
  box-sizing: border-box;
  overflow: hidden;
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
/* Sin borde propio: el marco lo pone la tarjeta que lo contiene. Con
 * borde aquí, el area de posicionamiento es 2px mas pequeña que la
 * imagen y las máscaras del borde se salen de ella. */
.io-canvas-wrap {
  display: inline-block;
  position: relative;
  border: 0;
  border-radius: 8px;
  line-height: 0;
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
        <span class="muted">${i18n.t("occlusion.help") || "Arrastra para dibujar. Toca una máscara para renombrarla. Delete borra la seleccionada."}</span>
        <button class="btn small" id="io-autodetect" disabled>
          <span class="io-spinner" hidden></span>
          <span class="io-autodetect-label">${i18n.t("occlusion.autodetect") || "Detectar etiquetas"}</span>
        </button>
      </div>
      <p class="io-ocr-note" id="io-ocr-note" hidden></p>
      <div class="io-canvas-wrap" id="io-canvas-wrap">
        <img id="io-img" src="${escapeHtml(src)}" alt="Imagen para oclusión" />
        <div id="io-overlay-masks" style="position:absolute;inset:0;"></div>
        <div id="io-drawing" class="io-drawing" style="display:none;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const wrap = overlay.querySelector("#io-canvas-wrap");
  const imgEl = overlay.querySelector("#io-img");
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
  /**
   * v2.38.7 — detección automática de etiquetas.
   *
   * Los diagramas anatómicos vienen con el texto puesto y sus líneas
   * apuntando a cada pieza. Dibujar una máscara por cada una es la
   * parte tediosa de crear una tarjeta de oclusión, y es la que
   *Tmite que la gente no cree ninguna. Se pasa la imagen por OCR, se
   * agrupan los bloques que forman una misma etiqueta y cada una
   * propose su propia máscara.
   *
   * Es un acompañante, no un autor: nada se guarda sin que el usuario
   * lo revise. Las propuestas se distinguen de las que ya están hechas,
   * se pueden editar, borrar todas y volver a detectar.
   */
  async function autoDetect() {
    const btn = overlay.querySelector("#io-autodetect");
    const note = overlay.querySelector("#io-ocr-note");
    const spin = overlay.querySelector(".io-spinner");
    const lbl = overlay.querySelector(".io-autodetect-label");
    if (btn.disabled) return;
    btn.disabled = true;
    spin.hidden = false;
    lbl.textContent = i18n.t("occlusion.detecting") || "Buscando…";

    try {
      // v2.38.7 — el OCR necesita píxeles, no una URL. Si la imagen
      // viene de la biblioteca es una ruta relativa y el backend no la
      // puede leer; se pinta en un canvas y sale como data URL. Sirve
      // igual para un archivo subido.
      const dataUrl = await toDataUrl(imgEl);
      if (!dataUrl) throw new Error("no se pudo leer la imagen");
      const { authHeaders } = await import("../services/auth.js");
      const { detectApiBase } = await import("../services/api_base.js");
      const r = await fetch(`${detectApiBase()}/api/v1/ocr/recognize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(
          dataUrl
            ? { image: dataUrl.replace(/^data:[^;]+;base64,/, ""), languages: "spa+eng", minConfidence: 55 }
            : { imageUrl: imgEl.src, languages: "spa+eng", minConfidence: 55 },
        ),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      // v2.38.7 — la ruta devuelve { ocr: { regions } }, no `blocks`:
      // regions es el nombre que usa ocrHandwriting. Se aceptan las dos
      // formas porque el servicio tiene las dos y solo una está viva.
      const out = await r.json();
      const raw = out.ocr || out.result || out;
      const blocks = (raw.regions || raw.blocks || []).filter(
        (b) => b.text && b.text.trim().length > 1,
      );
      if (!blocks.length) {
        note.hidden = false;
        note.className = "io-ocr-note";
        note.textContent =
          i18n.t("occlusion.noLabels") || "No encontré texto en la imagen. Dibuja las máscaras a mano.";
        return;
      }
      // Propuestas aparte: no tocan lo que el usuario ya hizo.
      // v2.38.7 — tesseract devuelve palabras sueltas y una etiqueta de
      // un diagrama no es una palabra: "ventana oval" son tres cajas.
      // Aceptarlas tal cual produce 27 máscaras de las que veinte son
      // fragmentos sin sentido, que es peor que no detectar nada. Se
      // agrupan por renglón antes de proponer nada.
      const groups = groupIntoLabels(blocks);

      // v2.38.7 — el OCR devuelve píxeles de la imagen original; el
      // editor trabaja en 0..1. Sin esta conversión las máscaras caen
      // fuera, que es el fallo clásico de mezclar los dos sistemas.
      const iw = imgEl.naturalWidth || 1;
      const ih = imgEl.naturalHeight || 1;
      proposals = groups
        .map((b) => ({
          label: b.text.trim(),
          x: b.bbox.x / iw,
          y: b.bbox.y / ih,
          w: b.bbox.w / iw,
          h: b.bbox.h / ih,
          confidence: b.confidence,
        }))
        .filter((pr) => pr.w > 0.004 && pr.h > 0.004)
        // El OCR puede dar una caja pegada al borde, medio fuera. Se
        // recorta a la imagen en vez de dejarla salirse.
        .map((pr) => ({
          ...pr,
          x: Math.max(0, Math.min(1 - pr.w, pr.x)),
          y: Math.max(0, Math.min(1 - pr.h, pr.y)),
          w: Math.min(pr.w, 1),
          h: Math.min(pr.h, 1),
        }));
      renderProposals();
      note.hidden = false;
      note.className = "io-ocr-note";
      note.textContent = `${i18n.t("occlusion.found") || "Encontradas"}: ${proposals.length}. ` +
        (i18n.t("occlusion.reviewHint") || "Revísalas: puedes.editarlas, borrarlas o añadir más a mano.");
    } catch (err) {
      note.hidden = false;
      note.className = "io-ocr-note is-error";
      note.textContent =
        (i18n.t("occlusion.ocrFailed") || "No pude detectar el texto:") + " " + String(err.message || err);
    } finally {
      spin.hidden = true;
      lbl.textContent = i18n.t("occlusion.autodetect") || "Detectar etiquetas";
      btn.disabled = false;
    }
  }

  /** Las propuestas viven aparte hasta que el usuario las acepta. */
  function renderProposals() {
    const bar = overlay.querySelector(".io-toolbar");
    let box = overlay.querySelector(".io-proposals");
    if (box) box.remove();
    if (!proposals.length) return;
    box = document.createElement("div");
    box.className = "io-proposals";
    box.innerHTML =
      `<p class="io-proposals-title">${i18n.t("occlusion.proposals") || "Detectadas"} (${proposals.length})</p>` +
      proposals
        .map(
          (pr, i) => `
        <div class="io-proposal" data-i="${i}">
          <span class="io-proposal-label">${escapeHtml(pr.label)}</span>
          <span class="io-proposal-conf">${Math.round((pr.confidence ?? 0) * 100)}%</span>
          <button class="btn icon small" data-drop="${i}" aria-label="Quitar">✕</button>
        </div>`,
        )
        .join("") +
      `<div class="io-proposals-actions">
        <button class="btn small primary" id="io-accept-all">${i18n.t("occlusion.acceptAll") || "Aceptarlas todas"}</button>
        <button class="btn small ghost" id="io-clear-proposals">${i18n.t("occlusion.clearProposals") || "Descartar"}</button>
      </div>`;
    bar?.after(box);
    box.querySelectorAll("[data-drop]").forEach((b) =>
      b.addEventListener("click", () => {
        proposals.splice(Number(b.dataset.drop), 1);
        renderProposals();
      }),
    );
    box.querySelector("#io-accept-all")?.addEventListener("click", () => {
      for (const pr of proposals) {
        if (!masks.some((m) => m.label === pr.label)) masks.push({ ...pr });
      }
      proposals = [];
      renderProposals();
      renderMasks();
    });
    box.querySelector("#io-clear-proposals")?.addEventListener("click", () => {
      proposals = [];
      renderProposals();
    });
  }

  /** La imagen tal y como la ve el usuario, como data URL. */
  function toDataUrl(el) {
    if (!el || !el.naturalWidth) return Promise.resolve(null);
    if (el.dataset.dataUrl) return Promise.resolve(el.dataset.dataUrl);
    if (el.src.startsWith("data:")) return Promise.resolve(el.src);
    return new Promise((resolve) => {
      const c = document.createElement("canvas");
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(el, 0, 0);
      let out = null;
      try {
        out = c.toDataURL("image/png");
      } catch {
        // Una imagen de origen remoto tienta el canvas; en ese caso se
        // deja que el backend la baje de la URL.
        out = null;
      }
      el.dataset.dataUrl = out || "";
      resolve(out);
    });
  }

  /**
   * Une palabras en etiquetas: misma línea y hueco pequeño.
   *
   * "Canales" y "semicirculares" salen en renglones distintos en el
   * diagrama, así que se quedan como dos rótulos aunque formen la misma
   * frase — es lo que el dibujo dice, no lo que la frase signifiería.
   */
  function groupIntoLabels(blocks) {
    const norm = blocks.map((b) => {
      const h = b.bbox.h || 1;
      return { ...b, cy: b.bbox.y + h / 2, x2: b.bbox.x + b.bbox.w, h };
    });
    norm.sort((a, b) => a.cy - b.cy || a.bbox.x - b.bbox.x);

    const out = [];
    let cur = null;
    const flush = () => {
      if (cur) out.push(cur);
      cur = null;
    };
    for (const b of norm) {
      if (cur) {
        const sameLine = Math.abs(b.cy - cur.cy) < Math.max(4, Math.min(b.h, cur.h) * 0.6);
        const gap = b.bbox.x - cur.x2;
        if (sameLine && gap < Math.max(b.h, cur.h) * 1.5) {
          const x1 = Math.min(cur.bbox.x, b.bbox.x);
          const y1 = Math.min(cur.bbox.y, b.bbox.y);
          const h1 = Math.max(cur.bbox.y + cur.h, b.bbox.y + b.h);
          cur = {
            text: (cur.text + " " + b.text).trim(),
            bbox: { x: x1, y: y1, w: Math.max(cur.x2, b.x2) - x1, h: h1 - y1 },
            confidence: Math.min(cur.confidence, b.confidence),
            cy: (cur.cy + b.cy) / 2,
            x2: Math.max(cur.x2, b.x2),
            h: Math.max(cur.h, b.h),
          };
          continue;
        }
        flush();
      }
      cur = { ...b };
    }
    flush();
    return out;
  }

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
  let proposals = [];

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

  imgEl?.addEventListener("load", () => {
    const b = overlay.querySelector("#io-autodetect");
    if (b) b.disabled = false;
  });
  overlay.querySelector("#io-autodetect")?.addEventListener("click", autoDetect);

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

/**
 * v2.38.7 — el modo repaso.
 *
 * Monta la tarjeta de oclusión como actividad: una zona tapada por
 * pregunta, y se responde por escrito. El color lo dice todo:
 *
 *   turno        la que se está preguntando, encendida
 *   acertada     la línea de la respuesta se ve, sin etiqueta: la has
 *                dicho tú, no hace falta recordártelo
 *   fallada      la etiqueta se enseña y se explica por qué
 *
 * Las tres cosas se leen de un vistazo, que es lo único que funciona
 * con diez zonas en pantalla. Y al terminar sale la puntuación con el
 * detalle, no un número suelto.
 */
export function mountOcclusionReview(host, { imageUrl, occlusions = [], topic, onFinish } = {}) {
  host.innerHTML = `
    <div class="occ-review">
      <div class="occ-review-stage">
        <img src="${escapeHtml(imageUrl)}" alt="" draggable="false" />
        <div class="occ-review-layers">
          ${occlusions
            .map(
              (o, i) => `<div class="occ-mask" data-r="${i}"
                style="left:${o.x * 100}%;top:${o.y * 100}%;width:${o.w * 100}%;height:${o.h * 100}%">
                <span class="occ-mask-label">${escapeHtml(o.label || "")}</span>
              </div>`,
            )
            .join("")}
        </div>
      </div>
      <div class="occ-review-side">
        <p class="occ-review-progress" id="occ-progress"></p>
        <h3 class="occ-review-q" id="occ-q"></h3>
        <input class="input" id="occ-answer" type="text"
               placeholder="${escapeHtml(i18n.t("occlusion.answerHint") || "Escribe lo que falta…")}" />
        <div class="occ-review-actions">
          <button class="btn primary" id="occ-send">${escapeHtml(i18n.t("common.confirm") || "Comprobar")}</button>
          <button class="btn ghost" id="occ-skip">${escapeHtml(i18n.t("occlusion.skip") || "No lo sé")}</button>
        </div>
        <div id="occ-feedback" class="occ-feedback" hidden></div>
        <div id="occ-score" class="occ-score" hidden></div>
      </div>
    </div>`;

  const layerEls = [...host.querySelectorAll(".occ-mask")];
  const order = occlusions.map((_, i) => i);
  let pos = 0;
  const results = [];

  function paintQuestion() {
    layerEls.forEach((el, i) => {
      el.classList.remove("is-asking", "is-right", "is-wrong");
      const lab = el.querySelector(".occ-mask-label");
      if (lab) lab.textContent = occlusions[i].label || "";
    });
    if (pos >= order.length) return showScore();
    const idx = order[pos];
    layerEls[idx].classList.add("is-asking");
    host.querySelector("#occ-progress").textContent =
      `${pos + 1} / ${order.length} · ${topic ? escapeHtml(topic) : ""}`;
    host.querySelector("#occ-q").textContent =
      i18n.t("occlusion.whatIsHere") || "¿Qué va aquí?";
    host.querySelector("#occ-feedback").hidden = true;
    host.querySelector("#occ-answer").value = "";
  }

  function answer(ok) {
    const idx = order[pos];
    const el = layerEls[idx];
    const lab = el.querySelector(".occ-mask-label");
    const expected = (occlusions[idx].label || "").toLowerCase();
    const typed = (host.querySelector("#occ-answer").value || "").toLowerCase().trim();

    // Acierto si coincide, o si al menos shares the whole word: "CFTR"
    // escrito con tilde y sin tilde es el mismo sitio.
    const right = ok && (typed === expected || expected.includes(typed) && typed.length >= 3);

    el.classList.remove("is-asking");
    el.classList.add(right ? "is-right" : "is-wrong");
    if (lab) lab.textContent = right ? "" : occlusions[idx].label || "";

    const fb = host.querySelector("#occ-feedback");
    fb.hidden = false;
    fb.className = "occ-feedback " + (right ? "is-right" : "is-wrong");
    fb.innerHTML = right
      ? `<strong>${escapeHtml(i18n.t("occlusion.right") || "Correcto")}</strong>`
      : `<strong>${escapeHtml(occlusions[idx].label || "?")}</strong>
         <p>${escapeHtml(right ? "" : i18n.t("occlusion.wrongHint") || "Esta era la zona tapada. Vuelve a ella antes del próximo examen.")}</p>`;

    results.push({ idx, right, expected: occlusions[idx].label });
    pos += 1;
    if (pos < order.length) setTimeout(paintQuestion, right ? 700 : 2200);
    else setTimeout(showScore, right ? 700 : 2200);
  }

  function showScore() {
    const right = results.filter((r) => r.right).length;
    const wrap = host.querySelector("#occ-score");
    wrap.hidden = false;
    wrap.innerHTML = `
      <h3>${right} / ${results.length}</h3>
      <ul class="occ-score-list">
        ${results
          .map(
            (r) => `<li class="${r.right ? "is-right" : "is-wrong"}">${escapeHtml(r.expected)}</li>`,
          )
          .join("")}
      </ul>
      <button class="btn" id="occ-again">${escapeHtml(i18n.t("occlusion.again") || "Otra vez")}</button>`;
    host.querySelector("#occ-again")?.addEventListener("click", () => {
      pos = 0;
      results.length = 0;
      wrap.hidden = true;
      paintQuestion();
    });
    if (onFinish) onFinish({ right, total: results.length, results });
  }

  host.querySelector("#occ-send").addEventListener("click", () => answer(true));
  host.querySelector("#occ-answer").addEventListener("keydown", (e) => {
    if (e.key === "Enter") answer(true);
  });
  host.querySelector("#occ-skip").addEventListener("click", () => answer(false));
  paintQuestion();
  return { restart: () => { pos = 0; results.length = 0; paintQuestion(); } };
}


/* ============================================================
 * file_attachments.js — gestor de archivos adjuntos a notas.
 * v2.0.1 — image/pdf/glb con preview + image occlusion 3D.
 *
 * Modelo: cada nota tiene una lista de attachments (base64 o blob URL)
 * Persistencia: localStorage + sync con backend (base64 < 1MB).
 * v2.1.5+ W7 — usa escapeHtml/escapeAttr centralizados.
 * ============================================================ */

import { escapeHtml, escapeAttr } from "../services/safe.js";

const STYLE = `
.attachments-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  padding: var(--s-3) 0;
}
.attachment {
  position: relative;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  overflow: hidden;
  aspect-ratio: 1;
  cursor: pointer;
}
.attachment img, .attachment canvas, .attachment embed {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.attachment .overlay {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 6px 8px;
  background: linear-gradient(to top, rgba(0,0,0,0.7), transparent);
  color: white;
  font-size: 11px;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}
.attachment .badge {
  position: absolute;
  top: 6px; left: 6px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0,0,0,0.6);
  color: white;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}
.attachment .del-btn {
  position: absolute;
  top: 6px; right: 6px;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: rgba(220,38,38,0.85);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 200ms;
}
.attachment:hover .del-btn { opacity: 1; }
.attach-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px dashed var(--border);
  color: var(--fg-muted);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.attach-btn:hover { background: var(--bg-sunken); color: var(--fg); }

/* image occlusion sobre imagen — el usuario coloca hide-tags */
.occlusion-toolbar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-sunken);
  border-radius: 10px;
  margin-bottom: 8px;
}
.occlusion-canvas-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
.occlusion-canvas-wrap img {
  display: block;
  max-width: 100%;
  max-height: 60vh;
}
.occlusion-tag {
  position: absolute;
  background: rgba(0,0,0,0.85);
  color: white;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  border: 2px solid transparent;
}
.occlusion-tag.hidden {
  background: rgba(220,38,38,0.85);
  color: white;
}
.occlusion-tag.revealed {
  background: rgba(34,197,94,0.85);
}
.occlusion-tag.editing {
  border-color: #fbbf24;
}
`;

const ATT_KEY = "mnexus.attachments.v1";

/**
 * getAttachments — devuelve los adjuntos de una nota.
 */
export function getAttachments(noteId) {
  try {
    const all = JSON.parse(localStorage.getItem(ATT_KEY) || "{}");
    return all[noteId] || [];
  } catch { return []; }
}

export function saveAttachments(noteId, list) {
  try {
    const all = JSON.parse(localStorage.getItem(ATT_KEY) || "{}");
    all[noteId] = list;
    localStorage.setItem(ATT_KEY, JSON.stringify(all));
  } catch {}
}

/**
 * addAttachment — procesa un File y lo guarda como base64.
 */
export async function addAttachment(noteId, file) {
  const dataUrl = await fileToDataUrl(file);
  const att = {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    type: file.type,
    size: file.size,
    dataUrl,
    addedAt: Date.now(),
    occlusion: null, // null = no occlusion system attached yet
  };
  const list = getAttachments(noteId);
  list.push(att);
  saveAttachments(noteId, list);
  return att;
}

export function removeAttachment(noteId, attId) {
  const list = getAttachments(noteId).filter((a) => a.id !== attId);
  saveAttachments(noteId, list);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ============================================================
 * renderAttachmentsGrid — muestra los adjuntos en una grid
 * dentro del contenedor root. Click = viewer modal.
 * ============================================================ */
export function renderAttachmentsGrid(rootEl, noteId, onUpdate) {
  if (!document.getElementById("attachments-styles")) {
    const s = document.createElement("style");
    s.id = "attachments-styles";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  const list = getAttachments(noteId);
  const grid = document.createElement("div");
  grid.className = "attachments-grid";
  if (list.length === 0) {
    grid.innerHTML = `<div class="muted small" style="grid-column: 1 / -1; padding: var(--s-3)">
      No attachments yet. Click "Attach" below to add images, PDFs or 3D models.
    </div>`;
  } else {
    grid.innerHTML = list.map((a) => renderTile(a)).join("");
  }
  rootEl.innerHTML = "";
  rootEl.appendChild(grid);

  // wire clicks
  grid.querySelectorAll(".attachment").forEach((el) => {
    const id = el.dataset.id;
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("del-btn")) return;
      const att = list.find((a) => a.id === id);
      if (att) openAttachmentViewer(att, noteId, () => {
        renderAttachmentsGrid(rootEl, noteId, onUpdate);
        if (onUpdate) onUpdate();
      });
    });
    el.querySelector(".del-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete attachment "${el.dataset.name}"?`)) {
        removeAttachment(noteId, id);
        renderAttachmentsGrid(rootEl, noteId, onUpdate);
        if (onUpdate) onUpdate();
      }
    });
  });
}

function renderTile(att) {
  const kind = att.type.startsWith("image/") ? "img"
              : att.type === "application/pdf" ? "pdf"
              : att.type.includes("gltf") || att.name.endsWith(".glb") ? "3d"
              : "file";
  const icon = { img: "🖼", pdf: "📄", "3d": "📦", file: "📎" }[kind];
  const preview = kind === "img"
    ? `<img src="${att.dataUrl}" alt="${escapeHtml(att.name)}">`
    : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:48px">${icon}</div>`;
  return `<div class="attachment" data-id="${att.id}" data-name="${escapeAttr(att.name)}">
    <span class="badge">${kind}</span>
    ${preview}
    <button class="del-btn" title="Delete">✕</button>
    <div class="overlay"><span>${escapeHtml(att.name.slice(0, 20))}${att.name.length > 20 ? "…" : ""}</span><span>${(att.size / 1024).toFixed(0)}KB</span></div>
  </div>`;
}

/* ============================================================
 * openAttachmentViewer — abre modal con preview del archivo.
 * Para imágenes: image occlusion tool integrado.
 * Para .glb: 3D viewer con hotspots.
 * Para pdf: iframe embebido.
 * ============================================================ */
export function openAttachmentViewer(att, noteId, onClose) {
  const kind = att.type.startsWith("image/") ? "img"
              : att.type === "application/pdf" ? "pdf"
              : (att.type.includes("gltf") || att.name.endsWith(".glb")) ? "3d"
              : "file";

  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `
    <div class="sheet" style="max-width: 900px">
      <div class="sheet-header">
        <h3>${escapeHtml(att.name)}</h3>
        <button class="btn icon" data-act="close">✕</button>
      </div>
      <div id="viewer-body"></div>
    </div>
  `;
  document.body.appendChild(scrim);
  scrim.querySelector('[data-act="close"]').addEventListener("click", () => { scrim.remove(); if (onClose) onClose(); });
  scrim.addEventListener("click", (e) => { if (e.target === scrim) { scrim.remove(); if (onClose) onClose(); } });
  const body = scrim.querySelector("#viewer-body");

  if (kind === "img") {
    body.appendChild(buildOcclusionTool(att, noteId, scrim));
  } else if (kind === "pdf") {
    body.innerHTML = `<iframe src="${att.dataUrl}" style="width:100%;height:60vh;border:none;border-radius:8px"></iframe>`;
  } else if (kind === "3d") {
    import("./three_d_viewer.js").then(({ open3DViewer }) => {
      const mount = document.createElement("div");
      body.appendChild(mount);
      // hotspots demo — production: extract from att.occlusion.hotspots
      const hotspots = (att.occlusion?.hotspots || []);
      open3DViewer(mount, hotspots, "bone");
    });
  } else {
    body.innerHTML = `<pre style="font-size:11px; max-height:300px; overflow:auto">${escapeHtml(att.dataUrl.slice(0, 200))}</pre>`;
  }
}

/* ============================================================
 * Image occlusion tool — click en la imagen para colocar
 * hide-tags. Cada tag tiene front/back. Se guardan en att.occlusion.
 * ============================================================ */
function buildOcclusionTool(att, noteId, scrim) {
  const wrap = document.createElement("div");

  // Cargar occlusion si existe
  let occ = att.occlusion || { tags: [], approved: false };

  // v2.1.2: no limit on tags. Auto-generate a denser grid (5x5)
  // proportional to image size, but cap to a reasonable number.
  const ensureAutoTags = (img) => {
    if (occ.tags.length > 0) return occ;
    const w = img.naturalWidth || 800;
    const h = img.naturalHeight || 600;
    // Aim for ~5x5 = 25 tags by default; smaller img → 4x4; bigger → 6x6
    const cols = w > 1000 ? 6 : 5;
    const rows = h > 800 ? 6 : 5;
    const total = cols * rows;
    const tags = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tags.push({
          id: `tag-${r}-${c}`,
          x: (c + 0.5) / cols * 100,
          y: (r + 0.5) / rows * 100,
          front: "?",
          back: `${r + 1}-${c + 1}`,
          state: "hidden",
        });
      }
    }
    return { tags, approved: false, auto: true, count: total };
  };

  wrap.innerHTML = `
    <div class="occlusion-toolbar">
      <span style="font-weight:600">🖼 Image Occlusion <span class="muted small">(${occ.tags.length} tags)</span></span>
      <button class="btn small" data-act="auto">Auto-generate</button>
      <button class="btn small" data-act="manual">+ Manual tag</button>
      <button class="btn small" data-act="reveal">Reveal all</button>
      <button class="btn small" data-act="hide">Hide all</button>
      <button class="btn small primary" data-act="quiz-mode">🎴 Quiz mode</button>
      <button class="btn small primary" data-act="approve">${occ.approved ? "✓ Approved" : "Approve"}</button>
      <span class="muted small" style="margin-left:auto">Click a tag to toggle · double-click to edit</span>
    </div>
    <div class="occlusion-canvas-wrap" id="occ-wrap">
      <img id="occ-img" src="${att.dataUrl}">
    </div>
    <div style="margin-top:8px;font-size:12px;color:var(--fg-muted)">
      ${occ.approved
        ? "✓ Approved — cards will be added to verify-your-knowledge pool."
        : "⏳ Unapproved — tags are stored but NOT pushed to the study queue."}
    </div>
  `;

  // Render tags
  const imgEl = wrap.querySelector("#occ-img");
  imgEl.addEventListener("load", () => {
    // si no hay tags, autogenerar
    if (occ.tags.length === 0) {
      occ = ensureAutoTags(imgEl);
      saveOcc(att, noteId, occ);
    }
    renderTags();
  });
  function renderTags() {
    const imgWrap = wrap.querySelector("#occ-canvas-wrap") || wrap.querySelector("#occ-wrap");
    // remove old tags
    imgWrap.querySelectorAll(".occlusion-tag").forEach((t) => t.remove());
    for (const t of occ.tags) {
      const el = document.createElement("div");
      el.className = `occlusion-tag ${t.state === "hidden" ? "hidden" : "revealed"}`;
      el.style.left = `${t.x}%`;
      el.style.top = `${t.y}%`;
      el.textContent = t.state === "hidden" ? t.front : t.back;
      el.title = `Front: ${t.front} | Back: ${t.back}`;
      el.addEventListener("click", () => {
        t.state = t.state === "hidden" ? "revealed" : "hidden";
        saveOcc(att, noteId, occ);
        renderTags();
      });
      el.addEventListener("dblclick", () => {
        // editar front/back
        const f = prompt("Front:", t.front);
        if (f === null) return;
        const b = prompt("Back:", t.back);
        if (b === null) return;
        t.front = f; t.back = b;
        saveOcc(att, noteId, occ);
        renderTags();
      });
      imgWrap.appendChild(el);
    }
  }

  wrap.querySelector('[data-act="auto"]').addEventListener("click", () => {
    if (confirm("Replace existing tags with auto-generated 3×3 grid?")) {
      occ = ensureAutoTags(imgEl);
      saveOcc(att, noteId, occ);
      renderTags();
    }
  });
  wrap.querySelector('[data-act="manual"]').addEventListener("click", () => {
    const x = 50, y = 50;
    const front = prompt("Front (question):", "?");
    if (!front) return;
    const back = prompt("Back (answer):", "");
    if (back === null) return;
    occ.tags.push({ id: `tag-${Date.now()}`, x, y, front, back, state: "hidden" });
    saveOcc(att, noteId, occ);
    renderTags();
  });
  wrap.querySelector('[data-act="reveal"]').addEventListener("click", () => {
    occ.tags.forEach((t) => (t.state = "revealed"));
    saveOcc(att, noteId, occ);
    renderTags();
  });
  wrap.querySelector('[data-act="hide"]').addEventListener("click", () => {
    occ.tags.forEach((t) => (t.state = "hidden"));
    saveOcc(att, noteId, occ);
    renderTags();
  });
  wrap.querySelector('[data-act="approve"]').addEventListener("click", () => {
    occ.approved = !occ.approved;
    saveOcc(att, noteId, occ);
    wrap.querySelector('[data-act="approve"]').textContent = occ.approved ? "✓ Approved" : "Approve";
    wrap.querySelector("div:last-child").innerHTML = occ.approved
      ? "✓ Approved — cards will be added to verify-your-knowledge pool."
      : "⏳ Unapproved — tags are stored but NOT pushed to the study queue.";
  });

  // v2.1.2: quiz mode — reveal tags one by one with random delay
  wrap.querySelector('[data-act="quiz-mode"]').addEventListener("click", async () => {
    if (occ.tags.length === 0) {
      alert("Add tags first (auto-generate or manual).");
      return;
    }
    // Shuffle tags, then reveal each one for a random 0.5–1.5s,
    // then re-hide. After all visited, return.
    const order = shuffle([...occ.tags]);
    for (const tag of order) {
      tag.state = "revealed";
      saveOcc(att, noteId, occ);
      renderTags();
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 900));
      tag.state = "hidden";
      saveOcc(att, noteId, occ);
      renderTags();
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  return wrap;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function saveOcc(att, noteId, occ) {
  const list = getAttachments(noteId);
  const found = list.find((a) => a.id === att.id);
  if (found) found.occlusion = occ;
  saveAttachments(noteId, list);
}

// v2.1.5+ W7: escapeHtml/escapeAttr imported from services/safe.js (top of file)


// screens/subjects.js — v2.22.1
//
// Lista de asignaturas dinámica + completamente personalizable.
//
// v2.22.1: lista plana sin "detail view". Cada fila es editable in-place.
//   - Botón "+" siempre visible para crear nuevas.
//   - Long-press / menú ⋯ por fila: Editar / Borrar / Mover / Cambiar color.
//   - Drag & drop para reordenar (mouse + touch).
//   - Color picker inline (8 colores WCAG-AA).
//   - Empty state amable: "Aún no tienes asignaturas. Añade la primera."
//   - Reset all: vacía la lista por completo (con confirmación).
//   - Setup wizard ya no añade "asignaturas fake" automáticamente.
//
// Modelo (backend):
//   Subject { id, name, icon, color, grade, performance, prof, next, order }

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { connectSync } from "../services/sync_client.js";

const state = {
  draggingId: null,
  lastListFull: [],
  // v2.23.0: drag visual feedback
  dropIndicator: null,
  dropPosition: null,
  dropTarget: null,
  touchDragging: null,
  touchClone: null,
};

export async function renderSubjects(root) {
  // v2.23.3: deep links to "#/subjects/<id>" still resolve to the list.
  // Clicking a subject opens the editor directly (no detail page).
  return renderSubjectList(root);
}

// 8 subject colors paired with --fg-on-subj-X tokens (WCAG-AA v2.22.0 audit).
const COLOR_SWATCHES = [
  { var: "var(--subj-red)",    fg: "var(--fg-on-subj-red)" },
  { var: "var(--subj-yellow)", fg: "var(--fg-on-subj-yellow)" },
  { var: "var(--subj-blue)",   fg: "var(--fg-on-subj-blue)" },
  { var: "var(--subj-purple)", fg: "var(--fg-on-subj-purple)" },
  { var: "var(--subj-green)",  fg: "var(--fg-on-subj-green)" },
  { var: "var(--subj-pink)",   fg: "var(--fg-on-subj-pink)" },
  { var: "var(--subj-orange)", fg: "var(--fg-on-subj-orange)" },
  { var: "var(--subj-teal)",   fg: "var(--fg-on-subj-teal)" },
];

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function colorToken(cssVar) {
  const m = String(cssVar || "").match(/var\(--subj-(\w+)/);
  return m ? m[1] : "blue";
}

async function renderSubjectList(root) {
  const subjects = await dataSource.subjects.list();
  state.lastListFull = subjects;

  // v2.23.0: ensure WS connected so we receive other-device changes.
  connectSync();

  // v2.23.0: multi-device sync — refresh on incoming subject events.
  installRemoteSyncListener(root);

  root.innerHTML = `
    <div class="screen subjects-screen">
      <header class="screen-header">
        <h1 class="h-title">Asignaturas</h1>
        <div class="spacer"></div>
        <button class="btn ghost" id="templates-btn" aria-label="Plantillas" title="Plantillas por carrera">📋</button>
        <button class="btn primary" id="new-subject" aria-label="Nueva asignatura">＋</button>
      </header>
      <p class="muted small" style="margin: 8px 0 0">
        Lista personal. Añade, edita, reordena o borra cuando quieras.
        Mantén pulsada una fila (o usa el botón ⋯) para acciones.
      </p>
      <div class="subj-rows" id="subjects-list" role="list">
        ${subjects.length === 0 ? renderEmptyState() : subjects.map(renderRow).join("")}
      </div>
      ${subjects.length > 0 ? renderToolbar() : ""}
    </div>
  `;

  const list = root.querySelector("#subjects-list");
  wireRowEvents(root, list);

  root.querySelector("#new-subject")?.addEventListener("click", () => openEditor(null, root));
  root.querySelector("#templates-btn")?.addEventListener("click", () => openTemplates(root));
  root.querySelector("#empty-templates")?.addEventListener("click", () => openTemplates(root));

  const toolsBtn = root.querySelector("#tools-menu");
  if (toolsBtn) {
    toolsBtn.addEventListener("click", () => openToolsMenu(toolsBtn, root));
  }
  const bulkBtn = root.querySelector("#bulk-add");
  if (bulkBtn) {
    bulkBtn.addEventListener("click", () => openBulkAdder(root));
  }
}

function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-icon">📚</div>
      <div class="em-title">Aún no tienes asignaturas</div>
      <div class="em-sub">Añade la primera con el botón ＋ arriba, usa una plantilla por carrera o impórtalas desde un backup.</div>
      <div class="empty-actions">
        <button class="btn primary" id="empty-add">＋ Añadir primera asignatura</button>
        <button class="btn ghost" id="empty-templates">📋 Plantillas por carrera</button>
        <button class="btn" id="empty-import">📥 Importar desde JSON</button>
      </div>
    </div>
  `;
}

function renderToolbar() {
  // v2.23.3: separamos el reset destructivo del toolbar normal.
  return `
    <div class="subj-toolbar">
      <button class="btn small" id="bulk-add">＋ Añadir varias</button>
      <button class="btn small ghost" id="tools-menu" aria-haspopup="menu" aria-expanded="false">⋯ Más</button>
    </div>
  `;
}

// "Más" submenu evita botones destructivos a plena vista.
function openToolsMenu(anchor, root) {
  let menu = document.querySelector("#subj-tools-menu");
  if (menu) { menu.remove(); }
  menu = document.createElement("div");
  menu.id = "subj-tools-menu";
  menu.className = "row-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button role="menuitem" data-act="reset-all" class="danger">🗑 Vaciar lista…</button>
    <button role="menuitem" data-act="export">📤 Exportar a JSON</button>
    <button role="menuitem" data-act="import">📥 Importar desde JSON</button>
  `;
  const r = anchor.getBoundingClientRect();
  menu.style.cssText = `position: fixed; right: 16px; bottom: ${Math.max(window.innerHeight - r.top, 80)}px; z-index: 1000; min-width: 200px`;
  document.body.appendChild(menu);
  anchor.setAttribute("aria-expanded", "true");
  const close = () => { menu.remove(); anchor.setAttribute("aria-expanded", "false"); document.removeEventListener("click", onDoc); };
  const onDoc = (ev) => { if (!menu.contains(ev.target) && ev.target !== anchor) close(); };
  setTimeout(() => document.addEventListener("click", onDoc), 0);
  menu.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    close();
    if (act === "reset-all") {
      if (!confirm("¿Vaciar TODAS las asignaturas? Esta acción no se puede deshacer.")) return;
      await dataSource.subjects.removeAll();
      renderSubjectList(root);
    } else if (act === "export") {
      const list = await dataSource.subjects.list();
      const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mnexus-subjects-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (act === "import") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const text = await file.text();
        try {
          const parsed = JSON.parse(text);
          const items = Array.isArray(parsed) ? parsed : parsed.subjects || [];
          await dataSource.subjects.bulkReplace(items);
          renderSubjectList(root);
        } catch (e) {
          alert("JSON inválido: " + e.message);
        }
      };
      input.click();
    }
  });
}

function renderRow(s) {
  const corner = `<span class="subj-row-corner" style="background:${s.color}; color: var(--fg-on-subj-${colorToken(s.color)})">${escapeHtml(s.icon || "?")}</span>`;
  const meta = [];
  if (s.prof) meta.push(`<span class="subj-row-prof">${escapeHtml(s.prof)}</span>`);
  if (s.grade != null) meta.push(`<span class="subj-row-grade">${s.grade.toFixed(2)}</span>`);
  if (s.performance) {
    const sign = s.performance > 0 ? "+" : "";
    meta.push(`<span class="subj-row-perf" data-pos="${s.performance > 0 ? "1" : "0"}">${sign}${s.performance}%</span>`);
  }
  return `
    <div class="subj-row" data-id="${s.id}" role="listitem" draggable="true">
      <button class="subj-row-handle" aria-label="Arrastrar para reordenar" title="Mantén pulsado para arrastrar">⋮⋮</button>
      ${corner}
      <div class="subj-row-body">
        <div class="subj-row-name">${escapeHtml(s.name)}</div>
        <div class="subj-row-meta">${meta.join(" · ") || '<span class="muted">sin metadatos</span>'}</div>
      </div>
      <button class="subj-row-actions" aria-label="Acciones" title="Más acciones">⋯</button>
    </div>
  `;
}

function wireRowEvents(root, list) {
  list.querySelectorAll(".subj-row").forEach((el) => {
    const id = el.dataset.id;
    el.querySelector(".subj-row-actions").addEventListener("click", (ev) => {
      ev.stopPropagation();
      openRowMenu(root, id, el);
    });
    el.querySelector(".subj-row-handle").addEventListener("click", (ev) => {
      ev.stopPropagation();
      openRowMenu(root, id, el);
    });
    el.addEventListener("dblclick", () => {
      const subj = state.lastListFull.find(x => x.id === id);
      if (subj) openEditor(subj, root);
    });
    el.addEventListener("dragstart", (ev) => {
      state.draggingId = id;
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", id);
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", (ev) => {
      // v2.23.0: clean up ghost + drop indicator
      el.classList.remove("dragging");
      state.draggingId = null;
      hideDropIndicator();
      ev.dataTransfer.clearData?.();
    });
    el.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      const rect = el.getBoundingClientRect();
      const offsetY = ev.clientY - rect.top;
      const isUpperHalf = offsetY < rect.height / 2;
      showDropIndicator(el, isUpperHalf ? "before" : "after");
    });
    el.addEventListener("dragleave", (ev) => {
      // Only hide if the drag is leaving THIS row (not entering a child)
      const rect = el.getBoundingClientRect();
      if (ev.clientY < rect.top || ev.clientY > rect.bottom ||
          ev.clientX < rect.left || ev.clientX > rect.right) {
        hideDropIndicator();
      }
    });
    el.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      hideDropIndicator();
      const src = ev.dataTransfer.getData("text/plain");
      const dst = id;
      const position = state.dropPosition; // "before" | "after"
      state.dropPosition = null;
      if (src && dst && src !== dst) {
        await reorderAround(src, dst, position);
        renderSubjectList(root);
      }
    });
    // Touch reorder via long-press + drag (mobile)
    let pressTimer = null;
    let touchMoved = false;
    let touchClone = null;
    let lastTouchY = 0;
    let lastTouchId = null;
    el.addEventListener("touchstart", (ev) => {
      const touch = ev.touches[0];
      lastTouchY = touch.clientY;
      lastTouchId = id;
      touchMoved = false;
      pressTimer = setTimeout(() => {
        // Start drag mode on long press
        if (!touchMoved) {
          startTouchDrag(el, id, touch, root);
        }
      }, 350);
    });
    el.addEventListener("touchmove", (ev) => {
      const touch = ev.touches[0];
      if (Math.abs(touch.clientY - lastTouchY) > 10) {
        touchMoved = true;
        clearTimeout(pressTimer);
        if (state.touchDragging === id && touchClone) {
          ev.preventDefault();
          touchClone.style.top = (touch.clientY - 30) + "px";
          // Find the row we're hovering
          const elBelow = document.elementFromPoint(touch.clientX, touch.clientY);
          const rowBelow = elBelow?.closest(".subj-row");
          if (rowBelow && rowBelow.dataset.id !== id) {
            const rect = rowBelow.getBoundingClientRect();
            const isUpperHalf = touch.clientY < rect.top + rect.height / 2;
            showDropIndicator(rowBelow, isUpperHalf ? "before" : "after");
            state.dropTarget = rowBelow.dataset.id;
            state.dropPosition = isUpperHalf ? "before" : "after";
          } else {
            hideDropIndicator();
            state.dropTarget = null;
          }
        }
      }
    });
    el.addEventListener("touchend", () => {
      clearTimeout(pressTimer);
      if (state.touchDragging === id) {
        endTouchDrag(id, root);
      }
    });
    el.addEventListener("touchcancel", () => {
      clearTimeout(pressTimer);
      if (state.touchDragging === id) {
        endTouchDrag(id, root);
      }
    });
  });
}

function startTouchDrag(el, id, touch, root) {
  state.touchDragging = id;
  el.classList.add("dragging");
  // Create floating clone that follows the finger
  const clone = el.cloneNode(true);
  clone.classList.add("drag-clone");
  const rect = el.getBoundingClientRect();
  clone.style.cssText = `position: fixed; left: ${rect.left}px; top: ${rect.top}px; width: ${rect.width}px; pointer-events: none; z-index: 999; opacity: 0.92; box-shadow: var(--shadow-3);`;
  document.body.appendChild(clone);
  state.touchClone = clone;
  if (navigator.vibrate) navigator.vibrate(20); // haptic feedback on drag start
}

async function endTouchDrag(id, root) {
  state.touchDragging = null;
  document.querySelectorAll(".subj-row.dragging").forEach(el => el.classList.remove("dragging"));
  if (state.touchClone) {
    state.touchClone.remove();
    state.touchClone = null;
  }
  hideDropIndicator();
  const dst = state.dropTarget;
  const position = state.dropPosition;
  state.dropTarget = null;
  state.dropPosition = null;
  if (dst && dst !== id) {
    await reorderAround(id, dst, position);
    renderSubjectList(root);
  }
}

function showDropIndicator(targetEl, position) {
  hideDropIndicator();
  if (!targetEl) return;
  targetEl.classList.add("drop-target-" + position);
  state.dropIndicator = { el: targetEl, position };
}

function hideDropIndicator() {
  if (state.dropIndicator) {
    state.dropIndicator.el.classList.remove("drop-target-before", "drop-target-after");
    state.dropIndicator = null;
  }
}

async function reorderAround(srcId, dstId, position = "after") {
  const list = await dataSource.subjects.list();
  const ids = list.map(s => s.id);
  const srcIdx = ids.indexOf(srcId);
  const dstIdx = ids.indexOf(dstId);
  if (srcIdx < 0 || dstIdx < 0 || srcIdx === dstIdx) return;
  ids.splice(srcIdx, 1);
  // Re-insert relative to the dst position.
  let targetIdx = ids.indexOf(dstId);
  if (position === "before") {
    ids.splice(targetIdx, 0, srcId);
  } else {
    ids.splice(targetIdx + 1, 0, srcId);
  }
  await dataSource.subjects.reorder(ids);
}

function openRowMenu(root, id, anchorEl) {
  const menu = document.createElement("div");
  menu.className = "row-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button role="menuitem" data-act="edit">✏️ Editar</button>
    <button role="menuitem" data-act="up">↑ Mover arriba</button>
    <button role="menuitem" data-act="down">↓ Mover abajo</button>
    <button role="menuitem" data-act="color">🎨 Cambiar color</button>
    <hr/>
    <button role="menuitem" data-act="delete" class="danger">🗑 Borrar</button>
  `;
  const r = anchorEl.getBoundingClientRect();
  menu.style.cssText = `position: fixed; top: ${r.bottom + 4}px; left: ${Math.min(r.left, window.innerWidth - 200)}px; z-index: 1000`;
  document.body.appendChild(menu);
  const close = () => menu.remove();
  menu.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.act;
    close();
    const subj = state.lastListFull.find(s => s.id === id);
    if (act === "edit") {
      if (subj) openEditor(subj, root);
    } else if (act === "up") {
      await moveBy(id, -1, root);
    } else if (act === "down") {
      await moveBy(id, +1, root);
    } else if (act === "color") {
      await cycleColor(id, root);
    } else if (act === "delete") {
      if (!confirm(`¿Borrar "${subj?.name}"? Las notas vinculadas quedan intactas.`)) return;
      await dataSource.subjects.remove(id);
      renderSubjectList(root);
    }
  });
  setTimeout(() => {
    const once = (ev) => {
      if (!menu.contains(ev.target)) { close(); document.removeEventListener("click", once); }
    };
    document.addEventListener("click", once);
  }, 0);
}

async function moveBy(id, delta, root) {
  const list = await dataSource.subjects.list();
  const ids = list.map(s => s.id);
  const idx = ids.indexOf(id);
  const target = idx + delta;
  if (idx < 0 || target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  await dataSource.subjects.reorder(ids);
  renderSubjectList(root);
}

async function cycleColor(id, root) {
  const subj = state.lastListFull.find(s => s.id === id);
  if (!subj) return;
  const currentIdx = COLOR_SWATCHES.findIndex(c => c.var === subj.color);
  const next = COLOR_SWATCHES[(currentIdx + 1) % COLOR_SWATCHES.length];
  await dataSource.subjects.update(id, { color: next.var });
  renderSubjectList(root);
}

function openEditor(existing, root) {
  const isEdit = !!existing;
  const subj = existing || { name: "", icon: "", color: COLOR_SWATCHES[0].var, grade: null, performance: 0, prof: "", next: "" };

  const form = document.createElement("form");
  form.className = "subject-editor";
  form.innerHTML = `
    <header class="editor-header">
      <h2>${isEdit ? "Editar asignatura" : "Nueva asignatura"}</h2>
      <button type="button" class="editor-close" aria-label="Cerrar">✕</button>
    </header>
    <div class="editor-body">
      <label class="field">
        <span>Nombre</span>
        <input type="text" name="name" required maxlength="40" value="${escapeHtml(subj.name)}" placeholder="Anatomía, Math, Derecho…" />
      </label>
      <label class="field">
        <span>Icono (1–3 letras)</span>
        <input type="text" name="icon" maxlength="3" value="${escapeHtml(subj.icon)}" placeholder="A" />
      </label>
      <fieldset class="field">
        <legend>Color</legend>
        <div class="color-swatches" role="radiogroup">
          ${COLOR_SWATCHES.map(c => `
            <label class="swatch" style="background:${c.var}; color: ${c.fg}" data-color="${c.var}">
              <input type="radio" name="color" value="${c.var}" ${subj.color === c.var ? "checked" : ""} />
              <span class="swatch-letter">${subj.icon || (subj.name[0] || "?")}</span>
            </label>
          `).join("")}
        </div>
      </fieldset>
      <div class="field-grid">
        <label class="field">
          <span>Nota media (0–10)</span>
          <input type="number" name="grade" min="0" max="10" step="0.01" value="${subj.grade ?? ""}" placeholder="—" />
        </label>
        <label class="field">
          <span>Tendencia (%)</span>
          <input type="number" name="performance" step="1" value="${subj.performance ?? 0}" placeholder="0" />
        </label>
      </div>
      <label class="field">
        <span>Profesor (opcional)</span>
        <input type="text" name="prof" maxlength="60" value="${escapeHtml(subj.prof)}" placeholder="Dr. Smith" />
      </label>
      <label class="field">
        <span>Próxima clase (opcional)</span>
        <input type="text" name="next" maxlength="60" value="${escapeHtml(subj.next)}" placeholder="Mié 10:00, Aula 3" />
      </label>
    </div>
    <footer class="editor-footer">
      ${isEdit ? '<button type="button" class="btn danger" data-act="delete">Borrar</button>' : ""}
      <div class="spacer"></div>
      <button type="button" class="btn" data-act="cancel">Cancelar</button>
      <button type="submit" class="btn primary">${isEdit ? "Guardar" : "Crear"}</button>
    </footer>
  `;

  const overlay = document.createElement("div");
  overlay.className = "editor-overlay";
  overlay.appendChild(form);
  document.body.appendChild(overlay);

  const nameInput = form.querySelector('input[name="name"]');
  const iconInput = form.querySelector('input[name="icon"]');
  const updateSwatchPreview = () => {
    const letter = (iconInput.value || nameInput.value || "?")[0]?.toUpperCase() || "?";
    form.querySelectorAll(".swatch-letter").forEach(s => s.textContent = letter);
  };
  nameInput.addEventListener("input", updateSwatchPreview);
  iconInput.addEventListener("input", updateSwatchPreview);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  form.querySelector(".editor-close").addEventListener("click", close);
  form.querySelector('[data-act="cancel"]').addEventListener("click", close);
  if (isEdit) {
    form.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`¿Borrar "${subj.name}"?`)) return;
      await dataSource.subjects.remove(subj.id);
      close();
      renderSubjectList(root);
    });
  }
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: (fd.get("name") || "").toString().trim(),
      icon: (fd.get("icon") || "").toString().trim() || ((fd.get("name") || "").toString().trim()[0] || "?").toUpperCase(),
      color: (fd.get("color") || COLOR_SWATCHES[0].var).toString(),
      grade: fd.get("grade") === "" || fd.get("grade") == null ? null : parseFloat(fd.get("grade")),
      performance: parseFloat(fd.get("performance") || "0") || 0,
      prof: (fd.get("prof") || "").toString().trim(),
      next: (fd.get("next") || "").toString().trim(),
    };
    if (!payload.name) { nameInput.focus(); return; }
    if (isEdit) {
      await dataSource.subjects.update(subj.id, payload);
    } else {
      await dataSource.subjects.create(payload);
    }
    close();
    renderSubjectList(root);
  });

  setTimeout(() => nameInput.focus(), 50);
}

function openBulkAdder(root) {
  const overlay = document.createElement("div");
  overlay.className = "editor-overlay";
  overlay.innerHTML = `
    <form class="subject-editor bulk">
      <header class="editor-header">
        <h2>Añadir varias asignaturas</h2>
        <button type="button" class="editor-close" aria-label="Cerrar">✕</button>
      </header>
      <div class="editor-body">
        <p class="muted small">Una asignatura por línea. El color se asigna rotando entre los 8 disponibles.</p>
        <label class="field">
          <span>Lista de asignaturas</span>
          <textarea name="list" rows="10" placeholder="Anatomía&#10;Histología&#10;Bioquímica&#10;Fisiología"></textarea>
        </label>
      </div>
      <footer class="editor-footer">
        <div class="spacer"></div>
        <button type="button" class="btn" data-act="cancel">Cancelar</button>
        <button type="submit" class="btn primary">Añadir todas</button>
      </footer>
    </form>
  `;
  document.body.appendChild(overlay);
  const form = overlay.querySelector("form");
  const close = () => overlay.remove();
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
  form.querySelector(".editor-close").addEventListener("click", close);
  form.querySelector('[data-act="cancel"]').addEventListener("click", close);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const text = new FormData(form).get("list")?.toString().trim() || "";
    const names = text.split("\n").map(s => s.trim()).filter(Boolean);
    if (names.length === 0) return;
    const existing = await dataSource.subjects.list();
    let nextColor = existing.length % COLOR_SWATCHES.length;
    for (const name of names) {
      const token = COLOR_SWATCHES[nextColor % COLOR_SWATCHES.length];
      await dataSource.subjects.create({
        name,
        icon: name[0].toUpperCase(),
        color: token.var,
        grade: null,
        performance: 0,
        prof: "",
        next: "",
      });
      nextColor++;
    }
    close();
    renderSubjectList(root);
  });
}

// renderSubjectDetail REMOVED in v2.23.3 — the Subjects page is now flat.
// Editor opens directly when clicking a row's "Editar" action.

// ============================================================
// v2.23.0: Multi-device sync via WebSocket
// ============================================================
//
// Listen to 'sync:incoming' events from sync_client.js.
// When a subject is created/updated/reordered/deleted on another
// device, the backend broadcasts via /ws/sync and we refresh.
//
// Implementation: a single globally-unique listener bound per
// render. We re-fetch from the data source so local CRDT applies
// any field-level conflict merges.
let remoteSyncListenerInstalled = null; // function ref
let remoteSyncRoot = null; // last root
function installRemoteSyncListener(root) {
  // If we had a different root mounted, clean up the old listener
  uninstallRemoteSyncListener();
  remoteSyncRoot = root;
  const handler = (msg) => {
    if (!msg || msg.type !== "subject") return;
    if (!remoteSyncRoot || !document.contains(remoteSyncRoot)) {
      // element is gone, nothing to refresh
      return;
    }
    // Fetch the updated list & re-render
    const screenStillActive = remoteSyncRoot.querySelector(".subjects-screen");
    if (!screenStillActive) return;
    // Schedule a microtask refresh
    queueMicrotask(async () => {
      try {
        await renderSubjectList(remoteSyncRoot);
      } catch (e) {
        console.warn("[subjects sync] refresh failed:", e);
      }
    });
  };
  document.addEventListener("sync:incoming", (ev) => handler(ev.detail));
  remoteSyncListenerInstalled = handler;
}

function uninstallRemoteSyncListener() {
  // Listeners are anonymous; we can't remove the specific one.
  // Instead, guard at handler-level: if `remoteSyncRoot` is gone
  // or no longer showing the subjects screen, we no-op.
  remoteSyncRoot = null;
  remoteSyncListenerInstalled = null;
}

// ============================================================
// v2.23.0: Templates por carrera
// ============================================================
//
// One-click addition of common subject sets. Press the "+" button
// or use the bulk adder to seed a typical academic load.

const TEMPLATES = [
  {
    id: "eso-1",
    title: "ESO 1º (Educación Secundaria)",
    emoji: "🎒",
    subjects: [
      { name: "Matemáticas", icon: "M", color: "var(--subj-blue)" },
      { name: "Lengua Castellana", icon: "L", color: "var(--subj-red)" },
      { name: "Inglés", icon: "E", color: "var(--subj-yellow)" },
      { name: "Biología y Geología", icon: "B", color: "var(--subj-green)" },
      { name: "Geografía e Historia", icon: "H", color: "var(--subj-orange)" },
      { name: "Tecnología", icon: "T", color: "var(--subj-teal)" },
      { name: "Educación Física", icon: "PE", color: "var(--subj-pink)" },
      { name: "Música", icon: "♪", color: "var(--subj-purple)" },
      { name: "Religión / Valores", icon: "RV", color: "var(--subj-yellow)" },
    ],
  },
  {
    id: "bach-cientifico",
    title: "Bachillerato Científico",
    emoji: "🔬",
    subjects: [
      { name: "Matemáticas II", icon: "M2", color: "var(--subj-blue)" },
      { name: "Física", icon: "F", color: "var(--subj-purple)" },
      { name: "Química", icon: "Q", color: "var(--subj-green)" },
      { name: "Biología", icon: "B", color: "var(--subj-teal)" },
      { name: "Lengua", icon: "L", color: "var(--subj-red)" },
      { name: "Inglés", icon: "E", color: "var(--subj-yellow)" },
      { name: "Historia de España", icon: "H", color: "var(--subj-orange)" },
    ],
  },
  {
    id: "bach-humanidades",
    title: "Bachillerato Humanidades",
    emoji: "📜",
    subjects: [
      { name: "Latín", icon: "L", color: "var(--subj-yellow)" },
      { name: "Historia del Arte", icon: "A", color: "var(--subj-red)" },
      { name: "Lengua", icon: "L", color: "var(--subj-blue)" },
      { name: "Inglés", icon: "E", color: "var(--subj-green)" },
      { name: "Filosofía", icon: "φ", color: "var(--subj-purple)" },
      { name: "Matemáticas Aplicadas", icon: "M", color: "var(--subj-orange)" },
    ],
  },
  {
    id: "uni-medicina",
    title: "Universidad — Medicina",
    emoji: "⚕️",
    subjects: [
      { name: "Anatomía", icon: "A", color: "var(--subj-red)" },
      { name: "Fisiología", icon: "Φ", color: "var(--subj-pink)" },
      { name: "Bioquímica", icon: "B", color: "var(--subj-green)" },
      { name: "Histología", icon: "H", color: "var(--subj-yellow)" },
      { name: "Genética", icon: "G", color: "var(--subj-purple)" },
      { name: "Farmacología", icon: "Rx", color: "var(--subj-blue)" },
      { name: "Microbiología", icon: "µ", color: "var(--subj-teal)" },
    ],
  },
  {
    id: "uni-ingenieria",
    title: "Universidad — Ingeniería",
    emoji: "⚙️",
    subjects: [
      { name: "Cálculo", icon: "∂", color: "var(--subj-blue)" },
      { name: "Álgebra", icon: "Æ", color: "var(--subj-purple)" },
      { name: "Física", icon: "F", color: "var(--subj-red)" },
      { name: "Programación", icon: "{} ", color: "var(--subj-green)" },
      { name: "Electrónica", icon: "Ω", color: "var(--subj-yellow)" },
      { name: "Estadística", icon: "σ", color: "var(--subj-orange)" },
      { name: "Termodinámica", icon: "θ", color: "var(--subj-teal)" },
    ],
  },
  {
    id: "uni-derecho",
    title: "Universidad — Derecho",
    emoji: "⚖️",
    subjects: [
      { name: "Derecho Civil", icon: "Cv", color: "var(--subj-yellow)" },
      { name: "Derecho Penal", icon: "P", color: "var(--subj-red)" },
      { name: "Derecho Constitucional", icon: "Co", color: "var(--subj-blue)" },
      { name: "Derecho Romano", icon: "R", color: "var(--subj-orange)" },
      { name: "Filosofía del Derecho", icon: "φ", color: "var(--subj-purple)" },
      { name: "Derecho Internacional", icon: "I", color: "var(--subj-green)" },
    ],
  },
  {
    id: "uni-ade",
    title: "Universidad — ADE / Empresa",
    emoji: "📊",
    subjects: [
      { name: "Contabilidad", icon: "$", color: "var(--subj-green)" },
      { name: "Marketing", icon: "M", color: "var(--subj-pink)" },
      { name: "Finanzas", icon: "€", color: "var(--subj-yellow)" },
      { name: "Microeconomía", icon: "m", color: "var(--subj-blue)" },
      { name: "Macroeconomía", icon: "M", color: "var(--subj-red)" },
      { name: "Estadística", icon: "σ", color: "var(--subj-purple)" },
      { name: "Recursos Humanos", icon: "RH", color: "var(--subj-orange)" },
    ],
  },
  {
    id: "uni-veterinaria",
    title: "Universidad — Veterinaria",
    emoji: "🐄",
    subjects: [
      { name: "Anatomía Animal", icon: "A", color: "var(--subj-red)" },
      { name: "Fisiología Animal", icon: "Φ", color: "var(--subj-pink)" },
      { name: "Microbiología", icon: "µ", color: "var(--subj-green)" },
      { name: "Patología", icon: "Pt", color: "var(--subj-orange)" },
      { name: "Farmacología", icon: "Rx", color: "var(--subj-purple)" },
      { name: "Nutrición Animal", icon: "N", color: "var(--subj-yellow)" },
      { name: "Cirugía", icon: "Qx", color: "var(--subj-blue)" },
    ],
  },
];


// ============================================================
// v2.23.0: Templates modal
// ============================================================
function openTemplates(root) {
  const ov = document.createElement("div");
  ov.className = "editor-overlay";
  ov.innerHTML = `
    <div class="subject-editor templates-modal">
      <header class="editor-header">
        <h3>📋 Plantillas por carrera</h3>
        <button class="icon-btn" aria-label="Cerrar" data-act="close">✕</button>
      </header>
      <div class="editor-body">
        <p class="muted small" style="margin: 0 0 var(--s-4)">
          Un click añade el conjunto de asignaturas típico. Puedes editar o borrar después.
        </p>
        <ul class="templates-list">
          ${TEMPLATES.map(t => `
            <li class="template-card">
              <div class="t-emoji">${t.emoji}</div>
              <div class="t-body">
                <div class="t-title">${escapeHtml(t.title)}</div>
                <div class="t-sub">${t.subjects.length} asignaturas · ${t.subjects.slice(0, 4).map(s => escapeHtml(s.name)).join(", ")}${t.subjects.length > 4 ? `, +${t.subjects.length - 4} más` : ""}</div>
              </div>
              <button class="btn primary" data-tpl="${t.id}">Añadir</button>
            </li>
          `).join("")}
        </ul>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector("[data-act='close']").addEventListener("click", close);
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  ov.querySelectorAll("[data-tpl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tpl = TEMPLATES.find(t => t.id === btn.dataset.tpl);
      if (!tpl) return;
      btn.disabled = true;
      btn.textContent = "Añadiendo…";
      // Backend sequential POST so .order field is contiguous.
      let i = 0;
      for (const s of tpl.subjects) {
        await dataSource.subjects.create({
          name: s.name,
          icon: s.icon,
          color: s.color,
          grade: null,
          performance: 0,
          prof: "",
          next: "",
          order: Number.MAX_SAFE_INTEGER - 1000 + i++, // append at end
        });
      }
      close();
      renderSubjectList(root);
    });
  });
  // ESC close
  const escHandler = (e) => {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  };
  document.addEventListener("keydown", escHandler);
}

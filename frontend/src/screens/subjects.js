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

const state = { selectedId: null, draggingId: null, lastListFull: [] };

export async function renderSubjects(root) {
  if (state.selectedId) {
    return renderSubjectDetail(root, state.selectedId);
  }
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

  root.innerHTML = `
    <div class="screen subjects-screen">
      <header class="screen-header">
        <h1 class="h-title">Asignaturas</h1>
        <div class="spacer"></div>
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

  const resetBtn = root.querySelector("#reset-all");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (!confirm(`¿Vaciar las ${subjects.length} asignaturas? Esta acción no se puede deshacer.`)) return;
      await dataSource.subjects.removeAll();
      renderSubjectList(root);
    });
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
      <div class="em-sub">Añade la primera con el botón ＋ arriba, o impórtalas desde un backup.</div>
      <div class="empty-actions">
        <button class="btn primary" id="empty-add">＋ Añadir primera asignatura</button>
        <button class="btn" id="empty-import">📥 Importar desde JSON</button>
      </div>
    </div>
  `;
}

function renderToolbar() {
  return `
    <div class="subj-toolbar">
      <button class="btn small" id="bulk-add">＋ Añadir varias</button>
      <button class="btn small danger" id="reset-all">🗑 Vaciar lista</button>
    </div>
  `;
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
    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      state.draggingId = null;
    });
    el.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      el.classList.remove("drag-over");
      const src = ev.dataTransfer.getData("text/plain");
      const dst = id;
      if (src && dst && src !== dst) {
        await reorderAround(src, dst);
        renderSubjectList(root);
      }
    });
    // Long press → actions menu (touch)
    let pressTimer = null;
    el.addEventListener("touchstart", () => {
      pressTimer = setTimeout(() => openRowMenu(root, id, el), 600);
    });
    el.addEventListener("touchend", () => clearTimeout(pressTimer));
    el.addEventListener("touchmove", () => clearTimeout(pressTimer));
  });
}

async function reorderAround(srcId, dstId) {
  const list = await dataSource.subjects.list();
  const ids = list.map(s => s.id);
  const srcIdx = ids.indexOf(srcId);
  const dstIdx = ids.indexOf(dstId);
  if (srcIdx < 0 || dstIdx < 0 || srcIdx === dstIdx) return;
  ids.splice(srcIdx, 1);
  ids.splice(dstIdx, 0, srcId);
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

async function renderSubjectDetail(root, id) {
  const s = await dataSource.subjects.get(id);
  if (!s) { state.selectedId = null; return renderSubjectList(root); }

  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <button class="btn icon" id="back">←</button>
        <h1 class="h-title">${escapeHtml(s.name)}</h1>
        <div class="spacer"></div>
        <button class="btn small" id="edit-detail">✏️ Editar</button>
      </header>
      <div class="tabs" role="tablist">
        <div class="tab active" data-tab="classes">Clases</div>
        <div class="tab" data-tab="topics">Temas</div>
      </div>
      <div id="tab-body" style="margin-top: var(--s-5)"></div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => { state.selectedId = null; renderSubjectList(root); });
  root.querySelector("#edit-detail").addEventListener("click", () => openEditor(s, root));
  const body = root.querySelector("#tab-body");
  body.innerHTML = `
    <div class="grid grid-2">
      <div class="card">
        <h4>Notas</h4>
        <div style="margin-top: var(--s-3); display:flex; flex-wrap:wrap; gap: 6px">
          ${[7.5, 8.2, 8.7, 9.0, 8.5].map(g => `<span class="chip ${g >= 8 ? "ok" : g >= 6 ? "warn" : "bad"}">${g.toFixed(1)}</span>`).join("")}
        </div>
      </div>
      <div class="card">
        <h4>Próxima clase</h4>
        <p class="muted">${s.next || "Sin programar"}</p>
        <p class="muted small">${s.prof || ""}</p>
      </div>
    </div>
  `;
}

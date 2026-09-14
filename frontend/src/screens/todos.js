/* ============================================================
 * screens/todos.js — to-do's list with priority and due dates
 * v1.1.0 — conectado al backend via dataSource
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";

const PAD = (n) => String(n).padStart(2, "0");
const fmtDateTime = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())} ${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
};
const isOverdue = (ms, done) => !done && ms && ms < Date.now();

const PRIORITY_LABEL = ["", "🔼", "🔺"];

export async function renderTodos(root) {
  const tasks = await dataSource.tasks.list();
  tasks.sort((a, b) => {
    if ((a.done ? 1 : 0) !== (b.done ? 1 : 0)) return (a.done ? 1 : 0) - (b.done ? 1 : 0);
    if ((a.priority || 0) !== (b.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (a.due || Infinity) - (b.due || Infinity);
  });

  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <h1 class="h-title">To-do's</h1>
        <div class="spacer"></div>
        <button class="btn primary" id="new">+ New task</button>
      </header>

      <div class="grid grid-3" style="margin-bottom: var(--s-5)">
        <div class="stat"><div class="lbl">Open</div><div class="val">${tasks.filter(t => !t.done).length}</div></div>
        <div class="stat"><div class="lbl">Done</div><div class="val">${tasks.filter(t => t.done).length}</div></div>
        <div class="stat"><div class="lbl">Overdue</div><div class="val">${tasks.filter(t => isOverdue(t.due, t.done)).length}</div></div>
      </div>

      <div class="card" style="padding: 0">
        <div id="list"></div>
      </div>
    </div>
  `;

  root.querySelector("#new").addEventListener("click", () => openTaskModal(null, () => renderTodos(root)));
  root.querySelector("#list").innerHTML = tasks.length
    ? tasks.map(t => taskRow(t)).join("")
    : `<div class="empty"><div class="em-title">All clear</div><div>No pending tasks.</div></div>`;

  root.querySelectorAll(".todo-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector(".todo-check").addEventListener("click", async (e) => {
      e.stopPropagation();
      await dataSource.tasks_toggle(id);
      renderTodos(root);
    });
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("todo-check")) return;
      openTaskModal(id, () => renderTodos(root));
    });
  });
}

function taskRow(t) {
  const overdue = isOverdue(t.due, t.done);
  return `
    <div class="todo-row" data-id="${t.id}" style="display:flex; align-items:center; gap: var(--s-3); padding: var(--s-3) var(--s-4); border-bottom: 1px solid var(--border); cursor:pointer">
      <button class="todo-check" aria-label="Toggle" style="width:24px;height:24px;border-radius:50%;border:2px solid ${t.done ? "var(--good)" : "var(--border-strong)"};background:${t.done ? "var(--good)" : "transparent"};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${t.done ? "✓" : ""}
      </button>
      <div style="flex:1; ${t.done ? "text-decoration:line-through;color:var(--fg-faint)" : ""}">
        <div class="bold">${escapeHtml(t.text)}</div>
        ${t.due ? `<div class="small" style="color:${overdue ? "var(--bad)" : "var(--fg-muted)"}">📅 ${fmtDateTime(t.due)} ${overdue ? " · OVERDUE" : ""}</div>` : ""}
      </div>
      <div class="row gap-2">
        ${t.priority ? `<span class="chip warn">${PRIORITY_LABEL[t.priority] || ""}</span>` : ""}
        ${t.subject ? `<span class="chip muted">${escapeHtml(t.subject)}</span>` : ""}
      </div>
    </div>
  `;
}

function openTaskModal(id, onSaved) {
  dataSource.tasks.get(id).then((t) => {
    const task = t || { text: "", due: null, priority: 0, subject: "" };

    const scrim = document.createElement("div");
    scrim.className = "scrim sheet-bottom";
    scrim.innerHTML = `
      <div class="sheet bottom">
        <div class="sheet-header">
          <h3>${id ? "Edit" : "New"} task</h3>
          <button class="btn icon" data-act="close">✕</button>
        </div>
        <div class="col gap-3">
          <input class="input" id="t-text" placeholder="What needs to be done?" value="${escapeHtml(task.text)}" />
          <div class="row gap-2">
            <input class="input" id="t-due" type="datetime-local" value="${task.due ? toLocalDateTime(task.due) : ""}" />
            <select class="input" id="t-priority">
              <option value="0" ${task.priority === 0 ? "selected" : ""}>Normal</option>
              <option value="1" ${task.priority === 1 ? "selected" : ""}>🔼 Medium</option>
              <option value="2" ${task.priority === 2 ? "selected" : ""}>🔺 Urgent</option>
            </select>
          </div>
          <input class="input" id="t-subject" placeholder="Subject / tag" value="${escapeHtml(task.subject || "")}" />
          <div class="row gap-2">
            ${id ? `<button class="btn danger" data-act="del" style="margin-right:auto">Delete</button>` : ""}
            <button class="btn primary" data-act="save">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);
    const close = () => scrim.remove();
    scrim.querySelector('[data-act="close"]').addEventListener("click", close);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    scrim.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const text = scrim.querySelector("#t-text").value.trim();
      if (!text) return;
      const payload = {
        text,
        due: fromLocalDateTime(scrim.querySelector("#t-due").value) || null,
        priority: parseInt(scrim.querySelector("#t-priority").value, 10),
        subject: scrim.querySelector("#t-subject").value.trim(),
        done: task.done ?? false,
      };
      if (id) await dataSource.tasks.update(id, payload);
      else await dataSource.tasks.create(payload);
      close();
      onSaved?.();
    });
    scrim.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
      await dataSource.tasks.remove(id);
      close();
      onSaved?.();
    });
  });
}

function toLocalDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}
function fromLocalDateTime(s) { return s ? new Date(s).getTime() : null; }

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

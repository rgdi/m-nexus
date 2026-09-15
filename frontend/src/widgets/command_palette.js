/* ============================================================
 * command_palette.js — búsqueda global estilo cmd+K / Spotlight.
 * v1.9.0 — busca en notas, flashcards, tasks, eventos, asignaturas.
 *
 * Atajo: Ctrl+K (Cmd+K en Mac). Botón en dock top-right.
 * v2.1.5+ W7 — usa escapeHtml/escapeAttr centralizados.
 * ============================================================ */

import { escapeHtml, escapeAttr } from "../services/safe.js";

const STYLE = `
.cmd-palette {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  backdrop-filter: blur(6px);
}
.cmd-palette .panel {
  width: min(680px, 92vw);
  max-height: 60vh;
  background: var(--bg-elevated);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(0,0,0,0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.cmd-palette .search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.cmd-palette .search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 18px;
  color: var(--fg);
  font-family: inherit;
}
.cmd-palette .search .icon { color: var(--fg-muted); }
.cmd-palette .search .hint {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--bg-sunken);
  color: var(--fg-muted);
  font-family: var(--font-mono);
}
.cmd-palette .results {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.cmd-palette .group-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 8px 20px;
  color: var(--fg-muted);
  font-weight: 700;
}
.cmd-palette .item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  cursor: pointer;
  border-left: 3px solid transparent;
}
.cmd-palette .item:hover, .cmd-palette .item.active {
  background: var(--bg-sunken);
  border-left-color: var(--accent);
}
.cmd-palette .item .ico {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-sunken);
  font-size: 16px;
}
.cmd-palette .item .body { flex: 1; min-width: 0; }
.cmd-palette .item .title { font-weight: 600; font-size: var(--fs-md); }
.cmd-palette .item .sub { font-size: var(--fs-xs); color: var(--fg-muted); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cmd-palette .item .badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--bg-sunken);
  color: var(--fg-muted);
  font-weight: 600;
}
.cmd-palette .empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--fg-muted);
}
.cmd-palette .footer {
  padding: 8px 20px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--fg-muted);
  align-items: center;
}
.cmd-palette .footer kbd {
  font-family: var(--font-mono);
  background: var(--bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  margin-right: 4px;
}

[data-theme="dark"] .cmd-palette,
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .cmd-palette { background: rgba(0,0,0,0.6); }
}
`;

const KEY = "mnexus.cmd.open";
let listenersAttached = false;

export function mountCommandPalette() {
  if (listenersAttached) return;
  listenersAttached = true;

  // keyboard shortcut: Ctrl+K / Cmd+K
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCommandPalette();
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  });
}

export function openCommandPalette() {
  if (document.querySelector(".cmd-palette")) return;
  if (!document.getElementById("cmd-palette-styles")) {
    const s = document.createElement("style");
    s.id = "cmd-palette-styles";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const root = document.createElement("div");
  root.className = "cmd-palette";
  root.innerHTML = `
    <div class="panel">
      <div class="search">
        <span class="icon">🔍</span>
        <input id="cmd-input" placeholder="Search notes, flashcards, tasks, events…" autocomplete="off" />
        <span class="hint">Esc</span>
      </div>
      <div class="results" id="cmd-results">
        <div class="empty">Type to search across M-NEXUS</div>
      </div>
      <div class="footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  const input = root.querySelector("#cmd-input");
  const results = root.querySelector("#cmd-results");
  let allItems = [];
  let activeIdx = 0;

  // Pre-fetch all resources
  fetchAll().then((items) => {
    allItems = items;
    renderResults("");
  });

  input.focus();
  input.addEventListener("input", () => renderResults(input.value));
  input.addEventListener("keydown", (e) => {
    const flat = flatResults(allItems, input.value);
    if (e.key === "ArrowDown") { activeIdx = (activeIdx + 1) % flat.length; e.preventDefault(); }
    else if (e.key === "ArrowUp") { activeIdx = (activeIdx - 1 + flat.length) % flat.length; e.preventDefault(); }
    else if (e.key === "Enter") {
      const it = flat[activeIdx];
      if (it) navigateToItem(it);
    }
    // mark active
    root.querySelectorAll(".item").forEach((el, i) => el.classList.toggle("active", i === activeIdx));
  });

  root.addEventListener("click", (e) => {
    if (e.target === root) closeCommandPalette();
  });

  function renderResults(q) {
    const flat = flatResults(allItems, q);
    activeIdx = 0;
    if (flat.length === 0) {
      results.innerHTML = `<div class="empty">No results${q ? ` for "${escapeHtml(q)}"` : ""}</div>`;
      return;
    }
    const groups = {};
    for (const it of flat) {
      groups[it.kind] = groups[it.kind] || [];
      groups[it.kind].push(it);
    }
    const groupOrder = ["subject", "note", "flashcard", "task", "event"];
    const titles = {
      subject: "Subjects",
      note: "Notes",
      flashcard: "Flashcards",
      task: "Tasks",
      event: "Events",
    };
    let html = "";
    let idx = 0;
    for (const kind of groupOrder) {
      if (!groups[kind]) continue;
      html += `<div class="group-title">${titles[kind]}</div>`;
      for (const it of groups[kind]) {
        html += renderItem(it, idx);
        idx++;
      }
    }
    results.innerHTML = html;
    // wire item clicks
    results.querySelectorAll(".item").forEach((el, i) => {
      el.addEventListener("click", () => {
        const flat = flatResults(allItems, input.value);
        navigateToItem(flat[i]);
      });
    });
  }

  function renderItem(it, i) {
    return `<div class="item ${i === activeIdx ? "active" : ""}" data-id="${escapeAttr(it.id)}">
      <span class="ico">${it.icon}</span>
      <div class="body">
        <div class="title">${escapeHtml(it.title)}</div>
        <div class="sub">${escapeHtml(it.subtitle || "")}</div>
      </div>
      <span class="badge">${escapeHtml(it.badge || it.kind)}</span>
    </div>`;
  }
}

export function closeCommandPalette() {
  document.querySelector(".cmd-palette")?.remove();
}

async function fetchAll() {
  const items = [];
  try {
    const [subjects, notes, flashcards, tasks, events] = await Promise.all([
      fetch("http://localhost:4100/api/v1/subjects").then((r) => r.ok ? r.json() : { subjects: [] }).catch(() => ({ subjects: [] })),
      fetch("http://localhost:4100/api/v1/notes").then((r) => r.ok ? r.json() : { notes: [] }).catch(() => ({ notes: [] })),
      fetch("http://localhost:4100/api/v1/flashcards").then((r) => r.ok ? r.json() : { cards: [] }).catch(() => ({ cards: [] })),
      fetch("http://localhost:4100/api/v1/tasks").then((r) => r.ok ? r.json() : { tasks: [] }).catch(() => ({ tasks: [] })),
      fetch("http://localhost:4100/api/v1/events").then((r) => r.ok ? r.json() : { events: [] }).catch(() => ({ events: [] })),
    ]);
    for (const s of (subjects.subjects || []).slice(0, 20)) {
      items.push({
        id: `subject:${s.id}`, kind: "subject", icon: "📚",
        title: s.name, subtitle: `Grade ${s.grade || "?"}`,
        badge: s.id, hash: `#/subjects`,
      });
    }
    for (const n of (notes.notes || []).slice(0, 30)) {
      items.push({
        id: `note:${n.id}`, kind: "note", icon: "📓",
        title: n.title, subtitle: (n.body || "").slice(0, 80),
        badge: n.subject || "",
        hash: `#/notes/${n.id}`,
      });
    }
    for (const c of (flashcards.cards || []).slice(0, 30)) {
      items.push({
        id: `fc:${c.id}`, kind: "flashcard", icon: "🎴",
        title: c.front, subtitle: `→ ${c.back}`,
        badge: c.subject || "",
        hash: `#/notes/${c.sourceNoteId}`,
      });
    }
    for (const t of (tasks.tasks || []).slice(0, 30)) {
      items.push({
        id: `task:${t.id}`, kind: "task", icon: t.done ? "✅" : "📝",
        title: t.text, subtitle: t.due ? `Due ${new Date(t.due).toLocaleDateString()}` : "",
        badge: t.subject || "",
        hash: `#/todos`,
      });
    }
    for (const ev of (events.events || []).slice(0, 30)) {
      items.push({
        id: `ev:${ev.id}`, kind: "event", icon: "📅",
        title: ev.title, subtitle: `${new Date(ev.start).toLocaleString()} · ${ev.room || ""}`,
        badge: ev.subject || "",
        hash: `#/calendar`,
      });
    }
  } catch (e) {
    console.warn("Command palette fetch failed:", e);
  }
  return items;
}

function flatResults(items, q) {
  const ql = (q || "").toLowerCase().trim();
  if (!ql) return items.slice(0, 20);
  return items.filter((it) => {
    return (it.title || "").toLowerCase().includes(ql) ||
           (it.subtitle || "").toLowerCase().includes(ql) ||
           (it.badge || "").toLowerCase().includes(ql);
  });
}

function navigateToItem(it) {
  closeCommandPalette();
  if (!it || !it.hash) return;
  location.hash = it.hash;
  // dispatch notes:open for note items
  const noteMatch = it.hash.match(/^#\/notes\/([^?]+)/);
  if (noteMatch) {
    document.dispatchEvent(new CustomEvent("notes:open", { detail: { id: noteMatch[1] } }));
  }
}

// v2.1.5+ W7: escapeHtml/escapeAttr imported from services/safe.js (top of file)

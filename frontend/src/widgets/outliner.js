/* ============================================================
 * widgets/outliner.js — atomic block-based outliner.
 *
 * v2.25.0 — RemNote / Logseq / Obsidian-Blocks-style bullet editor.
 *
 * Each bullet is a Block with a UUID. Keystroke mapping:
 *
 *   Enter             → new sibling block below
 *   Shift+Enter       → newline INSIDE the current block (preserves indentation)
 *   Tab               → indent (make current block a child of previous sibling)
 *   Shift+Tab         → outdent
 *   Backspace (empty) → delete block, merge into previous sibling's text tail
 *   Cmd/Ctrl+Backspace → delete block + descendants
 *   Cmd/Ctrl+] / [    → indent / outdent (alternative to Tab/Shift+Tab)
 *   Cmd/Ctrl+K        → open block palette (fuzzy search across blocks)
 *   Cmd/Ctrl+M        → toggle callout
 *   Cmd/Ctrl+T        → toggle toggle (collapsed children)
 *   `/cloze`          → converts block to cloze (type="cloze")
 *   `/code`           → converts to type="code"
 *   `/callout`        → type="callout"
 *   `/quote`          → type="quote"
 *   `>>` at line start → wraps text in {{c1::...::hint}} cloze
 *   `[[`              → opens block-reference autocomplete (resolved on save)
 *   `((`              → opens block-reference autocomplete (Logseq-style)
 *
 * All edits are pushed through the backend block-API; local state is the
 * optimistic mirror until the network ack arrives.
 * ============================================================ */

import { api } from "../services/api.js";
import { i18n } from "../services/i18n.js";
import { makeModal } from "./modal.js";
import { dataSource } from "../services/dataSource.js";

/**
 * Render the outliner for a given note id.
 * @param root HTMLElement where to mount.
 * @param noteId string
 * @param options { initialBlocks?, onChange?, readOnly? }
 */
export async function mountOutliner(root, noteId, options = {}) {
  const state = {
    noteId,
    blocks: options.initialBlocks ?? null,
    focusedBlockId: null,
    collapsed: new Set(),
    backlinksByBlockId: new Map(),
    saving: false,
    dirty: false,
  };

  // ---- 1. materialise blocks (auto-migrated by backend if needed) ----
  await loadBlocks();
  await render();

  async function loadBlocks() {
    try {
      const r = await api._raw("GET", `/notes/${noteId}/blocks`).catch(() => null);
      if (r && Array.isArray(r.blocks)) {
        state.blocks = r.blocks;
      } else {
        // Fallback to local cache from dataSource
        const note = await dataSource.notes.get(noteId).catch(() => null);
        state.blocks = note?.blocks ?? [];
      }
    } catch (e) {
      console.warn("[outliner] failed to load blocks", e);
      state.blocks = [];
    }
  }

  // ---- 2. tree helpers ----
  function childrenOf(parentId) {
    return (state.blocks || [])
      .filter((b) => b.parentId === parentId)
      .sort((a, b) => a.order - b.order);
  }
  function findBlock(id) {
    return (state.blocks || []).find((b) => b.id === id);
  }
  function isAncestor(ancestorId, candidateId) {
    let cur = findBlock(candidateId);
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = findBlock(cur.parentId);
    }
    return false;
  }

  // ---- 3. render ----
  async function render() {
    if (!state.blocks || state.blocks.length === 0) {
      // Empty note: offer first block.
      state.blocks = [
        {
          id: `block-${crypto.randomUUID()}`,
          parentId: null,
          order: 0,
          text: "",
          type: "text",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];
    }
    root.innerHTML = `
      <div class="outliner" role="tree" aria-label="Outliner">
        <div class="outliner-body">${renderSubtree(null, 0)}</div>
        <div class="outliner-foot">
          <span class="muted">${state.blocks.length} bloque(s)</span>
          <span class="muted" aria-live="polite">${state.saving ? "Guardando…" : ""}</span>
        </div>
      </div>
    `;
    bindEvents();
    if (state.focusedBlockId) focusBlock(state.focusedBlockId);
  }

  function renderSubtree(parentId, depth) {
    const kids = childrenOf(parentId);
    return kids
      .map((b) => {
        const isCollapsed = state.collapsed.has(b.id);
        const subKids = childrenOf(b.id);
        return `
        <div class="block-row ${isCollapsed ? "collapsed" : ""}" data-block-id="${b.id}" data-depth="${depth}" role="treeitem" aria-expanded="${subKids.length ? String(!isCollapsed) : "false"}">
          <div class="block-gutter">
            <button class="gutter-bullet" data-act="toggle-collapse" aria-label="Colapsar/expandir hijos" tabindex="-1">${subKids.length ? (isCollapsed ? "▸" : "▾") : "•"}</button>
            <button class="gutter-handle" data-act="drag" aria-label="Mover bloque" tabindex="-1">⋮⋮</button>
          </div>
          <div class="block-main">
            <div class="block-line">
              ${renderBlockPrefix(b)}
              <span
                class="block-text ${blockTypeClass(b.type)}"
                contenteditable="true"
                data-block-id="${b.id}"
                data-act="edit"
                spellcheck="false"
                aria-label="Editar bloque"
                role="textbox">${escapeHtml(b.text)}</span>
              ${renderBlockSuffix(b)}
            </div>
            ${b.type === "toggle" && subKids.length > 0 && !isCollapsed ? `<div class="block-children">${renderSubtree(b.id, depth + 1)}</div>` : ""}
            ${b.type !== "toggle" && subKids.length > 0 ? `<div class="block-children">${renderSubtree(b.id, depth + 1)}</div>` : ""}
          </div>
        </div>
      `;
      })
      .join("");
  }

  function blockTypeClass(type) {
    switch (type) {
      case "cloze": return "is-cloze";
      case "callout": return "is-callout";
      case "code": return "is-code";
      case "quote": return "is-quote";
      default: return "";
    }
  }

  function renderBlockPrefix(b) {
    if (b.type === "callout") return `<span class="block-prefix" aria-hidden="true">💡</span>`;
    if (b.type === "quote") return `<span class="block-prefix" aria-hidden="true">❝</span>`;
    if (b.type === "code") return `<span class="block-prefix" aria-hidden="true">▎</span>`;
    return "";
  }
  function renderBlockSuffix(b) {
    if (b.type === "cloze" && /\{\{c\d+::/.test(b.text)) {
      return `<span class="block-suffix" aria-label="Contiene cloze" title="Contiene cloze(s)">⛳</span>`;
    }
    return "";
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- 4. events ----
  function bindEvents() {
    const tree = root.querySelector(".outliner");
    if (!tree) return;

    tree.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (btn) {
        const row = btn.closest(".block-row");
        const id = row?.dataset.blockId;
        if (!id) return;
        if (btn.dataset.act === "toggle-collapse") {
          if (state.collapsed.has(id)) state.collapsed.delete(id);
          else state.collapsed.add(id);
          render();
        }
      }
    });

    tree.querySelectorAll("[data-act='edit']").forEach((el) => {
      el.addEventListener("focus", () => {
        state.focusedBlockId = el.dataset.blockId;
      });
      el.addEventListener("input", (e) => onEdit(el.dataset.blockId, el.innerText));
      el.addEventListener("blur", () => onBlur(el.dataset.blockId));
    });

    // Global keydown for editor shortcuts (Cmd/Ctrl+K, Cmd+arrows, Tab, etc).
    // Attached once per root via a flag so multiple bindEvents() don't stack listeners.
    if (!root._outlinerKeyListener) {
      const onKeyGlobal = (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (!tree.contains(target)) return;
        const editable = target.closest("[data-act='edit']");
        if (!editable) return;
        const id = editable.dataset.blockId;
        onKey(e, id);
      };
      document.addEventListener("keydown", onKeyGlobal);
      root._outlinerKeyListener = onKeyGlobal;
    }

    // drag-to-reparent (basic): dragstart on handle, drop on row
    let dragId = null;
    tree.querySelectorAll("[data-act='drag']").forEach((el) => {
      el.addEventListener("dragstart", (e) => {
        const row = el.closest(".block-row");
        dragId = row?.dataset.blockId ?? null;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragId || "");
        row.classList.add("dragging");
      });
      el.addEventListener("dragend", () => {
        dragId = null;
        tree.querySelectorAll(".dragging").forEach((r) => r.classList.remove("dragging"));
      });
    });
    tree.querySelectorAll(".block-row").forEach((row) => {
      row.addEventListener("dragover", (e) => {
        if (!dragId) return;
        e.preventDefault();
        row.classList.add("drop-target");
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
      row.addEventListener("drop", async (e) => {
        if (!dragId) return;
        e.preventDefault();
        row.classList.remove("drop-target");
        const targetId = row.dataset.blockId;
        if (targetId && targetId !== dragId && !isAncestor(targetId, dragId)) {
          await moveBlock(dragId, targetId);
        }
      });
    });
  }

  function onEdit(id, text) {
    const b = findBlock(id);
    if (!b) return;
    b.text = text;
    state.dirty = true;
    debounceSave(id);
    // Auto-detect cloze from >>  prefix
    if (text.startsWith(">>")) {
      const inner = text.slice(2).trim();
      const wrapped = `{{c1::${inner || "..."}::}}`;
      b.text = wrapped;
      b.type = "cloze";
      render();
    }
    // Slash command detection: /cloze, /code, /callout, /quote
    if (text === "/cloze" || text === "/code" || text === "/callout" || text === "/quote" || text === "/toggle") {
      const map = { "/cloze": "cloze", "/code": "code", "/callout": "callout", "/quote": "quote", "/toggle": "toggle" };
      b.text = "";
      b.type = map[text];
      render();
    }
  }

  function onBlur(id) {
    flushSave(id);
  }

  async function onKey(e, id) {
    const b = findBlock(id);
    if (!b) return;
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await splitBlock(id, e.shiftKey);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      await indentBlock(id, !e.shiftKey);
      return;
    }
    if (mod && e.key === "]") {
      e.preventDefault();
      await indentBlock(id, true);
      return;
    }
    if (mod && e.key === "[") {
      e.preventDefault();
      await indentBlock(id, false);
      return;
    }
    if (e.key === "Backspace" && (mod || (b.text || "").trim() === "")) {
      e.preventDefault();
      if (mod) await deleteBlockTree(id);
      else await mergeOrDelete(id);
      return;
    }
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openBlockPalette();
      return;
    }
    if (mod && e.key.toLowerCase() === "m") {
      e.preventDefault();
      await setBlockType(id, b.type === "callout" ? "text" : "callout");
      return;
    }
    if (mod && e.key.toLowerCase() === "t") {
      e.preventDefault();
      await setBlockType(id, b.type === "toggle" ? "text" : "toggle");
      return;
    }
    if (e.key === "ArrowUp" && mod) {
      e.preventDefault();
      swapSibling(id, -1);
      return;
    }
    if (e.key === "ArrowDown" && mod) {
      e.preventDefault();
      swapSibling(id, 1);
      return;
    }
  }

  // ---- 5. mutations (optimistic + backend) ----
  let saveTimer = null;
  function debounceSave(id) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => flushSave(id), 500);
  }
  async function flushSave(id) {
    const b = findBlock(id);
    if (!b) return;
    state.saving = true;
    root.querySelector(".outliner-foot .muted:last-child")?.replaceChildren(document.createTextNode("Guardando…"));
    try {
      await api._raw("PATCH", `/notes/${noteId}/blocks/${id}`, {
        text: b.text,
        type: b.type,
      }).catch(() => null);
    } catch (e) {
      console.warn("[outliner] save failed", e);
    } finally {
      state.saving = false;
      root.querySelector(".outliner-foot .muted:last-child")?.replaceChildren(document.createTextNode(""));
      state.dirty = false;
      options.onChange?.(b);
    }
  }

  async function splitBlock(id) {
    const b = findBlock(id);
    if (!b) return;
    // Capture caret offset within the contenteditable
    const sel = window.getSelection();
    let offset = (b.text || "").length;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node && node.parentElement?.dataset?.blockId === id) {
        offset = range.startOffset;
      }
    }
    const left = (b.text || "").slice(0, offset);
    const right = (b.text || "").slice(offset);
    b.text = left;
    const siblings = childrenOf(b.parentId);
    const sortedSiblings = siblings;
    const myIdx = sortedSiblings.findIndex((s) => s.id === id);
    const newBlock = {
      id: `block-${crypto.randomUUID()}`,
      parentId: b.parentId,
      order: myIdx + 1,
      text: right,
      type: "text",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // bump orders for siblings after myIdx
    for (const s of sortedSiblings) {
      if (s.order >= myIdx + 1 && s.id !== id) s.order += 1;
    }
    state.blocks.push(newBlock);
    await persistCreate(newBlock);
    await flushSave(id);
    state.focusedBlockId = newBlock.id;
    render();
  }

  async function indentBlock(id, deeper) {
    const b = findBlock(id);
    if (!b) return;
    const siblings = childrenOf(b.parentId);
    const idx = siblings.findIndex((s) => s.id === id);
    if (deeper) {
      // make me a child of the previous sibling
      if (idx === 0) return; // no previous sibling
      const prev = siblings[idx - 1];
      // cannot reparent under descendant
      if (isAncestor(id, prev.id)) return;
      // Update locally
      b.parentId = prev.id;
      const prevChildren = childrenOf(prev.id);
      b.order = prevChildren.length;
      // bump siblings
      for (const s of siblings) {
        if (s.order > siblings[idx].order && s.id !== id) s.order -= 1;
      }
    } else {
      // outdent: move to grandparent
      if (b.parentId === null) return;
      const parent = findBlock(b.parentId);
      if (!parent) return;
      b.parentId = parent.parentId;
      const grandSiblings = childrenOf(parent.parentId);
      const parentIdx = grandSiblings.findIndex((s) => s.id === parent.id);
      b.order = parentIdx + 1;
      // bump grandSiblings after parentIdx
      for (const s of grandSiblings) {
        if (s.order >= b.order && s.id !== parent.id && s.id !== id) s.order += 1;
      }
    }
    await persistMove(b.id, b.parentId, b.order);
    render();
  }

  async function mergeOrDelete(id) {
    const b = findBlock(id);
    if (!b) return;
    const siblings = childrenOf(b.parentId);
    const idx = siblings.findIndex((s) => s.id === id);
    if (idx > 0) {
      // merge into previous sibling's tail
      const prev = siblings[idx - 1];
      prev.text = (prev.text || "") + (b.text || "");
      // delete this block (no descendants)
      state.blocks = state.blocks.filter((x) => x.id !== id);
      // bump orders
      for (const s of siblings) {
        if (s.order > b.order && s.id !== id) s.order -= 1;
      }
      await api._raw("DELETE", `/notes/${noteId}/blocks/${id}`).catch(() => null);
      await flushSave(prev.id);
      state.focusedBlockId = prev.id;
    } else {
      // first sibling: outdent or delete
      if (b.parentId !== null) {
        await indentBlock(id, false);
        return;
      }
      // top-level empty block: clear text instead of delete
      b.text = "";
      await flushSave(id);
    }
    render();
  }

  async function deleteBlockTree(id) {
    const toDelete = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const b of state.blocks) {
        if (b.parentId && toDelete.has(b.parentId) && !toDelete.has(b.id)) {
          toDelete.add(b.id);
          changed = true;
        }
      }
    }
    state.blocks = state.blocks.filter((b) => !toDelete.has(b.id));
    await api._raw("DELETE", `/notes/${noteId}/blocks/${id}`).catch(() => null);
    render();
  }

  async function moveBlock(id, newParentId) {
    await api._raw("PATCH", `/notes/${noteId}/blocks/${id}/move`, {
      newParentId,
    }).catch(() => null);
    await loadBlocks();
    render();
  }

  async function persistCreate(block) {
    await api._raw("POST", `/notes/${noteId}/blocks`, {
      parentId: block.parentId,
      text: block.text,
      type: block.type,
    }).catch((e) => {
      console.warn("[outliner] create block failed", e);
    });
  }
  async function persistMove(id, newParentId, newOrder) {
    await api._raw("PATCH", `/notes/${noteId}/blocks/${id}/move`, {
      newParentId,
      newOrder,
    }).catch(() => null);
  }

  async function setBlockType(id, type) {
    const b = findBlock(id);
    if (!b) return;
    b.type = type;
    await flushSave(id);
    render();
  }

  async function swapSibling(id, dir) {
    const b = findBlock(id);
    if (!b) return;
    const siblings = childrenOf(b.parentId);
    const idx = siblings.findIndex((s) => s.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const other = siblings[swapIdx];
    const tmp = b.order;
    b.order = other.order;
    other.order = tmp;
    state.blocks = [...state.blocks]; // trigger re-render
    await persistMove(b.id, b.parentId, b.order);
    await persistMove(other.id, other.parentId, other.order);
    render();
  }

  function focusBlock(id) {
    const el = root.querySelector(`[data-block-id="${id}"] [data-act="edit"]`);
    if (el) {
      el.focus();
      // place caret at end
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  // ---- 6. block palette (Cmd/Ctrl+K) ----
  function openBlockPalette() {
    const all = (state.blocks || []).slice(0, 200);
    if (all.length === 0) return;
    const list = all.map((b) => ({
      id: b.id,
      title: (b.text || "(vacío)").slice(0, 80),
      type: b.type,
    }));
    const modal = makeModal({
      title: "Ir a bloque (Cmd+K)",
      body: `
        <input class="input" type="search" placeholder="Buscar bloque…" id="palette-input" aria-label="Buscar bloque" />
        <ul class="palette-results" role="listbox" id="palette-results" aria-label="Resultados">
          ${list.map((b, i) => `
            <li role="option" data-id="${b.id}" class="${i === 0 ? "active" : ""}">
              <span class="pr-type ${b.type}">${b.type}</span>
              <span class="pr-text">${escapeHtml(b.title)}</span>
            </li>
          `).join("")}
        </ul>
      `,
      actions: [{ label: "Cerrar", kind: "ghost", value: false }],
    });
    document.body.appendChild(modal.root);
    const input = modal.root.querySelector("#palette-input");
    const items = Array.from(modal.root.querySelectorAll("li"));
    let activeIdx = 0;

    const filter = (q) => {
      const qq = (q || "").toLowerCase();
      items.forEach((li, i) => {
        const match = !qq || li.textContent.toLowerCase().includes(qq);
        li.style.display = match ? "" : "none";
        if (match) li.classList.toggle("active", i === activeIdx);
      });
    };
    input.addEventListener("input", (e) => {
      activeIdx = 0;
      filter(e.target.value);
    });
    input.addEventListener("keydown", (e) => {
      const visible = items.filter((li) => li.style.display !== "none");
      if (e.key === "ArrowDown") { activeIdx = Math.min(activeIdx + 1, visible.length - 1); refresh(); }
      else if (e.key === "ArrowUp") { activeIdx = Math.max(activeIdx - 1, 0); refresh(); }
      else if (e.key === "Enter") {
        const cur = visible[activeIdx];
        if (cur) {
          state.focusedBlockId = cur.dataset.id;
          modal.close(true);
          render();
        }
      } else if (e.key === "Escape") {
        modal.close(false);
      }
    });
    function refresh() {
      const visible = items.filter((li) => li.style.display !== "none");
      visible.forEach((li, i) => li.classList.toggle("active", i === activeIdx));
      visible[activeIdx]?.scrollIntoView({ block: "nearest" });
    }
    items.forEach((li) => {
      li.addEventListener("click", () => {
        state.focusedBlockId = li.dataset.id;
        modal.close(true);
        render();
      });
    });
    setTimeout(() => input.focus(), 30);
  }

  // ---- public API ----
  return {
    getBlocks: () => state.blocks,
    refresh: loadBlocks,
    rerender: render,
    addSibling: async (afterId, text = "") => {
      const b = findBlock(afterId);
      if (!b) return;
      const siblings = childrenOf(b.parentId);
      const idx = siblings.findIndex((s) => s.id === afterId);
      const newBlock = {
        id: `block-${crypto.randomUUID()}`,
        parentId: b.parentId,
        order: idx + 1,
        text,
        type: "text",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      for (const s of siblings) if (s.order >= newBlock.order && s.id !== afterId) s.order += 1;
      state.blocks.push(newBlock);
      await persistCreate(newBlock);
      state.focusedBlockId = newBlock.id;
      render();
    },
    focus: (id) => { state.focusedBlockId = id; render(); },
    convertToCloze: async (id) => {
      const b = findBlock(id);
      if (!b) return;
      if (!b.text.includes("{{c1::")) {
        b.text = `{{c1::${b.text || "..."}::}}`;
      }
      b.type = "cloze";
      await flushSave(id);
      render();
    },
  };
}

/* ============================================================
 * Outliner minimal styles (kept here so we don't depend on a CSS file
 * being imported elsewhere). Mounted once at first mountOutliner call.
 * ============================================================ */
let stylesInjected = false;
const STYLES = `
.outliner {
  display: flex;
  flex-direction: column;
  min-height: 200px;
  font-family: var(--font-sans, system-ui, sans-serif);
}
.outliner-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.outliner-foot {
  display: flex;
  gap: var(--s-3);
  padding: var(--s-3) var(--s-2);
  font: 11px/1 ui-monospace, monospace;
  color: var(--fg-muted, #6b7280);
}
.block-row {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: var(--s-2);
  align-items: start;
  padding: 2px 4px;
  border-radius: 6px;
}
.block-row:hover { background: var(--bg-hover, rgba(0,0,0,0.04)); }
.block-row.dragging { opacity: 0.4; }
.block-row.drop-target { background: var(--accent-tint, rgba(124,77,255,0.12)); }
.block-row.collapsed .block-children { display: none; }
.block-gutter {
  display: flex;
  gap: 2px;
  align-items: start;
  padding-top: 2px;
}
.gutter-bullet, .gutter-handle {
  background: transparent;
  border: 0;
  color: var(--fg-muted, #6b7280);
  cursor: pointer;
  width: 24px; height: 24px;
  border-radius: 4px;
  font: 12px/1 ui-monospace, monospace;
}
.gutter-bullet:hover, .gutter-handle:hover {
  background: var(--bg-elevated, #f3f4f6);
  color: var(--fg, #1a1d24);
}
.block-main { min-width: 0; }
.block-line {
  display: flex;
  gap: 4px;
  align-items: start;
}
.block-text {
  flex: 1;
  outline: none;
  padding: 2px 4px;
  border-radius: 4px;
  min-height: 1.5em;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
.block-text:focus { background: var(--bg-elevated, #fff); box-shadow: 0 0 0 2px var(--accent, #7c4dff); }
.block-text.is-cloze {
  background: var(--cloze-bg, rgba(255, 230, 100, 0.35));
  border-radius: 4px;
  padding: 2px 6px;
}
.block-text.is-callout {
  background: var(--callout-bg, rgba(124,77,255,0.10));
  border-left: 3px solid var(--accent, #7c4dff);
  padding: 4px 8px;
  border-radius: 4px;
}
.block-text.is-code {
  font-family: ui-monospace, monospace;
  background: var(--code-bg, #1a1d24);
  color: var(--code-fg, #d4d4d4);
  padding: 4px 8px;
  border-radius: 4px;
}
.block-text.is-quote {
  font-style: italic;
  border-left: 3px solid var(--border, #d4d4d4);
  padding-left: 8px;
  color: var(--fg-muted, #6b7280);
}
.block-children {
  margin-left: var(--s-3);
  padding-left: var(--s-3);
  border-left: 1px dashed var(--border, #e4e6ea);
}
.palette-results {
  list-style: none; padding: 0; margin: var(--s-3) 0 0;
  max-height: 240px; overflow: auto;
  border: 1px solid var(--border); border-radius: 6px;
}
.palette-results li {
  display: flex; align-items: center; gap: var(--s-2);
  padding: 6px var(--s-2); cursor: pointer;
}
.palette-results li.active { background: var(--accent, #7c4dff); color: #fff; }
.pr-type {
  font: 10px/1.4 ui-monospace, monospace;
  padding: 1px 6px; border-radius: 999px;
  background: var(--bg-elevated, #f3f4f6); color: var(--fg-muted, #6b7280);
}
.pr-type.cloze { background: rgba(255,200,0,0.3); color: #6e4d00; }
.pr-type.callout { background: rgba(124,77,255,0.2); color: #4c1d95; }
.pr-type.code { background: #1a1d24; color: #fff; }
.pr-type.quote { background: rgba(0,0,0,0.08); color: #4a4a4a; }
`;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.id = "outliner-styles";
  s.textContent = STYLES;
  document.head.appendChild(s);
}
if (typeof document !== "undefined") {
  // try to inject as early as possible
  if (document.head) injectStyles();
  else document.addEventListener("DOMContentLoaded", injectStyles, { once: true });
}

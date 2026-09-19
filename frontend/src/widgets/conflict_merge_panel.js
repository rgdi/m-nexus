// conflict_merge_panel.js — Side-panel widget for v2.16.0 CRDT field-merge UI.
//
// Listens to 'sync:merged' events from sync_client.js (fired when the server
// resolves concurrent edits via field-level LWW). For each merge, builds a
// diff card showing:
//   - Resource type + ID
//   - Each merged field: "field: oldValue → newValue"
//   - Time + origin
//
// Stacks up to 5 cards in the right-side dock. Clicking the card opens the
// resource in the appropriate screen (notes/flashcards/etc.). A "Dismiss"
// button hides the card.

import { onMerge } from "../services/sync_client.js";

const PANEL_ID = "conflict-merge-panel";
const MAX_CARDS = 5;
const AUTO_DISMISS_MS = 30000;

let cards = [];

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel && document.body.contains(panel)) return panel;

  if (!document.getElementById("conflict-merge-styles")) {
    const style = document.createElement("style");
    style.id = "conflict-merge-styles";
    style.textContent = `
      .conflict-merge-panel {
        position: fixed;
        top: 80px;
        right: 20px;
        width: 360px;
        max-height: 70vh;
        background: var(--surface-1, #fff);
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.12);
        z-index: 9200;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--text, #111827);
        display: none;
        flex-direction: column;
        overflow: hidden;
      }
      .conflict-merge-panel.has-cards { display: flex; }
      .conflict-merge-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border, #e5e7eb);
        background: var(--surface-2, #f9fafb);
      }
      .conflict-merge-title {
        font-weight: 600;
        font-size: 13px;
      }
      .conflict-merge-clear {
        background: transparent;
        border: 0;
        color: var(--muted, #6b7280);
        cursor: pointer;
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 6px;
      }
      .conflict-merge-clear:hover {
        background: var(--hover, #f3f4f6);
        color: var(--text, #111827);
      }
      .conflict-merge-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .conflict-merge-empty {
        padding: 16px 12px;
        color: var(--muted, #6b7280);
        font-size: 12px;
        line-height: 1.5;
        text-align: center;
      }
      .conflict-card {
        border: 1px solid var(--border, #e5e7eb);
        border-radius: 10px;
        padding: 8px 10px;
        background: var(--surface-1, #fff);
        animation: cm-slide-in 0.2s ease-out;
      }
      @keyframes cm-slide-in {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .conflict-card-head {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
      }
      .conflict-card-type {
        font-weight: 600;
        font-size: 11px;
        padding: 1px 6px;
        background: var(--accent, #3b82f6);
        color: #fff;
        border-radius: 4px;
      }
      .conflict-card-id {
        font-family: ui-monospace, "SF Mono", monospace;
        font-size: 11px;
        color: var(--muted, #6b7280);
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .conflict-card-dismiss {
        background: transparent;
        border: 0;
        cursor: pointer;
        color: var(--muted, #6b7280);
        font-size: 14px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 4px;
      }
      .conflict-card-dismiss:hover {
        background: var(--hover, #f3f4f6);
        color: var(--text, #111827);
      }
      .conflict-card-meta {
        display: flex;
        gap: 8px;
        font-size: 10px;
        color: var(--muted, #6b7280);
        margin-bottom: 6px;
      }
      .conflict-card-fields {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .conflict-field-row {
        border-top: 1px dashed var(--border, #e5e7eb);
        padding-top: 6px;
      }
      .conflict-field-row:first-child { border-top: 0; padding-top: 0; }
      .conflict-field-head {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
      }
      .conflict-field-name {
        font-family: ui-monospace, "SF Mono", monospace;
        font-size: 11px;
        font-weight: 600;
        color: var(--text, #111827);
      }
      .conflict-field-badge {
        font-size: 10px;
        padding: 1px 5px;
        background: #fef3c7;
        color: #92400e;
        border-radius: 4px;
        font-weight: 500;
      }
      .conflict-field-diff {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 11px;
      }
      .conflict-field-prev {
        padding: 4px 6px;
        background: #fee2e2;
        color: #991b1b;
        border-radius: 4px;
        line-height: 1.4;
        word-break: break-word;
        white-space: pre-wrap;
      }
      .conflict-field-prev.empty {
        background: #f3f4f6;
        color: #6b7280;
        font-style: italic;
      }
      .conflict-field-arrow {
        color: var(--muted, #6b7280);
        font-size: 10px;
        text-align: center;
      }
      .conflict-field-new {
        padding: 4px 6px;
        background: #dcfce7;
        color: #166534;
        border-radius: 4px;
        line-height: 1.4;
        word-break: break-word;
        white-space: pre-wrap;
      }
      @media (max-width: 720px) {
        .conflict-merge-panel {
          top: auto;
          bottom: 20px;
          right: 10px;
          left: 10px;
          width: auto;
          max-height: 50vh;
        }
      }
    `;
    document.head.appendChild(style);
  }

  panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.className = "conflict-merge-panel";
  panel.setAttribute("aria-label", "Conflict merge notifications");
  panel.innerHTML = `
    <div class="conflict-merge-header">
      <span class="conflict-merge-title">Conflict merges</span>
      <button class="conflict-merge-clear" type="button" title="Clear all">Clear</button>
    </div>
    <div class="conflict-merge-list" data-list></div>
  `;
  document.body.appendChild(panel);

  panel.querySelector(".conflict-merge-clear").addEventListener("click", () => {
    cards = [];
    renderPanel();
  });

  return panel;
}

function relativeTime(ts) {
  const delta = Math.max(0, Date.now() - ts);
  if (delta < 5000) return "just now";
  if (delta < 60000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  return `${Math.floor(delta / 3600000)}h ago`;
}

function valuePreview(v) {
  if (v == null) return "(empty)";
  if (typeof v === "string") return v.length > 80 ? v.slice(0, 80) + "…" : v;
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}}`;
  }
  return String(v);
}

function fieldRow(field, mergedData, prevValue) {
  const newValue = mergedData[field];
  const hasPrev = prevValue !== undefined && prevValue !== null;
  const rendered =
    typeof newValue === "string"
      ? `<div class="conflict-field-new">${escapeHtml(newValue.length > 200 ? newValue.slice(0, 200) + "…" : newValue)}</div>`
      : `<code class="conflict-field-new">${escapeHtml(valuePreview(newValue))}</code>`;
  const prevRendered = hasPrev
    ? typeof prevValue === "string"
      ? `<div class="conflict-field-prev">${escapeHtml(prevValue.length > 200 ? prevValue.slice(0, 200) + "…" : prevValue)}</div>`
      : `<code class="conflict-field-prev">${escapeHtml(valuePreview(prevValue))}</code>`
    : `<div class="conflict-field-prev empty">(new field)</div>`;
  return `
    <div class="conflict-field-row">
      <div class="conflict-field-head">
        <span class="conflict-field-name">${escapeHtml(field)}</span>
        <span class="conflict-field-badge" title="Server applied incoming value (newer ts)">← merged</span>
      </div>
      <div class="conflict-field-diff">
        ${prevRendered}
        <div class="conflict-field-arrow">↓</div>
        ${rendered}
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function loadPreMergeValues(card) {
  // Fetch per-resource history and pick the most recent non-merged message
  // whose origin is different — that's the value before the current merge.
  try {
    const url = `http://localhost:4100/api/v1/sync/history/${encodeURIComponent(card.type)}/${encodeURIComponent(card.resourceId)}?limit=10`;
    const r = await fetch(url);
    if (!r.ok) return {};
    const j = await r.json();
    const history = Array.isArray(j.history) ? j.history : [];
    // Find the latest message before `card.ts` that also wrote one of these fields.
    const prev = history.find(
      (m) =>
        m && m.ts < card.ts && m.data && typeof m.data === "object" &&
        card.mergedFields.some((f) => f in m.data && f !== "__mergedFields"),
    );
    if (!prev) return {};
    const out = {};
    for (const f of card.mergedFields) {
      if (f in prev.data && f !== "__mergedFields") out[f] = prev.data[f];
    }
    return out;
  } catch {
    return {};
  }
}

async function renderPanel() {
  const panel = ensurePanel();
  const list = panel.querySelector("[data-list]");
  if (!cards.length) {
    panel.classList.remove("has-cards");
    list.innerHTML = `<div class="conflict-merge-empty">No conflicts. Field-level merges will appear here when concurrent edits arrive.</div>`;
    return;
  }
  panel.classList.add("has-cards");
  const html = await Promise.all(
    cards.slice(0, MAX_CARDS).map(async (c) => {
      const prevValues = await loadPreMergeValues(c);
      const fieldsHtml = c.mergedFields
        .filter((f) => f !== "__mergedFields")
        .map((f) => fieldRow(f, c.mergedData, prevValues[f]))
        .join("");
      return `
        <div class="conflict-card" data-id="${escapeAttr(c.id)}">
          <div class="conflict-card-head">
            <span class="conflict-card-type">${escapeHtml(c.type)}</span>
            <span class="conflict-card-id" title="${escapeAttr(c.resourceId)}">${escapeHtml(c.resourceId.slice(0, 16))}</span>
            <button class="conflict-card-dismiss" type="button" data-dismiss="${escapeAttr(c.id)}" title="Dismiss">✕</button>
          </div>
          <div class="conflict-card-meta">
            <span class="conflict-card-origin" title="Origin client">${escapeHtml(c.origin.slice(0, 8))}</span>
            <span class="conflict-card-time">${escapeHtml(relativeTime(c.ts))}</span>
          </div>
          <div class="conflict-card-fields">${fieldsHtml}</div>
        </div>
      `;
    }),
  );
  list.innerHTML = html.join("");

  list.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-dismiss");
      cards = cards.filter((c) => c.id !== id);
      renderPanel();
    });
  });
}

let installed = false;
export function installConflictMergePanel() {
  if (installed) return;
  installed = true;
  ensurePanel();
  renderPanel();
  onMerge((detail) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    cards = [
      { id, ...detail },
      ...cards,
    ].slice(0, MAX_CARDS);
    renderPanel();
    setTimeout(() => {
      cards = cards.filter((c) => c.id !== id);
      renderPanel();
    }, AUTO_DISMISS_MS);
  });
}

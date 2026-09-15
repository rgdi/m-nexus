/* ============================================================
 * flashcard_slash.js — `/flashcards` slash command popup.
 * v2.0.3 — popup que aparece mientras escribes `/flashcards`
 * en el text-layer o cualquier input. Permite crear flashcards
 * on the go, abrir/cerrar, dejar las pendientes como "unapproved".
 *
 * También hay botón "+ Card" en el toolbar del notebook.
 * ============================================================ */

const STYLE = `
.slash-popup {
  position: absolute;
  z-index: 150;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.25);
  padding: 12px;
  min-width: 320px;
  max-width: 480px;
}
.slash-popup .head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  font-size: var(--fs-sm);
  font-weight: 700;
}
.slash-popup .head .ico {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #fbbf24, #f59e0b);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px;
}
.slash-popup .input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sm);
  font-family: inherit;
  margin-bottom: 6px;
}
.slash-popup textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sm);
  font-family: inherit;
  resize: vertical;
  min-height: 50px;
  margin-bottom: 6px;
}
.slash-popup .pending {
  background: rgba(251,191,36,0.1);
  border: 1px dashed #fbbf24;
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
}
.slash-popup .pending h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #b45309;
}
.slash-popup .pending .pending-card {
  background: rgba(255,255,255,0.7);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
  font-size: 12px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.slash-popup .pending .pending-card .del {
  margin-left: auto;
  cursor: pointer;
  background: transparent;
  border: none;
  color: #b45309;
}
.slash-popup .actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.slash-popup .actions button {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: var(--fs-xs);
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  color: var(--fg);
  cursor: pointer;
}
.slash-popup .actions button.primary { background: var(--accent); color: white; border-color: transparent; }
.slash-popup .hint {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 6px;
}
`;

let slashStyleMounted = false;
let pendingCards = []; // in-memory queue before commit

/**
 * mountFlashcardSlash — attaches a global keydown listener that
 * opens the popup when the user types `/flashcards` in any text
 * field or contenteditable. Also adds a "+ Card" button next to
 * the notebook header that opens the popup directly.
 */
export function mountFlashcardSlash(rootEl, noteId, note) {
  if (!slashStyleMounted) {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    slashStyleMounted = true;
  }
  // "+ Card" button next to PDF
  const headerBtns = rootEl.querySelector(".row.gap-2");
  if (headerBtns && !rootEl.querySelector("#inline-card-btn")) {
    const btn = document.createElement("button");
    btn.id = "inline-card-btn";
    btn.className = "btn";
    btn.innerHTML = `🎴 ${i18nSafe("Quick card")}`;
    btn.style.cssText = "margin-left: 8px;";
    btn.addEventListener("click", () => {
      openSlashPopup(rootEl, noteId, note);
    });
    headerBtns.appendChild(btn);
  }
  // Global keydown listener — only once
  if (!window.__mnexusSlashMounted) {
    window.__mnexusSlashMounted = true;
    document.addEventListener("input", (e) => {
      const target = e.target;
      if (!target.matches("textarea, input, [contenteditable]")) return;
      const text = target.value || target.textContent || "";
      if (text.endsWith("/flashcards ")) {
        // open popup at caret
        openSlashPopupAtCaret(target, noteId, note);
        // clear the trigger
        if (target.value !== undefined) target.value = "";
        else target.textContent = "";
      }
    });
  }
}

function i18nSafe(key) {
  // avoid hard dep — fall back to English if i18n not loaded
  try {
    return (window.__i18n?.t?.(key)) || key;
  } catch { return key; }
}

function openSlashPopupAtCaret(target, noteId, note) {
  const rect = target.getBoundingClientRect();
  openSlashPopup(document.body, noteId, note, { x: rect.left, y: rect.bottom + window.scrollY });
}

export function openSlashPopup(rootEl, noteId, note, pos = null) {
  document.querySelectorAll(".slash-popup").forEach((p) => p.remove());
  const popup = document.createElement("div");
  popup.className = "slash-popup";
  if (pos) {
    popup.style.position = "fixed";
    popup.style.left = `${Math.min(pos.x, window.innerWidth - 400)}px`;
    popup.style.top = `${Math.min(pos.y, window.innerHeight - 400)}px`;
  } else {
    popup.style.position = "fixed";
    popup.style.right = "24px";
    popup.style.bottom = "120px";
  }
  popup.innerHTML = `
    <div class="head">
      <span class="ico">🎴</span>
      <span>Quick flashcard</span>
      <button class="btn icon" style="margin-left:auto" data-act="close">✕</button>
    </div>
    <input class="input" id="sc-front" placeholder="Front (question)…" />
    <textarea id="sc-back" placeholder="Back (answer)…"></textarea>
    <div class="actions">
      <button class="primary" data-act="add">+ Add to queue</button>
      <button data-act="commit">Commit all</button>
      <button data-act="clear">Clear</button>
    </div>
    <div class="pending" id="sc-pending" style="${pendingCards.length === 0 ? "display:none" : ""}">
      <h4>⏳ Pending (unapproved)</h4>
      <div id="sc-pending-list"></div>
    </div>
    <div class="hint">Cards stay pending until you click "Commit all". Unapproved cards are NOT pushed to study queue.</div>
  `;
  document.body.appendChild(popup);
  renderPending(popup);
  popup.querySelector('[data-act="close"]').addEventListener("click", () => popup.remove());
  popup.querySelector("#sc-front").focus();
  popup.querySelector("#sc-front").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      popup.querySelector("#sc-back").focus();
    }
  });
  popup.querySelector('[data-act="add"]').addEventListener("click", () => {
    const front = popup.querySelector("#sc-front").value.trim();
    const back = popup.querySelector("#sc-back").value.trim();
    if (!front || !back) return;
    pendingCards.push({ id: `pending-${Date.now()}`, front, back, noteId, approved: false });
    popup.querySelector("#sc-front").value = "";
    popup.querySelector("#sc-back").value = "";
    popup.querySelector("#sc-front").focus();
    renderPending(popup);
  });
  popup.querySelector('[data-act="commit"]').addEventListener("click", async () => {
    if (pendingCards.length === 0) return;
    // POST to backend as unapproved, then mark as approved via the UI
    let count = 0;
    for (const c of pendingCards) {
      try {
        await fetch("http://localhost:4100/api/v1/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ front: c.front, back: c.back, subject: note.subject, sourceNoteId: c.noteId, tags: ["unapproved"] }),
        });
        count++;
      } catch {}
    }
    pendingCards = [];
    renderPending(popup);
    alert(`✓ ${count} flashcards saved. They will appear in your library as "unapproved" until you approve them.`);
    popup.remove();
  });
  popup.querySelector('[data-act="clear"]').addEventListener("click", () => {
    pendingCards = [];
    renderPending(popup);
  });
}

function renderPending(popup) {
  const list = popup.querySelector("#sc-pending-list");
  const wrap = popup.querySelector("#sc-pending");
  if (pendingCards.length === 0) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "";
  list.innerHTML = pendingCards.map((c, i) => `
    <div class="pending-card">
      <span>🎴</span>
      <span><b>${escapeHtml(c.front.slice(0, 30))}</b> → ${escapeHtml(c.back.slice(0, 30))}</span>
      <button class="del" data-i="${i}">✕</button>
    </div>
  `).join("");
  list.querySelectorAll(".del").forEach((b) => {
    b.addEventListener("click", () => {
      pendingCards.splice(parseInt(b.dataset.i, 10), 1);
      renderPending(popup);
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

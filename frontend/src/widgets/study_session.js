/* ============================================================
 * study_session.js — study session UI estilo Anki.
 * v1.7.0 — card flip + 4 ratings + persist FSRS state.
 * ============================================================ */

const STYLE = `
.study {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: linear-gradient(135deg, #f6f7fb 0%, #e6e9f3 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--s-5);
  overflow-y: auto;
}
[data-theme="dark"] .study, @media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .study { background: linear-gradient(135deg, #0f1115 0%, #1a1d24 100%); color: #f0f0f0; }
}
.study .head { display: flex; align-items: center; gap: 16px; width: 100%; max-width: 720px; margin-bottom: var(--s-5); }
.study .head .prog { flex: 1; height: 6px; background: var(--bg-sunken); border-radius: 3px; overflow: hidden; }
.study .head .prog .fill { height: 100%; background: linear-gradient(90deg, #56c4e6, #8c5cf6); transition: width 350ms var(--ease); }
.study .head .counter { font-family: var(--font-mono); font-weight: 700; color: var(--fg-muted); }
.study .head button.close { width: 40px; height: 40px; border-radius: 50%; background: var(--bg-elevated); border: 1px solid var(--border); }

.study .card-wrap {
  width: 100%;
  max-width: 720px;
  perspective: 1500px;
  margin-bottom: var(--s-5);
}
.study .card {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 48px 32px;
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: clamp(20px, 3vw, 28px);
  line-height: 1.5;
  cursor: pointer;
  user-select: none;
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  transition: transform 400ms var(--ease);
  transform-style: preserve-3d;
}
.study .card.flipped { transform: rotateY(180deg); }
.study .card .face { backface-visibility: hidden; }
.study .card .back {
  position: absolute;
  inset: 0;
  padding: 48px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 24px;
  background: var(--bg-elevated);
  transform: rotateY(180deg);
  backface-visibility: hidden;
}
.study .card .face .label { font-size: 12px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: var(--s-3); }
.study .card .back .answer { font-size: clamp(18px, 2.5vw, 24px); color: var(--fg); }
.study .card .back .meta { font-size: 12px; color: var(--fg-muted); margin-top: var(--s-3); }

.study .ratings {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
  max-width: 720px;
}
.study .rate-btn {
  padding: 16px 8px;
  border-radius: 14px;
  font-weight: 700;
  font-size: var(--fs-md);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--fg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.study .rate-btn:hover { transform: translateY(-2px); }
.study .rate-btn .int { font-family: var(--font-mono); font-size: 11px; opacity: 0.7; }
.study .rate-btn.again { border-color: #dc2626; color: #dc2626; }
.study .rate-btn.hard  { border-color: #d97706; color: #d97706; }
.study .rate-btn.good  { border-color: #16a34a; color: #16a34a; }
.study .rate-btn.easy  { border-color: #2563eb; color: #2563eb; }
.study .rate-btn:hover.again { background: rgba(220,38,38,0.1); }
.study .rate-btn:hover.hard  { background: rgba(217,119,6,0.1); }
.study .rate-btn:hover.good  { background: rgba(22,197,94,0.1); }
.study .rate-btn:hover.easy  { background: rgba(37,99,235,0.1); }

.study .empty-state {
  text-align: center;
  padding: 80px 20px;
  max-width: 480px;
}
.study .empty-state .emoji { font-size: 64px; margin-bottom: var(--s-4); }
.study .empty-state h2 { margin: 0 0 var(--s-3); font-size: 24px; }
.study .empty-state p { color: var(--fg-muted); margin: 0 0 var(--s-5); }
.study .empty-state button {
  padding: 12px 24px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 12px;
  font-weight: 600;
  font-size: 16px;
  cursor: pointer;
}

.study .stats {
  display: flex;
  gap: 16px;
  margin-bottom: var(--s-4);
  max-width: 720px;
  width: 100%;
}
.study .stat-pill {
  flex: 1;
  text-align: center;
  padding: 8px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.study .stat-pill .v { font-weight: 700; font-size: var(--fs-lg); }
.study .stat-pill .l { font-size: 11px; color: var(--fg-muted); }
`;

const KEY = "mnexus.fsrs.cards.v1";

function loadAllCardStates() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}
function saveAllCardStates(states) {
  localStorage.setItem(KEY, JSON.stringify(states));
}
function getCardState(cardId) {
  const all = loadAllCardStates();
  return all[cardId] || null;
}
function setCardState(cardId, fsrs) {
  const all = loadAllCardStates();
  all[cardId] = fsrs;
  saveAllCardStates(all);
}

/**
 * openStudySession — abre pantalla fullscreen de estudio.
 * @param cards Array de flashcards (con .id, .front, .back)
 */
export async function openStudySession(cards) {
  if (!document.getElementById("study-styles")) {
    const s = document.createElement("style");
    s.id = "study-styles";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const root = document.createElement("div");
  root.className = "study";
  document.body.appendChild(root);

  // Mezclar FSRS state en cada card
  const queue = cards.map((c) => ({
    ...c,
    fsrs: getCardState(c.id) || { stability: 0, difficulty: 0, lastReview: 0, due: Date.now(), reps: 0, lapses: 0, state: "new" },
  }));

  // Stats globales
  let reviewed = 0, correct = 0, total = queue.length;

  function render() {
    if (queue.length === 0) {
      renderDone();
      return;
    }
    const card = queue[0];
    const showBack = card._showBack === true;
    const { initCard, review, FSRS_RATINGS } = window.__mnexusFsrs || {};
    // Use FSRS module via dynamic import (or re-import)
    renderCard(card, showBack);
  }

  function renderCard(card, showBack) {
    const pct = total > 0 ? ((reviewed) / total) * 100 : 0;
    root.innerHTML = `
      <div class="head">
        <button class="close" data-act="close">✕</button>
        <div class="prog"><div class="fill" style="width:${pct}%"></div></div>
        <div class="counter">${reviewed + 1}/${total}</div>
      </div>
      <div class="stats">
        <div class="stat-pill"><div class="v">${correct}</div><div class="l">Correct</div></div>
        <div class="stat-pill"><div class="v">${reviewed - correct}</div><div class="l">Wrong</div></div>
        <div class="stat-pill"><div class="v">${total - reviewed}</div><div class="l">Left</div></div>
      </div>
      <div class="card-wrap">
        <div class="card ${showBack ? "flipped" : ""}" data-act="flip">
          <div class="face">
            <div class="label">Front · ${escapeHtml(card.subject || "general")}</div>
            <div class="question">${escapeHtml(card.front)}</div>
          </div>
          <div class="back">
            <div class="label">Back</div>
            <div class="answer">${escapeHtml(card.back)}</div>
            ${card.sourceNoteId ? `<div class="meta">from ${escapeHtml(card.sourceNoteId.slice(0, 18))}</div>` : ""}
          </div>
        </div>
      </div>
      <div class="ratings">
        <button class="rate-btn again" data-rate="1"><span class="int">1</span>Again</button>
        <button class="rate-btn hard"  data-rate="2"><span class="int">2</span>Hard</button>
        <button class="rate-btn good"  data-rate="3"><span class="int">3</span>Good</button>
        <button class="rate-btn easy"  data-rate="4"><span class="int">4</span>Easy</button>
      </div>
    `;
    bindCard(card);
  }

  function bindCard(card) {
    root.querySelector('[data-act="close"]').addEventListener("click", () => root.remove());
    const flipEl = root.querySelector('[data-act="flip"]');
    if (flipEl) {
      flipEl.addEventListener("click", () => {
        card._showBack = true;
        flipEl.classList.add("flipped");
      });
    }
    root.querySelectorAll(".rate-btn").forEach((b) => {
      b.addEventListener("click", async () => {
        const rating = parseInt(b.dataset.rate, 10);
        await gradeCard(card, rating);
      });
    });
    // keyboard
    const onKey = (e) => {
      if (e.key === " " || e.key === "Enter") {
        if (!card._showBack) {
          card._showBack = true;
          flipEl.classList.add("flipped");
        }
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        gradeCard(card, parseInt(e.key, 10));
      } else if (e.key === "Escape") {
        root.remove();
        document.removeEventListener("keydown", onKey);
      }
    };
    document.addEventListener("keydown", onKey);
    // Cleanup on rerender
    card._cleanupKey = () => document.removeEventListener("keydown", onKey);
  }

  async function gradeCard(card, rating) {
    if (card._cleanupKey) card._cleanupKey();
    const { review } = await import("../services/fsrs.js");
    const updated = review(card.fsrs, rating);
    setCardState(card.id, updated);
    reviewed++;
    if (rating >= 3) correct++;
    queue.shift();
    render();
  }

  function renderDone() {
    root.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🎉</div>
        <h2>Session complete</h2>
        <p>${correct} correct out of ${reviewed}.</p>
        <button data-act="close">Close</button>
      </div>
    `;
    root.querySelector('[data-act="close"]').addEventListener("click", () => root.remove());
  }

  if (queue.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <h2>No cards to study</h2>
        <p>Create some flashcards first, or come back when more are due.</p>
        <button data-act="close">Close</button>
      </div>
    `;
    root.querySelector('[data-act="close"]').addEventListener("click", () => root.remove());
    return;
  }

  render();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

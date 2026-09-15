/* ============================================================
 * exam_runner.js — UI del examen.
 * v2.0.5 — wizard: scope → review → session.
 * ============================================================ */

const STYLE = `
.exam-wizard {
  position: fixed;
  inset: 0;
  z-index: 250;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-5);
  backdrop-filter: blur(6px);
}
.exam-wizard .panel {
  background: var(--bg-elevated);
  border-radius: 20px;
  padding: var(--s-6);
  max-width: 720px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
}
.exam-wizard h2 { margin: 0 0 var(--s-4); }
.exam-wizard .scope-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: var(--s-4);
}
.exam-wizard .scope-grid .opt {
  padding: 14px;
  border-radius: 12px;
  background: var(--bg-sunken);
  border: 2px solid transparent;
  cursor: pointer;
  text-align: left;
}
.exam-wizard .scope-grid .opt:hover { background: var(--bg); }
.exam-wizard .scope-grid .opt.selected { border-color: var(--accent); background: rgba(86,196,230,0.1); }
.exam-wizard .scope-grid .opt .ico { font-size: 24px; }
.exam-wizard .scope-list {
  max-height: 280px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px;
  background: var(--bg-sunken);
  margin-bottom: var(--s-4);
}
.exam-wizard .scope-list .opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
}
.exam-wizard .scope-list .opt:hover { background: var(--bg); }
.exam-wizard .scope-list .opt.selected { background: rgba(86,196,230,0.18); }
.exam-wizard .scope-list .opt .badge {
  margin-left: auto;
  font-size: 11px;
  color: var(--fg-muted);
}
.exam-wizard .actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: auto;
}
.exam-wizard .actions button {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg-sunken);
  color: var(--fg);
  cursor: pointer;
}
.exam-wizard .actions button.primary { background: var(--accent); color: white; border-color: transparent; }
.exam-wizard .actions button:disabled { opacity: 0.4; cursor: not-allowed; }

.exam-runner { display: flex; flex-direction: column; gap: 14px; }
.exam-runner .progress {
  display: flex; gap: 12px; align-items: center;
}
.exam-runner .progress .bar {
  flex: 1; height: 8px; background: var(--bg-sunken);
  border-radius: 4px; overflow: hidden;
}
.exam-runner .progress .fill {
  height: 100%; background: linear-gradient(90deg, #56c4e6, #8c5cf6);
  transition: width 350ms var(--ease);
}
.exam-runner .q {
  background: var(--bg-sunken);
  padding: 24px;
  border-radius: 14px;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 20px;
  cursor: pointer;
  border: 2px solid transparent;
}
.exam-runner .q.flipped { border-color: var(--accent); }
.exam-runner .q .label { font-size: 11px; color: var(--fg-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.08em; }
.exam-runner .q .answer { color: var(--accent); margin-top: 14px; }
.exam-runner .rating-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
}
.exam-runner .rating-row button {
  padding: 12px;
  border-radius: 10px;
  border: 2px solid var(--border);
  background: var(--bg-elevated);
  font-weight: 600;
  cursor: pointer;
}
.exam-runner .rating-row button.again { border-color: #dc2626; color: #dc2626; }
.exam-runner .rating-row button.hard  { border-color: #d97706; color: #d97706; }
.exam-runner .rating-row button.good  { border-color: #16a34a; color: #16a34a; }
.exam-runner .rating-row button.easy  { border-color: #2563eb; color: #2563eb; }
.exam-runner .summary {
  text-align: center;
  padding: var(--s-5) 0;
}
.exam-runner .summary .score { font-size: 56px; font-weight: 800; margin: 12px 0; }
.exam-runner .summary .lbl { color: var(--fg-muted); margin-bottom: var(--s-4); }
`;

import { buildExam, recordAnswer, loadHistory, EXAM_MODES } from "../services/exams.js";
import { initCard, review } from "../services/fsrs.js";

let styleMounted = false;

/**
 * openExamWizard — modal con selector de scope + mode + start.
 */
export async function openExamWizard(allCards, allOcc = []) {
  if (!styleMounted) {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    styleMounted = true;
  }

  // Build scope options
  const subjects = [...new Set(allCards.map((c) => c.subject).filter(Boolean))];
  const notes = [...new Set(allCards.map((c) => c.sourceNoteId).filter(Boolean))];

  const scrim = document.createElement("div");
  scrim.className = "exam-wizard";
  scrim.innerHTML = `
    <div class="panel">
      <h2>📋 Generate Exam</h2>
      <p class="muted small">Pick a scope and a mode. University mode ensures full coverage of all topics before repeating.</p>
      <h3>1. Choose mode</h3>
      <div class="scope-grid">
        <div class="opt selected" data-mode="university">
          <div class="ico">🎓</div>
          <div><b>University</b><div class="muted tiny">Full syllabus coverage · prioritize weak</div></div>
        </div>
        <div class="opt" data-mode="review">
          <div class="ico">📊</div>
          <div><b>Review</b><div class="muted tiny">Difficult cards · spaced repetition</div></div>
        </div>
        <div class="opt" data-mode="cram">
          <div class="ico">⚡</div>
          <div><b>Cram</b><div class="muted tiny">Rapid-fire random</div></div>
        </div>
      </div>
      <h3>2. Choose scope type</h3>
      <div class="scope-grid">
        <div class="opt selected" data-kind="all">
          <div class="ico">🎲</div>
          <div><b>All cards</b><div class="muted tiny">${allCards.length} cards</div></div>
        </div>
        <div class="opt" data-kind="subject">
          <div class="ico">📚</div>
          <div><b>By subject</b><div class="muted tiny">${subjects.length} subjects</div></div>
        </div>
        <div class="opt" data-kind="note">
          <div class="ico">📓</div>
          <div><b>By note</b><div class="muted tiny">${notes.length} notes</div></div>
        </div>
      </div>
      <div id="scope-list-wrap"></div>
      <div class="actions">
        <button data-act="cancel">Cancel</button>
        <button class="primary" data-act="start">Start exam →</button>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);

  let selected = { kind: "all", value: null, mode: "university" };

  function renderList() {
    const wrap = scrim.querySelector("#scope-list-wrap");
    if (selected.kind === "all") {
      wrap.innerHTML = "";
      return;
    }
    if (selected.kind === "subject") {
      wrap.innerHTML = `
        <h3>3. Pick a subject</h3>
        <div class="scope-list">
          ${subjects.map((s) => `
            <div class="opt ${s === selected.value ? "selected" : ""}" data-v="${s}">
              <span>📚</span>
              <span><b>${escapeHtml(s)}</b></span>
              <span class="badge">${allCards.filter((c) => c.subject === s).length} cards</span>
            </div>
          `).join("")}
        </div>
      `;
    } else if (selected.kind === "note") {
      wrap.innerHTML = `
        <h3>3. Pick a note</h3>
        <div class="scope-list">
          ${notes.map((n) => `
            <div class="opt ${n === selected.value ? "selected" : ""}" data-v="${n}">
              <span>📓</span>
              <span><b>${escapeHtml(n.slice(0, 18))}…</b></span>
              <span class="badge">${allCards.filter((c) => c.sourceNoteId === n).length} cards</span>
            </div>
          `).join("")}
        </div>
      `;
    }
    wrap.querySelectorAll(".opt").forEach((o) => {
      o.addEventListener("click", () => {
        selected.value = o.dataset.v;
        renderList();
      });
    });
  }
  scrim.querySelectorAll(".scope-grid .opt[data-mode]").forEach((o) => {
    o.addEventListener("click", () => {
      scrim.querySelectorAll(".scope-grid .opt[data-mode]").forEach((x) => x.classList.remove("selected"));
      o.classList.add("selected");
      selected.mode = o.dataset.mode;
    });
  });
  scrim.querySelectorAll(".scope-grid .opt[data-kind]").forEach((o) => {
    o.addEventListener("click", () => {
      scrim.querySelectorAll(".scope-grid .opt[data-kind]").forEach((x) => x.classList.remove("selected"));
      o.classList.add("selected");
      selected.kind = o.dataset.kind;
      if (selected.kind === "all") selected.value = null;
      renderList();
    });
  });
  scrim.querySelector('[data-act="cancel"]').addEventListener("click", () => scrim.remove());
  scrim.querySelector('[data-act="start"]').addEventListener("click", async () => {
    if (selected.kind !== "all" && !selected.value) {
      alert("Please pick a scope");
      return;
    }
    const exam = await buildExam(selected, allCards, allOcc, { mode: selected.mode });
    if (exam.items.length === 0) {
      alert("No cards in this scope. Add some flashcards first.");
      return;
    }
    scrim.remove();
    openExamSession(exam);
  });
}

/**
 * openExamSession — UI estilo Anki para responder el examen.
 */
function openExamSession(exam) {
  const scrim = document.createElement("div");
  scrim.className = "exam-wizard";
  scrim.innerHTML = `
    <div class="panel">
      <div class="exam-runner">
        <div class="progress">
          <span><b id="ex-pos">1</b>/${exam.items.length}</span>
          <div class="bar"><div class="fill" id="ex-fill" style="width:0%"></div></div>
          <button class="btn icon" data-act="exit" title="Exit">✕</button>
        </div>
        <div class="q" id="ex-q">
          <div class="label">Click to reveal</div>
          <div id="ex-front"></div>
          <div class="answer" id="ex-back" style="display:none"></div>
        </div>
        <div class="rating-row" id="ex-rating" style="display:none">
          <button class="again" data-r="1">✗ Again</button>
          <button class="hard"  data-r="2">Hard</button>
          <button class="good"  data-r="3">✓ Good</button>
          <button class="easy"  data-r="4">Easy</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);

  let i = 0, correct = 0;
  const q = scrim.querySelector("#ex-q");
  const front = scrim.querySelector("#ex-front");
  const back = scrim.querySelector("#ex-back");
  const fill = scrim.querySelector("#ex-fill");
  const pos = scrim.querySelector("#ex-pos");
  const rating = scrim.querySelector("#ex-rating");

  function show() {
    if (i >= exam.items.length) return finish();
    const it = exam.items[i];
    front.textContent = it.card.front;
    back.textContent = it.card.back;
    q.classList.remove("flipped");
    back.style.display = "none";
    rating.style.display = "none";
    pos.textContent = i + 1;
    fill.style.width = `${(i / exam.items.length) * 100}%`;
  }

  q.addEventListener("click", () => {
    q.classList.add("flipped");
    back.style.display = "block";
    rating.style.display = "grid";
  });

  scrim.querySelectorAll(".rating-row button").forEach((b) => {
    b.addEventListener("click", () => {
      const r = parseInt(b.dataset.r, 10);
      const it = exam.items[i];
      // FSRS update
      const fsrsKey = `mnexus.fsrs.cards.v1`;
      const all = JSON.parse(localStorage.getItem(fsrsKey) || "{}");
      const cur = all[it.card.id] || initCard();
      const updated = review(cur, r);
      all[it.card.id] = updated;
      try { localStorage.setItem(fsrsKey, JSON.stringify(all)); } catch {}
      recordAnswer(it.card.id, r >= 3);
      if (r >= 3) correct++;
      i++;
      show();
    });
  });
  scrim.querySelector('[data-act="exit"]').addEventListener("click", () => scrim.remove());

  function finish() {
    const modeLabel = exam.mode === "university" ? "🎓 University" : exam.mode === "cram" ? "⚡ Cram" : "📊 Review";
    const coverageInfo = exam.totalTopics
      ? `<p class="muted">Coverage: <b>${exam.coveredTopics}/${exam.totalTopics} topics</b> (${Math.round(exam.coverage * 100)}%) — cards you got wrong will appear more often.</p>`
      : `<p class="muted">Cards you got wrong will appear more often next time. Recently seen cards are excluded.</p>`;
    scrim.querySelector(".exam-runner").innerHTML = `
      <div class="summary">
        <div class="score">${correct}/${exam.items.length}</div>
        <div class="lbl">${Math.round((correct / exam.items.length) * 100)}% correct</div>
        <div class="muted small" style="margin-bottom: 12px">${modeLabel}</div>
        ${coverageInfo}
        <button class="btn primary" data-act="close" style="margin-top: 16px">Close</button>
      </div>
    `;
    scrim.querySelector('[data-act="close"]').addEventListener("click", () => scrim.remove());
  }

  show();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

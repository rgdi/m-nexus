/* ============================================================
 * cloze_test.js — open cloze deletion tests estilo Anki.
 * v1.8.1 — el usuario ve una pregunta con [___] y escribe la respuesta.
 * Compara con fuzzy match. Asocia a note.sourceNoteId.
 *
 * Soporta sintaxis `{{c1::pregunta::respuesta}}` en el body de la nota
 * y crea tests interactivos.
 * ============================================================ */

const STYLE = `
.cloze-test {
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
[data-theme="dark"] .cloze-test,
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .cloze-test { background: linear-gradient(135deg, #0f1115 0%, #1a1d24 100%); color: #f0f0f0; }
}
.cloze-test .head { display: flex; align-items: center; gap: 16px; width: 100%; max-width: 720px; margin-bottom: var(--s-5); }
.cloze-test .head .prog { flex: 1; height: 6px; background: var(--bg-sunken); border-radius: 3px; overflow: hidden; }
.cloze-test .head .prog .fill { height: 100%; background: linear-gradient(90deg, #56c4e6, #8c5cf6); transition: width 350ms var(--ease); }
.cloze-test .head .counter { font-family: var(--font-mono); font-weight: 700; color: var(--fg-muted); }
.cloze-test .head button.close { width: 40px; height: 40px; border-radius: 50%; background: var(--bg-elevated); border: 1px solid var(--border); }

.cloze-test .prompt {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 48px 32px;
  min-height: 280px;
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: clamp(18px, 2.5vw, 24px);
  line-height: 1.6;
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  margin-bottom: var(--s-4);
}
.cloze-test .prompt .label { font-size: 12px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: var(--s-3); }
.cloze-test .blank {
  display: inline-block;
  min-width: 120px;
  border-bottom: 2px solid var(--accent);
  margin: 0 4px;
  padding: 0 8px;
  color: var(--accent);
  font-weight: 700;
}
.cloze-test .prompt .input-row { display: flex; gap: 8px; margin-top: var(--s-4); width: 100%; max-width: 480px; }
.cloze-test .prompt input {
  flex: 1;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  font-size: var(--fs-md);
  background: var(--bg-elevated);
  color: var(--fg);
}
.cloze-test .prompt button {
  padding: 12px 20px;
  border: none;
  border-radius: 12px;
  background: var(--accent);
  color: white;
  font-weight: 600;
  cursor: pointer;
}

.cloze-test .feedback {
  margin-top: var(--s-4);
  padding: 12px 20px;
  border-radius: 12px;
  font-weight: 600;
}
.cloze-test .feedback.correct { background: rgba(34,197,94,0.15); color: #16a34a; }
.cloze-test .feedback.wrong { background: rgba(220,38,38,0.15); color: #dc2626; }

.cloze-test .actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  width: 100%;
  max-width: 720px;
}
.cloze-test .act-btn {
  padding: 16px 8px;
  border-radius: 14px;
  font-weight: 700;
  font-size: var(--fs-md);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--fg);
  cursor: pointer;
}
.cloze-test .act-btn.correct { border-color: #16a34a; color: #16a34a; }
.cloze-test .act-btn.wrong { border-color: #dc2626; color: #dc2626; }
.cloze-test .act-btn.skip { border-color: var(--fg-muted); color: var(--fg-muted); }

.cloze-test .empty-state {
  text-align: center;
  padding: 80px 20px;
  max-width: 480px;
}
.cloze-test .empty-state .emoji { font-size: 64px; margin-bottom: var(--s-4); }
.cloze-test .empty-state h2 { margin: 0 0 var(--s-3); font-size: 24px; }
`;

/**
 * openClozeTest — extrae todos los `{{c1::pregunta::respuesta}}` del body
 * de una nota y los presenta como tests interactivos.
 */
export async function openClozeTest(note) {
  if (!document.getElementById("cloze-styles")) {
    const s = document.createElement("style");
    s.id = "cloze-styles";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  const re = /\{\{c1::([^}]+?)\}\}/g;
  const matches = [...((note.body || "").matchAll(re))].map((m) => {
    const [front, back] = m[1].split("::").map((s) => s.trim());
    return { front: front || "", back: back || "", sourceNoteId: note.id, subject: note.subject || "general" };
  });

  const root = document.createElement("div");
  root.className = "cloze-test";
  document.body.appendChild(root);

  let idx = 0;
  let correct = 0;
  const total = matches.length;

  function render() {
    if (idx >= total) {
      root.innerHTML = `
        <div class="empty-state">
          <div class="emoji">${correct / total >= 0.7 ? "🎉" : "📚"}</div>
          <h2>Test finished</h2>
          <p>${correct} / ${total} correct (${Math.round((correct / total) * 100)}%)</p>
          <button class="act-btn" data-act="close" style="margin: 0 auto">Close</button>
        </div>
      `;
      root.querySelector('[data-act="close"]').addEventListener("click", () => root.remove());
      return;
    }

    const m = matches[idx];
    const pct = (idx / total) * 100;
    // prompt with [___] instead of the answer
    const promptHtml = m.front.replace(/__+/g, '<span class="blank" id="cloze-blank">________</span>');
    root.innerHTML = `
      <div class="head">
        <button class="close" data-act="close">✕</button>
        <div class="prog"><div class="fill" style="width:${pct}%"></div></div>
        <div class="counter">${idx + 1}/${total}</div>
      </div>
      <div class="prompt">
        <div class="label">Cloze · ${escapeHtml(m.subject)}</div>
        <div>${promptHtml}</div>
        <div class="input-row">
          <input id="cloze-input" placeholder="Type your answer..." autocomplete="off" />
          <button id="cloze-submit">Check</button>
        </div>
        <div class="feedback" id="cloze-feedback" style="display:none"></div>
      </div>
      <div class="actions">
        <button class="act-btn wrong" data-act="wrong">❌ I was wrong</button>
        <button class="act-btn skip" data-act="skip">⏭ Skip</button>
        <button class="act-btn correct" data-act="right">✓ I was right</button>
      </div>
    `;

    const input = root.querySelector("#cloze-input");
    const submit = root.querySelector("#cloze-submit");
    const feedback = root.querySelector("#cloze-feedback");
    const blank = root.querySelector("#cloze-blank");

    function checkAnswer() {
      const userAns = (input.value || "").trim().toLowerCase();
      const correctAns = m.back.toLowerCase();
      const isOk = userAns === correctAns || correctAns.includes(userAns) || userAns.includes(correctAns);
      if (isOk) {
        blank.textContent = m.back;
        blank.style.color = "#16a34a";
        feedback.textContent = `✓ Correct! ${m.back}`;
        feedback.className = "feedback correct";
        feedback.style.display = "block";
        correct++;
        setTimeout(next, 1200);
      } else {
        blank.textContent = m.back;
        blank.style.color = "#dc2626";
        feedback.textContent = `✗ The answer is "${m.back}"`;
        feedback.className = "feedback wrong";
        feedback.style.display = "block";
        setTimeout(next, 2000);
      }
    }
    function next() {
      idx++;
      render();
    }

    submit.addEventListener("click", checkAnswer);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") checkAnswer();
      if (e.key === "Escape") root.remove();
    });
    input.focus();

    root.querySelector('[data-act="close"]').addEventListener("click", () => root.remove());
    root.querySelector('[data-act="right"]').addEventListener("click", () => {
      correct++;
      next();
    });
    root.querySelector('[data-act="wrong"]').addEventListener("click", () => {
      blank.textContent = m.back;
      blank.style.color = "#dc2626";
      feedback.textContent = `✗ The answer is "${m.back}"`;
      feedback.className = "feedback wrong";
      feedback.style.display = "block";
      setTimeout(next, 1800);
    });
    root.querySelector('[data-act="skip"]').addEventListener("click", next);
  }

  if (total === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <h2>No cloze deletions</h2>
        <p>Add <code>{{c1::pregunta::respuesta}}</code> to the note body to create tests.</p>
        <button class="act-btn" data-act="close" style="margin: 0 auto">Close</button>
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

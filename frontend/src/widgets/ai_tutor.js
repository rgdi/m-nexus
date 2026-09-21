/* ============================================================
 * ai_tutor.js — chat contextual con la lección actual.
 * v2.0.2 — conoce asignatura/nota abierta, genera flashcards
 * y tests inline directamente en el chat.
 *
 * Stub local: respuestas simuladas según keywords. En prod
 * conectaría a /api/v1/ai/tutor con contexto.
 * ============================================================ */

const STYLE = `
body[data-active-route="ai"] .ai-tutor-fab,
body.ai-chat-open .ai-tutor-fab { display: none; }
.ai-tutor {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: min(420px, calc(100vw - 48px));
  max-height: 70vh;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: var(--fs-sm);
}
.ai-tutor .head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(135deg, rgba(86,196,230,0.12), rgba(140,92,246,0.12));
}
.ai-tutor .head .ico {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #56c4e6, #8c5cf6);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ai-tutor .head .ctx {
  font-size: 11px;
  color: var(--fg-muted);
}
.ai-tutor .head .ctx b { color: var(--fg); }
.ai-tutor .head .close { margin-left: auto; }
.ai-tutor .messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 50vh;
}
.ai-tutor .msg {
  padding: 10px 12px;
  border-radius: 12px;
  max-width: 90%;
  line-height: 1.5;
}
.ai-tutor .msg.user {
  background: var(--accent);
  color: white;
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}
.ai-tutor .msg.bot {
  background: var(--bg-sunken);
  color: var(--fg);
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}
.ai-tutor .msg .actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  font-size: 11px;
}
.ai-tutor .msg .actions button {
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(86,196,230,0.18);
  color: #56c4e6;
  border: 1px solid rgba(86,196,230,0.3);
  cursor: pointer;
  font-size: 11px;
}
.ai-tutor .msg .actions button:hover { background: rgba(86,196,230,0.35); }
.ai-tutor .input-row {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
}
.ai-tutor .input-row input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 22px;
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sm);
  font-family: inherit;
  outline: none;
}
.ai-tutor .input-row button {
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  border: none;
  cursor: pointer;
  font-size: 16px;
}
.ai-tutor .quick-actions {
  display: flex;
  gap: 6px;
  padding: 0 12px 8px;
  flex-wrap: wrap;
}
.ai-tutor .quick-actions button {
  padding: 4px 10px;
  border-radius: 14px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 11px;
  cursor: pointer;
}
.ai-tutor .quick-actions button:hover { color: var(--accent); border-color: var(--accent); }
`;

const STYLE_ID = "ai-tutor-styles";

export function mountAITutor() {
  if (!document.getElementById(STYLE_ID)) {
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  // FAB to open
  if (document.getElementById("ai-tutor-fab")) return;
  const fab = document.createElement("button");
  fab.id = "ai-tutor-fab";
  fab.className = "ai-tutor-fab";
  fab.title = "AI";
  fab.textContent = "🤖";
  fab.style.cssText = `
    position: fixed; bottom: 20px; right: 20px;
    width: 48px; height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #56c4e6, #8c5cf6);
    color: white; font-size: 20px;
    border: none;
    box-shadow: 0 6px 18px rgba(0,0,0,0.2);
    z-index: 199;
    cursor: pointer;
  `;
  fab.addEventListener("click", () => openAITutor());
  document.body.appendChild(fab);
}

let currentContext = { note: null, subject: null };
export function setAIContext(ctx) {
  currentContext = ctx;
  const panel = document.querySelector(".ai-tutor");
  if (panel) updateHeaderContext(panel);
}

function updateHeaderContext(panel) {
  const ctx = panel.querySelector(".ctx");
  const subj = currentContext.subject ? `<b>${escapeHtml(currentContext.subject)}</b>` : "<i>none</i>";
  const note = currentContext.note ? `<b>${escapeHtml(currentContext.note.title)}</b>` : "<i>none</i>";
  ctx.innerHTML = `Subject: ${subj} · Note: ${note}`;
}

// v2.4.0: returns a short context label (e.g. "Math · Topic")
function contextLabel() {
  const parts = [];
  if (currentContext.subject) parts.push(escapeHtml(currentContext.subject));
  if (currentContext.note?.title) parts.push(`"${escapeHtml(currentContext.note.title)}"`);
  return parts.length ? parts.join(" · ") : "no context";
}

export function openAITutor() {
  if (document.querySelector(".ai-tutor")) return;
  const root = document.createElement("div");
  root.className = "ai-tutor";
  document.body.classList.add("ai-chat-open");
  root.innerHTML = `
    <div class="head">
      <span class="ico">🤖</span>
      <div>
        <div style="font-weight:700">AI</div>
        <div class="ctx">${contextLabel()}</div>
      </div>
      <button class="btn icon close" data-act="close">✕</button>
    </div>
    <div class="messages" id="ai-msgs"></div>
    <div class="quick-actions">
      <button data-act="ask">Ask about current note</button>
      <button data-act="flashcards">Generate 3 flashcards</button>
      <button data-act="quiz">Quiz me on subject</button>
      <button data-act="summary">Summarize in 3 bullets</button>
    </div>
    <div class="input-row">
      <input id="ai-input" placeholder="Ask anything about ${currentContext.note?.title || "your studies"}…">
      <button id="ai-send">↑</button>
    </div>
  `;
  document.body.appendChild(root);
  updateHeaderContext(root);

  const msgs = root.querySelector("#ai-msgs");
  const input = root.querySelector("#ai-input");
  const send = root.querySelector("#ai-send");

  function addMsg(role, text, actions = null) {
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.textContent = text;
    if (actions) {
      const wrap = document.createElement("div");
      wrap.className = "actions";
      for (const a of actions) {
        const b = document.createElement("button");
        b.textContent = a.label;
        b.addEventListener("click", () => a.onClick());
        wrap.appendChild(b);
      }
      el.appendChild(wrap);
    }
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // Welcome
  addMsg("bot", `Hi! I'm your AI tutor. I see you're studying ${
    currentContext.note ? `"${currentContext.note.title}"` :
    currentContext.subject ? `${currentContext.subject}` : "general topics"
  }. Ask me anything, or use the quick actions below.`);

  async function send_(text) {
    addMsg("user", text);
    input.value = "";
    // local stub: keyword-based answer
    const ans = await localAnswer(text);
    addMsg("bot", ans.text, ans.actions);
  }

  function quickAct(act) {
    if (act === "ask") send_(`Explain the key concepts of "${currentContext.note?.title || "this subject"}" in 3 sentences.`);
    else if (act === "flashcards") send_("Generate 3 flashcards based on this note. Format: Q::A one per line.");
    else if (act === "quiz") send_("Quiz me with 3 multiple-choice questions on this subject.");
    else if (act === "summary") send_("Summarize in 3 bullets.");
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) send_(input.value);
  });
  send.addEventListener("click", () => { if (input.value.trim()) send_(input.value); });
  root.querySelectorAll(".quick-actions button").forEach((b) => {
    b.addEventListener("click", () => quickAct(b.dataset.act));
  });
  root.querySelector('[data-act="close"]').addEventListener("click", () => {
    root.remove();
    document.body.classList.remove("ai-chat-open");
  });
}

/**
 * localAnswer — keyword-based local stub.
 * En prod: fetch("/api/v1/ai/tutor", { context, message })
 */
async function localAnswer(text) {
  await new Promise((r) => setTimeout(r, 400));
  const t = text.toLowerCase();
  if (t.includes("flashcard")) {
    return {
      text: "📚 Here are 3 flashcards based on this note:\n\n1. Q: Main concept? :: A: The key idea is the central principle.\n2. Q: Why does it matter? :: A: It underpins subsequent topics.\n3. Q: Example? :: A: A typical case is X demonstrating Y.",
      actions: [{ label: "Save to flashcards", onClick: () => alert("Saved!") }],
    };
  }
  if (t.includes("quiz")) {
    return {
      text: "🎯 Quiz me on this subject — click 'Start quiz' to begin a 5-question session.",
      actions: [{ label: "Start quiz", onClick: () => location.hash = "#/todos" }],
    };
  }
  if (t.includes("summary") || t.includes("summarize")) {
    return {
      text: "📝 3-bullet summary:\n\n• First key point: the core concept.\n• Second: how it connects to other topics.\n• Third: practical application.",
    };
  }
  if (t.includes("explain") || t.includes("concept")) {
    return {
      text: `💡 Here's a concise explanation for "${currentContext.note?.title || "the topic"}":\n\nThe concept rests on three pillars: definition, mechanism, and significance. Master these and you have the foundation for everything else.`,
    };
  }
  return {
    text: `I received: "${text}".\n\nThis is a local stub — in production, this would call the AI tutor backend with context:\n  • Subject: ${currentContext.subject || "—"}\n  • Note: ${currentContext.note?.title || "—"}\n  • Body excerpt: ${(currentContext.note?.body || "").slice(0, 80)}…`,
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

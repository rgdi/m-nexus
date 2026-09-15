/* ============================================================
 * screens/ai.js — AI screen with contextual quick actions.
 * v2.4.0 — Detects current page (note/subject/calendar/todo) and
 * exposes relevant actions: Generate Clozes, Summarize, etc.
 * ============================================================ */

import { api } from "../services/api.js";
import { i18n } from "../services/i18n.js";
import { dataSource } from "../services/dataSource.js";
import { escapeHtml } from "../services/safe.js";

const history = []; // [{ role, content }] session-only chat history

/**
 * Get the current AI context — what page/note/subject is the user
 * looking at right now? Read from window globals set by other screens.
 */
function getContext() {
  const ctx = window.__mnexusAIContext ?? {};
  return {
    note: ctx.note || null,
    subject: ctx.subject || null,
    route: window.__mnexusActiveRoute || "ai",
  };
}

/**
 * Quick actions shown above the chat. Each one is contextual:
 * - On Notes page → Generate Clozes, Summarize Note, Make Flashcards
 * - On Subjects → Generate Summary
 * - On Calendar → Suggest Schedule
 * - On Todos → Prioritize
 * - No context → generic help
 */
function getQuickActions(ctx) {
  const actions = [];
  if (ctx.note) {
    actions.push({
      icon: "✨",
      label: i18n.t("ai.action.clozes") || "Generate Clozes",
      run: async () => sendAIPrompt(
        `Generate cloze-deletion cards from this note:\n\n${ctx.note.body || ctx.note.title || ""}`,
      ),
    });
    actions.push({
      icon: "📝",
      label: i18n.t("ai.action.summarize") || "Summarize Note",
      run: async () => sendAIPrompt(
        `Summarize this note in 5 bullet points:\n\n${ctx.note.body || ctx.note.title || ""}`,
      ),
    });
    actions.push({
      icon: "🎴",
      label: i18n.t("ai.action.flashcards") || "Make Flashcards",
      run: async () => makeFlashcardsFromNote(ctx.note.id),
    });
  } else if (ctx.subject) {
    actions.push({
      icon: "📚",
      label: i18n.t("ai.action.subject") || `Study ${ctx.subject}`,
      run: async () => sendAIPrompt(
        `Help me study ${ctx.subject}. What are the key concepts?`,
      ),
    });
  }
  // Always-available actions
  actions.push({
    icon: "💡",
    label: i18n.t("ai.action.explain") || "Explain concept",
    run: async () => sendAIPrompt("Explain a concept I just learned today."),
  });
  return actions;
}

async function makeFlashcardsFromNote(noteId) {
  // Inline: extract {{c1::...}} cloze cards, call backend extractor, render result.
  try {
    const r = await fetch(`${api.base}/notes/${noteId}/extract-flashcards`, { method: "POST" });
    if (r.ok) {
      const { created, skipped } = await r.json();
      const msg = `Extracted ${created.length} flashcard(s)${skipped ? ` (${skipped} skipped)` : ""}.`;
      renderAssistantMessage(msg);
    } else {
      renderAssistantMessage("Could not extract flashcards (offline?).");
    }
  } catch {
    renderAssistantMessage("Cannot reach backend.");
  }
}

let _sendAIPrompt = null;
function setSendPrompt(fn) { _sendAIPrompt = fn; }

async function sendAIPrompt(prompt) {
  if (_sendAIPrompt) return _sendAIPrompt(prompt);
}

export async function renderAI(root) {
  const ctx = getContext();
  const actions = getQuickActions(ctx);
  const ctxLabel = ctx.note?.title
    ? `"${escapeHtml(ctx.note.title)}"`
    : ctx.subject
    ? escapeHtml(ctx.subject)
    : "no context";

  root.innerHTML = `
    <div class="screen ai-screen">
      <header class="screen-header">
        <h1 class="h-title">${i18n.t("ai.title") || "AI"}</h1>
        <span class="h-sub">${i18n.t("ai.subtitle") || "Contextual assistant"}</span>
      </header>

      <div class="card ai-context-card">
        <div class="ctx-line">
          <span class="ctx-label">${i18n.t("ai.lookingAt") || "Looking at"}:</span>
          <span class="ctx-value">${ctxLabel}</span>
        </div>
      </div>

      <div class="ai-quick-actions" id="quick-actions">
        ${actions.map((a, i) => `
          <button class="ai-action-card" data-i="${i}">
            <span class="ai-action-icon">${a.icon}</span>
            <span class="ai-action-label">${escapeHtml(a.label)}</span>
          </button>
        `).join("")}
      </div>

      <div class="card ai-chat-card">
        <div id="messages"></div>
        <form id="form" class="ai-input-row">
          <input class="input" id="input" placeholder="${i18n.t("ai.placeholder") || "Ask anything..."}" autocomplete="off" />
          <button class="btn primary" type="submit">${i18n.t("ai.send") || "Send"}</button>
        </form>
      </div>
    </div>
  `;

  // Wire quick actions
  root.querySelectorAll(".ai-action-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = actions[Number(btn.dataset.i)];
      if (action?.run) action.run();
    });
  });

  const messages = root.querySelector("#messages");
  const form = root.querySelector("#form");
  const input = root.querySelector("#input");

  function renderMessageEl(m) {
    const who = m.role === "user" ? "user" : "ai";
    const bg = who === "user" ? "var(--bg-sunken)" : "var(--accent-soft)";
    const fg = who === "user" ? "var(--fg)" : "var(--accent)";
    const wrapper = document.createElement("div");
    wrapper.className = `ai-msg ai-msg-${who}`;
    wrapper.innerHTML = `
      ${who === "ai" ? `<div class="ai-avatar">✦</div>` : ""}
      <div class="ai-bubble">${escapeHtml(m.content)}</div>
    `;
    return wrapper;
  }

  function rerender() {
    messages.innerHTML = "";
    history.forEach((m) => messages.appendChild(renderMessageEl(m)));
    messages.scrollTop = messages.scrollHeight;
  }

  function renderAssistantMessage(text) {
    history.push({ role: "ai", content: text });
    rerender();
  }

  function pushUserThenStream(userText) {
    history.push({ role: "user", content: userText });
    rerender();
    const placeholder = { role: "ai", content: "..." };
    history.push(placeholder);
    rerender();
    return placeholder;
  }

  async function send(text) {
    const placeholder = pushUserThenStream(text);
    try {
      let reply;
      try {
        const r = await api.ai.chat(history.slice(0, -2));
        reply = r?.message ?? r?.content ?? JSON.stringify(r);
      } catch {
        reply = offlineReply(text);
      }
      placeholder.content = reply;
    } catch (err) {
      placeholder.content = `Error: ${err.message}`;
    }
    rerender();
  }

  // Connect external actions to this send()
  setSendPrompt(send);

  // Greeting (only first time)
  if (history.length === 0) {
    history.push({ role: "ai", content: i18n.t("ai.greeting") || "Hi! I'm your AI tutor. Ask me anything about your studies." });
    rerender();
  } else {
    rerender();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await send(text);
  });
}

function offlineReply(q) {
  return `(offline) ${q.slice(0, 80)}…`;
}

/**
 * Allow other screens to set the context that renderAI will detect.
 */
export function setAIContext(ctx) {
  window.__mnexusAIContext = { ...(window.__mnexusAIContext || {}), ...ctx };
}

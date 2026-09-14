/* ============================================================
 * screens/ai.js — AI tutor chat panel
 * v1.3.0 — i18n integration
 * ============================================================ */

import { api } from "../services/api.js";
import { i18n } from "../services/i18n.js";

const history = []; // [{ role, content }]

export async function renderAI(root) {
  root.innerHTML = `
    <div class="screen" style="max-width: 800px">
      <header class="screen-header">
        <h1 class="h-title">${i18n.t("ai.title")}</h1>
        <span class="h-sub">${i18n.t("ai.subtitle")}</span>
      </header>

      <div class="card" style="height: calc(100vh - 320px); min-height: 480px; display:flex; flex-direction:column; padding: 0">
        <div id="messages" style="flex:1; overflow:auto; padding: var(--s-4)"></div>
        <form id="form" style="display:flex; gap: var(--s-2); padding: var(--s-3); border-top: 1px solid var(--border)">
          <input class="input" id="input" placeholder="${i18n.t("ai.placeholder")}" autocomplete="off" />
          <button class="btn primary" type="submit">${i18n.t("ai.send")}</button>
        </form>
      </div>
    </div>
  `;

  const messages = root.querySelector("#messages");
  const form = root.querySelector("#form");
  const input = root.querySelector("#input");

  function renderMessage(m) {
    const who = m.role === "user" ? "user" : "ai";
    const bg = who === "user" ? "var(--bg-sunken)" : "var(--accent-soft)";
    const fg = who === "user" ? "var(--fg)" : "var(--accent)";
    return `
      <div class="row gap-2" style="justify-content:${who === "user" ? "flex-end" : "flex-start"}; margin-bottom: var(--s-3)">
        ${who === "ai" ? `<div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">✦</div>` : ""}
        <div style="max-width: 75%; background:${bg}; color:${fg}; padding: var(--s-3) var(--s-4); border-radius: var(--r-3); white-space: pre-wrap; line-height:1.5">${escapeHtml(m.content)}</div>
      </div>
    `;
  }
  function rerender() {
    messages.innerHTML = history.map(renderMessage).join("");
    messages.scrollTop = messages.scrollHeight;
  }

  // Greeting
  history.push({ role: "ai", content: i18n.t("ai.greeting") });
  rerender();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    history.push({ role: "user", content: text });
    input.value = "";
    rerender();
    // Streaming placeholder
    const placeholder = { role: "ai", content: "..." };
    history.push(placeholder);
    rerender();

    try {
      // Try backend; fall back to offline canned reply.
      let reply;
      try {
        const r = await api.ai.chat(history.slice(0, -2));
        reply = r?.message ?? r?.content ?? JSON.stringify(r);
      } catch {
        reply = offlineReply(text);
      }
      placeholder.content = reply;
    } catch (err) {
      placeholder.content = i18n.t("ai.error", { msg: err.message });
    }
    rerender();
  });
}

function offlineReply(q) {
  // Canned reply when backend is unavailable
  return i18n.t("ai.offline");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

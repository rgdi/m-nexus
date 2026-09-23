/* ============================================================
 * widgets/smart_notifications.js — Smart retention-predictive notifications.
 *
 *   - Calls /api/v1/notifications-smart/generate with the user's cards
 *   - Polls pending notifications every 60s
 *   - Displays a "card" with severity emoji + title + body
 *   - Buttons: Mark as read / Dismiss / Open
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();
const POLL_MS = 60_000;

let pollTimer = null;
let currentCards = [];

export function mountSmartNotifications(host, opts = {}) {
  const onStudy = opts.onStudy ?? (() => {});
  host.innerHTML = `
    <section class="smart-notifs" aria-labelledby="sn-title">
      <header class="sn-header">
        <h2 id="sn-title">🔔 Smart Notifications</h2>
        <button class="sn-btn" data-action="generate" type="button">🔄 Generar ahora</button>
      </header>
      <p class="sn-subtitle">Push predictivo basado en retención FSRS-7.</p>
      <ul class="sn-list" data-list role="region" aria-label="Notificaciones pendientes"></ul>
    </section>
  `;
  const list = host.querySelector("[data-list]");
  const genBtn = host.querySelector('[data-action="generate"]');

  genBtn.addEventListener("click", () => generate());

  async function generate() {
    try {
      genBtn.disabled = true;
      genBtn.textContent = "⏳ Generando...";
      const r = await fetch(`${BASE}/api/v1/notifications-smart/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cards: currentCards,
          targetRetention: 0.9,
          horizonDays: 14,
        }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      await refresh();
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    } finally {
      genBtn.disabled = false;
      genBtn.textContent = "🔄 Generar ahora";
    }
  }

  async function refresh() {
    try {
      const r = await fetch(`${BASE}/api/v1/notifications-smart`);
      const data = await r.json();
      render(data.notifications ?? []);
    } catch (e) {
      console.warn("[smart-notifs] refresh failed", e);
    }
  }

  function render(notifications) {
    list.innerHTML = "";
    if (notifications.length === 0) {
      list.innerHTML = `<li class="sn-empty">✅ Sin notificaciones urgentes. Buen trabajo.</li>`;
      return;
    }
    for (const n of notifications) {
      const li = document.createElement("li");
      li.className = `sn-item sn-item--${n.severity} ${n.read ? "sn-item--read" : ""}`;
      li.innerHTML = `
        <header class="sn-item-header">
          <span class="sn-severity sn-severity--${n.severity}">${severityEmoji(n.severity)} ${n.severity.toUpperCase()}</span>
          <time class="sn-time">${formatTime(n.generatedAt)}</time>
        </header>
        <h3 class="sn-title">${escapeHtml(n.title)}</h3>
        <p class="sn-body">${escapeHtml(n.body)}</p>
        <div class="sn-actions">
          ${n.cardIds.length > 0 ? `<button data-action="study" type="button">📖 Estudiar (${n.cardIds.length})</button>` : ""}
          <button data-action="read" type="button">✓ Marcar leído</button>
          <button data-action="dismiss" type="button">🗑 Descartar</button>
        </div>
      `;
      li.querySelector('[data-action="study"]')?.addEventListener("click", () => {
        onStudy(n.cardIds);
        fetch(`${BASE}/api/v1/notifications-smart/${n.id}/read`, { method: "POST" });
        refresh();
      });
      li.querySelector('[data-action="read"]').addEventListener("click", async () => {
        await fetch(`${BASE}/api/v1/notifications-smart/${n.id}/read`, { method: "POST" });
        li.classList.add("sn-item--read");
        refresh();
      });
      li.querySelector('[data-action="dismiss"]').addEventListener("click", async () => {
        await fetch(`${BASE}/api/v1/notifications-smart/${n.id}/dismiss`, { method: "POST" });
        li.remove();
      });
      list.appendChild(li);
    }
  }

  function severityEmoji(s) {
    return { critical: "🚨", warning: "📌", info: "⏳", success: "✅" }[s] ?? "📨";
  }

  function formatTime(ts) {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "ahora";
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h`;
    return `${Math.floor(m / 1440)}d`;
  }

  pollTimer = setInterval(refresh, POLL_MS);
  refresh();

  return {
    setCards(cards) { currentCards = cards; },
    refresh,
    destroy() {
      clearInterval(pollTimer);
      host.innerHTML = "";
    },
  };
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".sn-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "sn-toast";
    document.body.appendChild(t);
  }
  t.classList.toggle("sn-toast--error", isError);
  t.textContent = msg;
  t.classList.add("sn-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("sn-toast--show"), 2500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

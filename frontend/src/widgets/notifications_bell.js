/* ============================================================
 * widgets/notifications_bell.js — Bell icon con badge + dropdown.
 *
 * v2.32.0 — Muestra notificaciones inteligentes generadas por el
 * backend (FSRS-7 predictivo + streak + cards dominadas).
 *
 * - Mount into a host element
 * - Polls every 30s + manual refresh button
 * - Click bell → dropdown with severity-coded items
 * - Mark as seen on click
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

const SEVERITY_EMOJI = {
  danger: "🚨",
  warning: "⚠️",
  info: "ℹ️",
  success: "✅",
};

const TYPE_LABEL = {
  "card-at-risk": "Card en riesgo",
  "daily-briefing": "Briefing diario",
  "streak-danger": "Streak en peligro",
  "card-mastered": "Card dominada",
  "session-recommendation": "Sesión recomendada",
};

export function mountNotificationBell(host) {
  // IMPORTANT: use appendChild (not host.innerHTML = ...) so we don't wipe
  // existing children of the host (which may include the SPA's #app mount).
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="notif-bell" aria-live="polite">
      <button class="notif-bell-btn" data-bell type="button" aria-label="Notificaciones">
        🔔
        <span class="notif-bell-badge" data-badge hidden>0</span>
      </button>
      <div class="notif-dropdown" data-dropdown hidden role="menu">
        <header class="notif-dropdown-header">
          <h3>Notificaciones</h3>
          <button class="notif-btn" data-refresh type="button" aria-label="Refrescar">↻</button>
        </header>
        <div class="notif-list" data-list role="list">
          <p class="notif-empty">Sin notificaciones por ahora.</p>
        </div>
        <footer class="notif-dropdown-footer">
          <button class="notif-btn-primary" data-generate type="button">
            🧠 Generar notificaciones (FSRS-7)
          </button>
        </footer>
      </div>
    </div>
  `;
  while (wrapper.firstChild) host.appendChild(wrapper.firstChild);

  const bellBtn = host.querySelector("[data-bell]");
  const badge = host.querySelector("[data-badge]");
  const dropdown = host.querySelector("[data-dropdown]");
  const listEl = host.querySelector("[data-list]");
  const refreshBtn = host.querySelector("[data-refresh]");
  const generateBtn = host.querySelector("[data-generate]");

  let open = false;
  let pollTimer = null;

  async function fetchCount() {
    try {
      const r = await fetch(`${BASE}/api/v1/smart-notifications/unseen/count?userId=demo-user`);
      const j = await r.json();
      const c = j.count ?? 0;
      if (c > 0) {
        badge.textContent = String(c > 99 ? "99+" : c);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    } catch {}
  }

  async function fetchList() {
    try {
      const r = await fetch(`${BASE}/api/v1/smart-notifications?userId=demo-user`);
      const j = await r.json();
      const items = j.notifications ?? [];
      renderList(items);
    } catch (e) {
      console.warn("[notif] list failed", e);
    }
  }

  function renderList(items) {
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.innerHTML = `<p class="notif-empty">Sin notificaciones por ahora.</p>`;
      return;
    }
    for (const n of items) {
      const li = document.createElement("button");
      li.className = `notif-item notif-item--${n.severity} ${n.seenAt ? "notif-item--seen" : ""}`;
      li.dataset.notifId = n.id;
      li.type = "button";
      li.setAttribute("role", "menuitem");
      li.innerHTML = `
        <span class="notif-emoji">${SEVERITY_EMOJI[n.severity] ?? "•"}</span>
        <div class="notif-content">
          <strong class="notif-title">${escapeHtml(n.title)}</strong>
          <p class="notif-body">${escapeHtml(n.body)}</p>
          <small class="notif-meta">${TYPE_LABEL[n.type] ?? n.type} · ${formatDate(n.createdAt)}</small>
        </div>
        ${n.link ? `<span class="notif-arrow" aria-hidden="true">→</span>` : ""}
      `;
      li.addEventListener("click", async () => {
        if (!n.seenAt) {
          await fetch(`${BASE}/api/v1/smart-notifications/${encodeURIComponent(n.id)}/seen`, { method: "POST" });
          n.seenAt = Date.now();
          fetchCount();
          renderList(items);
        }
        if (n.link) location.hash = n.link.replace(/^#/, "");
      });
      listEl.appendChild(li);
    }
  }

  bellBtn.addEventListener("click", () => {
    open = !open;
    dropdown.hidden = !open;
    if (open) fetchList();
  });

  // Auto-close when route changes
  const closeHandler = () => {
    open = false;
    dropdown.hidden = true;
  };
  window.addEventListener("hashchange", closeHandler);
  // SPA also navigates without hashchange (it intercepts and dispatches its own)
  document.addEventListener("click", (e) => {
    if (!dropdown.hidden && !e.target.closest(".notif-bell")) {
      closeHandler();
    }
  });

  refreshBtn.addEventListener("click", () => fetchList());

  generateBtn.addEventListener("click", async () => {
    generateBtn.disabled = true;
    generateBtn.textContent = "⏳ Generando…";
    try {
      const cardsR = await fetch(`${BASE}/api/v1/flashcards`);
      const cardsJ = await cardsR.json();
      const cards = (cardsJ.cards ?? []).map((c) => ({
        id: c.id,
        card: {
          stability: c.fsrs?.stability ?? 0,
          difficulty: c.fsrs?.difficulty ?? 5,
          state: c.fsrs?.state ?? "new",
          lastReview: c.fsrs?.lastReview ?? 0,
          due: c.fsrs?.due ?? 0,
          reps: c.fsrs?.reps ?? 0,
          lapses: c.fsrs?.lapses ?? 0,
          elapsed: 0,
        },
      }));
      await fetch(`${BASE}/api/v1/smart-notifications/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "demo-user", cards }),
      });
      await fetchList();
      await fetchCount();
    } catch (e) {
      showToast(`❌ ${e.message}`, true);
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "🧠 Generar notificaciones (FSRS-7)";
    }
  });

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(fetchCount, 30_000);
  }

  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  fetchCount();
  startPolling();

  return {
    refresh: async () => { await fetchCount(); await fetchList(); },
    destroy() {
      stopPolling();
      host.innerHTML = "";
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return "ahora";
  if (diff < 3600_000) return `${Math.floor(diff / 60000)} min`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h`;
  return d.toLocaleDateString();
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".notif-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "notif-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("notif-toast--error", isError);
  t.textContent = msg;
  t.classList.add("notif-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("notif-toast--show"), 2500);
}

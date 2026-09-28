/* ============================================================
 * widgets/notifications_bell.js — Bell icon con badge + dropdown.
 *
 * v2.32.0 — Muestra notificaciones inteligentes generadas por el
 * backend (FSRS-7 predictivo + streak + cards dominadas).
 *
 * v2.34.1 — UX/UI polish:
 *   - SVG bell icon (instead of emoji) for crisp rendering
 *   - Fixed top-right next to peer-pill, no overlap
 *   - "Ring" animation on the bell when there are unseen notifications
 *   - Pulse dot on the bell button
 *   - Better dropdown: sticky header + sticky footer + scrollable list
 *   - Higher z-index than peer-pill (z: 200) so dropdown wins
 *   - Mobile: full-width sheet-style dropdown at top
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";
import { icon as svgIcon } from "./icons.js";

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
        <span class="notif-bell-icon" data-icon>🔔</span>
        <span class="notif-bell-pulse" data-pulse hidden></span>
        <span class="notif-bell-badge" data-badge hidden>0</span>
      </button>
      <div class="notif-dropdown" data-dropdown hidden role="menu" aria-label="Notificaciones">
        <header class="notif-dropdown-header">
          <div class="notif-header-left">
            <span class="notif-header-icon" data-icon-header></span>
            <h3>Notificaciones</h3>
            <span class="notif-count-chip" data-count-chip hidden>0</span>
          </div>
          <div class="notif-header-actions">
            <button class="notif-icon-btn" data-refresh type="button" aria-label="Refrescar" title="Refrescar">↻</button>
            <button class="notif-icon-btn" data-config type="button" aria-label="Configurar" title="Configurar">⚙</button>
          </div>
        </header>
        <div class="notif-list" data-list role="list">
          <div class="notif-empty">
            <div class="notif-empty-icon">🌿</div>
            <p class="notif-empty-title">Sin notificaciones por ahora.</p>
            <p class="notif-empty-sub">Pulsa "Generar" para que el FSRS-7 analice tus cards.</p>
          </div>
        </div>
        <footer class="notif-dropdown-footer">
          <button class="notif-btn-ghost" data-mark-all type="button">✓ Marcar todas leídas</button>
          <button class="notif-btn-primary" data-generate type="button">
            <span data-icon-gen></span>
            <span>Generar (FSRS-7)</span>
          </button>
        </footer>
      </div>
    </div>
  `;
  while (wrapper.firstChild) host.appendChild(wrapper.firstChild);

  // Inline SVG strings (no module dependency — guarantees the bell renders
  // even if the icons module is cached or missing the `bell` key).
  const BELL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a6 6 0 0 0-6 6v3.5l-2 3.5h16l-2-3.5V8a6 6 0 0 0-6-6z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>';
  const BELL_SVG_SM = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a6 6 0 0 0-6 6v3.5l-2 3.5h16l-2-3.5V8a6 6 0 0 0-6-6z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>';
  const SPARK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z"/></svg>';

  const iconHolder = host.querySelector("[data-icon]");
  if (iconHolder) iconHolder.innerHTML = BELL_SVG;
  const iconHeader = host.querySelector("[data-icon-header]");
  if (iconHeader) iconHeader.innerHTML = BELL_SVG_SM;
  const iconGen = host.querySelector("[data-icon-gen]");
  if (iconGen) iconGen.innerHTML = SPARK_SVG;

  const bellBtn = host.querySelector("[data-bell]");
  const badge = host.querySelector("[data-badge]");
  const pulse = host.querySelector("[data-pulse]");
  const dropdown = host.querySelector("[data-dropdown]");
  const listEl = host.querySelector("[data-list]");
  const refreshBtn = host.querySelector("[data-refresh]");
  const generateBtn = host.querySelector("[data-generate]");
  const markAllBtn = host.querySelector("[data-mark-all]");
  const configBtn = host.querySelector("[data-config]");
  const countChip = host.querySelector("[data-count-chip]");

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
        pulse.hidden = false;
        bellBtn.classList.add("notif-bell-btn--has-unseen");
        countChip.textContent = String(c);
        countChip.hidden = false;
      } else {
        badge.hidden = true;
        pulse.hidden = true;
        bellBtn.classList.remove("notif-bell-btn--has-unseen");
        countChip.hidden = true;
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
      listEl.innerHTML = `
        <div class="notif-empty">
          <div class="notif-empty-icon">🌿</div>
          <p class="notif-empty-title">Sin notificaciones por ahora.</p>
          <p class="notif-empty-sub">Pulsa "Generar" para que el FSRS-7 analice tus cards.</p>
        </div>
      `;
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
          try {
            await fetch(`${BASE}/api/v1/smart-notifications/${encodeURIComponent(n.id)}/seen`, { method: "POST" });
          } catch {}
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
    if (open) {
      fetchList();
      bellBtn.classList.remove("notif-bell-btn--has-unseen");
      pulse.hidden = true;
    } else {
      bellBtn.classList.toggle("notif-bell-btn--has-unseen", badge.hidden === false);
      pulse.hidden = badge.hidden !== false;
    }
  });

  // Auto-close when route changes
  const closeHandler = () => {
    if (open) {
      open = false;
      dropdown.hidden = true;
    }
  };
  window.addEventListener("hashchange", closeHandler);

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!dropdown.hidden && !e.target.closest(".notif-bell")) {
      closeHandler();
    }
  });

  // Esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) closeHandler();
  });

  refreshBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    refreshBtn.classList.add("notif-icon-btn--spinning");
    await fetchList();
    await fetchCount();
    setTimeout(() => refreshBtn.classList.remove("notif-icon-btn--spinning"), 600);
  });

  configBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    showToast("⚙ Configuración de notificaciones — próximamente");
  });

  markAllBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await fetch(`${BASE}/api/v1/smart-notifications/mark-all-read?userId=demo-user`, {
        method: "POST",
      });
      await fetchList();
      await fetchCount();
    } catch (err) {
      showToast("❌ " + err.message, true);
    }
  });

  generateBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    generateBtn.disabled = true;
    const origHtml = generateBtn.innerHTML;
    generateBtn.innerHTML = "<span>⏳ Generando…</span>";
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
      // Re-enable ring animation
      bellBtn.classList.add("notif-bell-btn--has-unseen");
      pulse.hidden = false;
    } catch (e) {
      showToast("❌ " + e.message, true);
    } finally {
      generateBtn.disabled = false;
      generateBtn.innerHTML = origHtml;
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
    open: () => { open = true; dropdown.hidden = false; fetchList(); bellBtn.classList.remove("notif-bell-btn--has-unseen"); pulse.hidden = true; },
    destroy() {
      stopPolling();
      host.innerHTML = "";
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": String.fromCharCode(38) + "amp;",
    "<": String.fromCharCode(38) + "lt;",
    ">": String.fromCharCode(38) + "gt;",
    '"': String.fromCharCode(38) + "quot;",
    "'": String.fromCharCode(38) + "#39;",
  }[c]));
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

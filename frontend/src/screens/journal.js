/* ============================================================
 * screens/journal.js — Daily Journal screen (Notion-grade).
 *
 * v2.26.0 — premium experience:
 *   - Sidebar with current day, streak, heatmap, recent days list.
 *   - Main canvas is a custom block-type renderer (heading, callout,
 *     gratitude, mood, agenda, live query embed, divider, todos...).
 *   - View switcher: Day / Week / Month.
 *   - Templates: select on new-day creation.
 *   - Live embeds: pulls cards-due / events-today / tasks-open /
 *     recent-notes from the backend in real time.
 *   - Inline mood tracker with 7-day chart.
 *   - Cmd/Ctrl+Enter to save mood; Cmd/Ctrl+K to jump to a journal day.
 * ============================================================ */

import { api } from "../services/api.js";
import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { makeModal } from "../widgets/modal.js";
import { MOOD_EMOJI, MOOD_LABEL, renderJournalBlock, EMBED_RENDERERS, hydrateEmbeds, setApi as setJournalApi } from "../widgets/journal_block_renderers.js";
setJournalApi(api);
import { mountOutliner } from "../widgets/outliner.js";

const VIEW = { day: "day", week: "week", month: "month" };

let cache = {
  meta: null,
  current: null,
  streak: { current: 0, longest: 0, missed: 0 },
  heatmap: null,
  mood: [],
  view: VIEW.day,
  cursor: null, // YYYY-MM-DD being viewed
  subject: "",
  templateId: null,
  builtinTemplates: [],
  recentJournals: [],
};

export async function renderJournal(root, options = {}) {
  // First fetch meta + streak + heatmap
  await refreshAll(options.date, options.subject);
  paint(root);
  wire(root);
  // Hydrate any live embeds (cards-due, events-today, etc.)
  const dayRoot = root.querySelector(".day-view") || root;
  if (dayRoot) hydrateEmbeds(dayRoot);
}

async function refreshAll(date, subject) {
  // meta (today + templates)
  const meta = await safe(`/journal/meta`);
  cache.meta = meta;
  cache.builtinTemplates = meta?.builtinTemplates ?? [];

  // streak
  cache.streak = await safe(`/journal/streak`) ?? { current: 0, longest: 0, missed: 0 };

  // heatmap
  cache.heatmap = await safe(`/journal/heatmap`);

  // mood history
  cache.mood = (await safe(`/journal/mood-history?days=30`))?.entries ?? [];

  // recent journals (last 14)
  cache.recentJournals = (await safe(`/journal/list?limit=14`))?.journals ?? [];

  // current day's journal
  const targetDate = date ?? cache.cursor ?? meta?.today ?? todayLocal();
  cache.cursor = targetDate;
  cache.subject = subject ?? cache.subject ?? "";
  cache.current = await safe(`/journal/today`, "POST", { date: targetDate, subject: cache.subject });
}

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function safe(path, method = "GET", body) {
  try {
    return await api._raw(method, path, body);
  } catch (e) {
    console.warn(`[journal] ${method} ${path} failed`, e);
    return null;
  }
}

/* ============================================================
 * Painting
 * ============================================================ */

function paint(root) {
  root.innerHTML = `
    <div class="journal-screen">
      ${renderSidebar()}
      <main class="journal-main">
        <header class="journal-head">
          <div class="head-left">
            <h1 class="h-title">📓 ${formatLongDate(cache.cursor)}</h1>
            <span class="muted small">${cache.current?.blocks?.length ?? 0} bloques · ${
              (cache.current?.blocks ?? []).filter((b) => b.text?.trim()).length
            } con contenido</span>
          </div>
          <nav class="view-switcher" role="tablist" aria-label="Vista">
            <button class="tab ${cache.view === VIEW.day ? "active" : ""}" data-view="${VIEW.day}" role="tab">Día</button>
            <button class="tab ${cache.view === VIEW.week ? "active" : ""}" data-view="${VIEW.week}" role="tab">Semana</button>
            <button class="tab ${cache.view === VIEW.month ? "active" : ""}" data-view="${VIEW.month}" role="tab">Mes</button>
          </nav>
          <div class="head-right">
            <button class="btn ghost" data-act="choose-template" title="Cambiar plantilla">${getTemplateName(cache.current?.blocks?.[0]?.meta?.templateId) || "Plantilla"}</button>
            <button class="btn" data-act="open-outliner">Outliner ↗</button>
          </div>
        </header>

        ${cache.view === VIEW.day ? renderDayView() : cache.view === VIEW.week ? renderWeekView() : renderMonthView()}
      </main>
    </div>
  `;
}

function renderSidebar() {
  const s = cache.streak;
  return `
    <aside class="journal-sidebar">
      <section class="card streak">
        <h3 class="section-title">Racha</h3>
        <div class="streak-num">🔥 ${s.current}</div>
        <div class="streak-meta">
          <span>${s.current === 0 ? "Empieza hoy" : s.current === 1 ? "día seguido" : "días seguidos"}</span>
          ${s.longest > 0 ? `<span class="muted">Récord: ${s.longest}</span>` : ""}
        </div>
      </section>

      <section class="card mood-card">
        <h3 class="section-title">Ánimo reciente</h3>
        ${renderMoodSparkline()}
        <a href="#" data-act="open-mood-trends" class="muted small">Ver 30 días →</a>
      </section>

      <section class="card heatmap-card">
        <h3 class="section-title">Densidad (30 días)</h3>
        ${renderHeatmap()}
        <span class="muted small">Cuanto más oscuro, más escribiste.</span>
      </section>

      <section class="card recent-card">
        <h3 class="section-title">Recientes</h3>
        ${renderRecentList()}
      </section>
    </aside>
  `;
}

function renderMoodSparkline() {
  const last7 = cache.mood.slice(-7);
  if (last7.length === 0) return `<p class="muted small">Sin datos aún.</p>`;
  const points = last7.map((e, i) => {
    const x = (i / Math.max(1, last7.length - 1)) * 100;
    const y = e.mood ? 100 - ((e.mood - 1) / 4) * 100 : 100;
    return `${x},${y}`;
  });
  return `
    <svg viewBox="0 0 100 100" class="mood-spark" aria-label="Tendencia de ánimo 7d" role="img">
      <polyline points="${points.join(" ")}" fill="none" stroke="var(--accent, #7c4dff)" stroke-width="2"/>
      ${last7.map((e, i) => {
        const x = (i / Math.max(1, last7.length - 1)) * 100;
        const y = e.mood ? 100 - ((e.mood - 1) / 4) * 100 : 100;
        const color = e.mood
          ? e.mood >= 4 ? "var(--good, #1d7d54)"
          : e.mood === 3 ? "var(--warn, #c26612)"
          : "var(--bad, #c83e30)"
          : "var(--border, #d4d4d4)";
        return `<circle cx="${x}" cy="${y}" r="2" fill="${color}"/>`;
      }).join("")}
    </svg>
    <div class="mood-axis muted tiny">${last7[0].date.slice(5)} → ${last7[last7.length - 1].date.slice(5)}</div>
  `;
}

function renderHeatmap() {
  const days = Object.entries(cache.heatmap?.density ?? {}).slice(-30);
  if (days.length === 0) return `<p class="muted small">Sin densidad.</p>`;
  return `
    <div class="heatmap-grid" role="grid" aria-label="Densidad últimos 30 días">
      ${days.map(([d, n]) => {
        const intensity = Math.min(1, Math.log2(n + 1) / 3);
        return `<a href="#/journal/${d}" class="heat-cell" data-date="${d}" role="gridcell"
          style="background:rgba(124,77,255,${0.05 + intensity * 0.6})" title="${d}: ${n} journal(s)"></a>`;
      }).join("")}
    </div>
  `;
}

function renderRecentList() {
  if (!cache.recentJournals?.length) return `<p class="muted small">Sin diarios previos.</p>`;
  return `
    <ul class="recent-list">
      ${cache.recentJournals.map((j) => `
        <li>
          <a href="#/journal/${j.journalDate}" class="recent-link" data-date="${j.journalDate}">
            <span class="rl-date">${j.journalDate}</span>
            <span class="rl-blocks muted small">${(j.blocks ?? []).filter((b) => b.text?.trim()).length} bloques</span>
          </a>
        </li>
      `).join("")}
    </ul>
  `;
}

function getTemplateName(id) {
  const t = cache.builtinTemplates.find((t) => t.id === id);
  return t?.name || "";
}

function formatLongDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00Z");
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(dt);
}

function renderDayView() {
  return `
    <article class="day-view" aria-label="Daily journal">
      <div class="mood-hero">
        <h2>¿Cómo te sientes hoy?</h2>
        <div class="mood-buttons" role="radiogroup" aria-label="Elegir ánimo">
          ${[1, 2, 3, 4, 5].map((s) => `
            <button class="mood-btn" data-score="${s}" role="radio" aria-label="${MOOD_LABEL[s]}">
              <span class="emoji">${MOOD_EMOJI[s]}</span>
              <span class="label">${MOOD_LABEL[s]}</span>
            </button>
          `).join("")}
        </div>
        <input class="input mood-note" placeholder="Una frase sobre tu día (opcional)" maxlength="200" />
      </div>
      <div class="day-blocks" id="day-blocks" data-note-id="${cache.current?.id}">
        ${(cache.current?.blocks ?? []).map(renderJournalBlock).join("")}
      </div>
    </article>
  `;
}

function renderWeekView() {
  // 7-day grid centered on cursor
  const startMs = new Date(cache.cursor + "T12:00:00Z").getTime() - 3 * 24 * 3600_000;
  const cells = Array.from({ length: 7 }).map((_, i) => {
    const t = startMs + i * 24 * 3600_000;
    const k = isoKey(t);
    return k;
  });
  const byDate = new Map();
  for (const j of cache.recentJournals) if (j.journalDate) byDate.set(j.journalDate, j);
  return `
    <div class="week-grid">
      ${cells.map((d) => {
        const j = byDate.get(d);
        const isToday = d === cache.cursor;
        return `
          <a href="#/journal/${d}" class="week-cell ${isToday ? "is-today" : ""}" data-date="${d}">
            <div class="wc-head">
              <strong>${d.slice(8)}</strong>
              <span class="muted">${d.slice(0, 7)}</span>
            </div>
            <div class="wc-body">
              ${j ? `<span class="mood-pill">${moodOf(j) ?? "—"}</span>` : `<span class="muted">sin journal</span>`}
              <small class="muted">${j?.blocks?.filter((b) => b.text?.trim()).length ?? 0} bloques</small>
            </div>
          </a>
        `;
      }).join("")}
    </div>
  `;
}

function moodOf(j) {
  const m = (j?.blocks ?? []).find((b) => b?.meta?.kind === "mood");
  const s = m?.meta?.mood?.score;
  return s ? MOOD_EMOJI[s] : null;
}

function isoKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2, "0"); }

function renderMonthView() {
  // 6-week (42-day) grid
  const cursor = new Date(cache.cursor + "T12:00:00Z");
  const startMs = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getTime() - cursor.getDay() * 24 * 3600_000;
  const byDate = new Map();
  for (const j of cache.recentJournals) if (j.journalDate) byDate.set(j.journalDate, j);
  const cells = Array.from({ length: 42 }).map((_, i) => {
    const t = startMs + i * 24 * 3600_000;
    const k = isoKey(t);
    const day = new Date(t).getDate();
    const month = new Date(t).getMonth();
    const isOffMonth = month !== cursor.getMonth();
    const j = byDate.get(k);
    return `
      <a href="#/journal/${k}" class="month-cell ${isOffMonth ? "off-month" : ""} ${k === cache.cursor ? "is-cursor" : ""}" data-date="${k}">
        <span class="mc-d">${day}</span>
        ${j ? `<span class="mc-dot" style="background:${moodColor(j)}" title="${MOOD_EMOJI[moodScore(j)] || "?"}"></span>` : ""}
      </a>
    `;
  });
  return `
    <div class="month-wrap">
      <h2 class="month-title">${new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(cursor)}</h2>
      <div class="month-grid">
        ${["D", "L", "M", "X", "J", "V", "S"].map((d) => `<div class="month-weekday muted small">${d}</div>`).join("")}
        ${cells.join("")}
      </div>
      <div class="month-legend muted small">
        <span class="dot" style="background:#c83e30"></span>=triste
        <span class="dot" style="background:#c26612"></span>=normal
        <span class="dot" style="background:#1d7d54"></span>=bien
      </div>
    </div>
  `;
}

function moodScore(j) {
  const m = (j?.blocks ?? []).find((b) => b?.meta?.kind === "mood");
  return m?.meta?.mood?.score ?? null;
}
function moodColor(j) {
  const s = moodScore(j);
  if (!s) return "var(--border, #d4d4d4)";
  if (s >= 4) return "var(--good, #1d7d54)";
  if (s === 3) return "var(--warn, #c26612)";
  return "var(--bad, #c83e30)";
}

/* ============================================================
 * Event wiring
 * ============================================================ */

function wire(root) {
  // View switcher
  root.querySelectorAll(".view-switcher .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      cache.view = tab.dataset.view;
      paint(root);
      wire(root);
    });
  });

  // Mood buttons
  root.querySelectorAll(".mood-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const score = parseInt(btn.dataset.score, 10);
      const note = root.querySelector(".mood-note")?.value || "";
      if (!cache.current?.id) return;
      try {
        await api._raw("POST", `/journal/${cache.current.id}/mood`, { score, note });
        btn.parentElement.querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        await refreshAll(cache.cursor, cache.subject);
        paint(root);
        wire(root);
      } catch (e) { console.warn("[journal] mood failed", e); }
    });
  });

  // Heatmap + recent click → open that day
  root.querySelectorAll("[data-date]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const d = el.dataset.date;
      if (!d || d === cache.cursor) return;
      location.hash = `#/journal/${d}`;
    });
  });

  // Block edits (delegated)
  const day = root.querySelector("#day-blocks");
  if (day) {
    day.addEventListener("input", debounce(onBlockInput, 600));
    day.addEventListener("change", onBlockInput);
    day.addEventListener("blur", onBlockInput, true);
    day.querySelectorAll("[data-act='edit-block']").forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          el.blur();
        }
      });
    });
    day.addEventListener("click", (e) => {
      const todoCb = e.target.closest("[data-act='toggle-todo']");
      if (todoCb) {
        const id = todoCb.dataset.blockId;
        const j = (cache.current.blocks ?? []).find((b) => b.id === id);
        if (j) {
          j.meta = { ...(j.meta || {}), done: !j.meta?.done };
          api._raw("PATCH", `/journal/${cache.current.id}/blocks/${id}`, { meta: j.meta }).catch(() => null);
          paint(root);
          wire(root);
        }
      }
    });
  }

  // Open outliner
  const outBtn = root.querySelector("[data-act='open-outliner']");
  if (outBtn) {
    outBtn.addEventListener("click", async () => {
      if (!cache.current?.id) return;
      // Reuse the outliner widget for richer block editing.
      const oRoot = root.querySelector(".day-view");
      if (!oRoot) return;
      oRoot.innerHTML = `<div class="outliner-host" data-id="${cache.current.id}"></div>`;
      const host = oRoot.querySelector(".outliner-host");
      await mountOutliner(host, cache.current.id, { initialBlocks: cache.current.blocks });
    });
  }

  // Choose template
  const tpl = root.querySelector("[data-act='choose-template']");
  if (tpl) {
    tpl.addEventListener("click", () => openTemplateModal(root));
  }

  // Mood trends modal
  const mt = root.querySelector("[data-act='open-mood-trends']");
  if (mt) {
    mt.addEventListener("click", (e) => {
      e.preventDefault();
      openMoodTrendsModal();
    });
  }

  // Hash-based day change: respond when URL changes (e.g., clicking heatmap).
  window.addEventListener("hashchange", () => {
    const m = /#\/journal\/(\d{4}-\d{2}-\d{2})/.exec(location.hash);
    if (m && m[1] && m[1] !== cache.cursor) {
      cache.cursor = m[1];
      cache.view = VIEW.day;
      refreshAll(cache.cursor, cache.subject).then(() => {
        paint(root);
        wire(root);
      });
    }
  }, { passive: true });
}

function onBlockInput(e) {
  const target = e.target.closest("[data-act='edit-block']");
  if (!target || !cache.current?.id) return;
  const blockId = target.dataset.blockId;
  const newText = target.innerText ?? target.value ?? "";
  const block = (cache.current.blocks ?? []).find((b) => b.id === blockId);
  if (!block || block.text === newText) return;
  block.text = newText;
  block.updatedAt = Date.now();
  api._raw("PATCH", `/journal/${cache.current.id}/blocks/${blockId}`, { text: newText }).catch(() => null);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function openTemplateModal(root) {
  const items = cache.builtinTemplates.map((t) => ({ id: t.id, name: t.name, label: t.subject === "*" ? "General" : t.subject }));
  const m = makeModal({
    title: "Elige plantilla para hoy",
    body: `
      <ul class="tpl-list" role="listbox">
        ${items.map((t, i) => `
          <li role="option" data-id="${t.id}" class="${i === 0 ? "active" : ""}">
            <strong>${t.name}</strong>
            <small class="muted">${t.label}</small>
          </li>
        `).join("")}
      </ul>
      <p class="muted small">Aplicar plantilla añade bloques faltantes sin borrar los que ya tienes.</p>
    `,
    actions: [{ label: "Aplicar", kind: "primary", value: "apply" }, { label: "Cancelar", kind: "ghost", value: false }],
  });
  document.body.appendChild(m.root);
  m.root.querySelectorAll("li").forEach((li) => {
    li.addEventListener("click", () => {
      m.root.querySelectorAll("li").forEach((x) => x.classList.remove("active"));
      li.classList.add("active");
    });
  });
  setTimeout(async () => {
    const val = await waitFor(m);
    if (val !== "apply") return;
    const id = m.root.querySelector("li.active")?.dataset.id;
    if (!id) return;
    cache.templateId = id;
    await refreshAll(cache.cursor, cache.subject);
    // Re-create with chosen template
    const fresh = await safe(`/journal/today`, "POST", { date: cache.cursor, subject: cache.subject, templateId: id });
    if (fresh) cache.current = fresh;
    paint(root);
    wire(root);
  }, 50);
}

function waitFor(modal) {
  return new Promise((resolve) => {
    const old = modal.close;
    modal.close = (v) => { old(v); resolve(v); };
    modal.root.addEventListener("click", function listener(e) {
      const btn = e.target.closest("[data-action]");
      if (btn) modal.close(parseInt(btn.dataset.action, 10) === 0 ? true : false);
    });
  });
}

function openMoodTrendsModal() {
  const m = makeModal({
    title: "Tendencia de ánimo (30 días)",
    body: `
      <svg viewBox="0 0 100 100" class="mood-trends">
        <polyline points="${cache.mood.map((e, i) => `${(i / Math.max(1, cache.mood.length - 1)) * 100},${e.mood ? 100 - ((e.mood - 1) / 4) * 100 : 100}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2"/>
        ${cache.mood.map((e, i) => {
          const x = (i / Math.max(1, cache.mood.length - 1)) * 100;
          const y = e.mood ? 100 - ((e.mood - 1) / 4) * 100 : 100;
          return `<circle cx="${x}" cy="${y}" r="1.2" fill="${e.mood ? moodColorOf(e.mood) : "var(--border)"}"/>`;
        }).join("")}
      </svg>
      <p class="muted small">Cada punto es un día. Hover (próximamente) para detalles.</p>
    `,
    actions: [{ label: "Cerrar", kind: "ghost", value: false }],
  });
  document.body.appendChild(m.root);
}

function moodColorOf(s) {
  if (s >= 4) return "var(--good, #1d7d54)";
  if (s === 3) return "var(--warn, #c26612)";
  return "var(--bad, #c83e30)";
}

// expose helpers for tests
export const _internal = {
  refreshAll,
  cache: () => cache,
  paintHelpers: { isoKey, formatLongDate },
};

/* ============================================================
 * widgets/journal_block_renderers.js — premium block renderers
 * for the daily journal screen.
 *
 * v2.26.0 — Notion-grade rich content:
 *   - heading (h1/h2 with emoji)
 *   - divider (--- with whitespace)
 *   - callout (gradient box, optional title)
 *   - gratitude (3-bullet separator-aware input)
 *   - learnings (multi-line reflective input)
 *   - questions (multi-line input)
 *   - agenda (date-aligned list)
 *   - todo (checkbox-style items in callout body)
 *   - mood (1-5 quick buttons)
 *   - query-cards-due / events-today / tasks-open /
 *     recent-notes / spaced-queue / study-stats (live embeds)
 * ============================================================ */

export const MOOD_EMOJI = { 1: "😞", 2: "😕", 3: "😐", 4: "🙂", 5: "🤩" };
export const MOOD_LABEL = { 1: "Mal", 2: "Bajo", 3: "Normal", 4: "Bien", 5: "Excelente" };

export const EMBED_RENDERERS = {
  "query-cards-due": "cardsDue",
  "query-events-today": "eventsToday",
  "query-tasks-open": "tasksOpen",
  "query-recent-notes": "recentNotes",
  "embed-spaced": "spacedQueue",
  "embed-stats": "studyStats",
};

let apiRef = null;
export function setApi(api) { apiRef = api; }

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ============================================================
 * renderJournalBlock — top-level entry. Dispatches by block.meta.kind.
 * ============================================================ */
export function renderJournalBlock(block) {
  const kind = block.meta?.kind || "free";
  switch (kind) {
    case "heading": return renderHeading(block, 1);
    case "subheading": return renderHeading(block, 2);
    case "divider": return renderDivider();
    case "callout": return renderCallout(block);
    case "todo": return renderTodo(block);
    case "gratitude": return renderGratitude(block);
    case "learnings": return renderLearnings(block);
    case "questions": return renderQuestions(block);
    case "agenda": return renderAgenda(block);
    case "mood": return renderMoodBlock(block);
    case "query-cards-due":
    case "query-events-today":
    case "query-tasks-open":
    case "query-recent-notes":
    case "embed-spaced":
    case "embed-stats":
      return renderEmbed(block);
    case "free":
    default:
      return renderFree(block);
  }
}

function renderHeading(block, level) {
  const text = block.text || block.meta?.title || "";
  return `
    <section class="jr-block jr-heading jr-h${level}" data-block-id="${block.id}">
      <h${level}>
        ${block.meta?.emoji ? `<span class="jr-emoji">${escapeHtml(block.meta.emoji)}</span>` : ""}
        ${escapeHtml(text)}
      </h${level}>
    </section>
  `;
}

function renderDivider() {
  return `<hr class="jr-divider" aria-hidden="true"/>`;
}

function renderCallout(block) {
  return `
    <section class="jr-block jr-callout" data-block-id="${block.id}">
      ${block.meta?.emoji ? `<span class="jr-callout-emoji">${escapeHtml(block.meta.emoji)}</span>` : ""}
      <div class="jr-callout-body">
        ${block.meta?.calloutTitle || block.meta?.title ? `<h3 class="jr-callout-title">${escapeHtml(block.meta.calloutTitle ?? block.meta.title)}</h3>` : ""}
        <div class="jr-editable" data-act="edit-block" data-block-id="${block.id}" contenteditable="true" role="textbox" spellcheck="true">${escapeHtml(block.text || "")}</div>
      </div>
    </section>
  `;
}

function renderTodo(block) {
  const checked = block.meta?.done ? "checked" : "";
  return `
    <label class="jr-block jr-todo" data-block-id="${block.id}">
      <input type="checkbox" ${checked} data-act="toggle-todo" data-block-id="${block.id}" />
      <span class="jr-editable" data-act="edit-block" data-block-id="${block.id}" contenteditable="true" role="textbox" spellcheck="true">${escapeHtml(block.text || "")}</span>
    </label>
  `;
}

function renderGratitude(block) {
  const lines = (block.text || "").split(/\n+/).filter((l) => l.trim());
  const items = [];
  for (let i = 0; i < Math.max(3, lines.length); i++) {
    items.push(`<li class="jr-grat-item">
      <span class="dot" aria-hidden="true"></span>
      <span class="jr-editable" data-act="edit-block" data-block-id="${block.id}" data-line="${i}" contenteditable="true" role="textbox" placeholder="Estoy agradecido por...">${escapeHtml(lines[i] || "")}</span>
    </li>`);
  }
  return `
    <section class="jr-block jr-gratitude" data-block-id="${block.id}">
      <h3 class="jr-section-title">${escapeHtml(block.meta?.title || "Agradecido por")}</h3>
      <ol class="jr-grat-list">${items.join("")}</ol>
    </section>
  `;
}

function renderLearnings(block) {
  return `
    <section class="jr-block jr-learnings" data-block-id="${block.id}">
      <h3 class="jr-section-title">📌 ${escapeHtml(block.meta?.title || "Lo que aprendí")}</h3>
      <div class="jr-list" data-block-id="${block.id}">
        ${(block.text ? block.text.split("\n").filter((l) => l.trim()) : [""]).map((line, i) => `
          <div class="jr-list-row">
            <span class="jr-list-num">${i + 1}</span>
            <span class="jr-editable" data-act="edit-block" data-block-id="${block.id}" data-line="${i}" contenteditable="true" role="textbox">${escapeHtml(line.replace(/^[-\s]+/, ""))}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderQuestions(block) {
  return `
    <section class="jr-block jr-questions" data-block-id="${block.id}">
      <h3 class="jr-section-title">❓ ${escapeHtml(block.meta?.title || "Lo que todavía no entiendo")}</h3>
      <div class="jr-list" data-block-id="${block.id}">
        ${(block.text ? block.text.split("\n").filter((l) => l.trim()) : [""]).map((line, i) => `
          <div class="jr-list-row">
            <span class="jr-list-num">?</span>
            <span class="jr-editable" data-act="edit-block" data-block-id="${block.id}" data-line="${i}" contenteditable="true" role="textbox">${escapeHtml(line.replace(/^[-\s?]+/, ""))}</span>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderAgenda(block) {
  return `
    <section class="jr-block jr-agenda" data-block-id="${block.id}">
      <h3 class="jr-section-title">📅 ${escapeHtml(block.meta?.title || "Agenda del día")}</h3>
      <div class="jr-editable" data-act="edit-block" data-block-id="${block.id}" contenteditable="true" role="textbox" placeholder="- 09:00 Práctica...">${escapeHtml(block.text || "")}</div>
    </section>
  `;
}

function renderMoodBlock(block) {
  const score = block.meta?.mood?.score;
  return `
    <section class="jr-block jr-mood" data-block-id="${block.id}">
      <h3 class="jr-section-title">😌 ${escapeHtml(block.meta?.title || "¿Cómo me siento?")}</h3>
      <div class="jr-mood-buttons" role="radiogroup" aria-label="Ánimo">
        ${[1, 2, 3, 4, 5].map((s) => `
          <button class="jr-mood-btn ${s === score ? "selected" : ""}" data-score="${s}">
            <span class="emoji">${MOOD_EMOJI[s]}</span>
            <span class="label">${MOOD_LABEL[s]}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderEmbed(block) {
  const meta = block.meta ?? {};
  const kind = meta.kind;
  const title = block.meta?.title ?? (
    kind === "query-cards-due" ? "Tarjetas para repasar" :
    kind === "query-events-today" ? "Eventos de hoy" :
    kind === "query-tasks-open" ? "Tareas abiertas" :
    kind === "query-recent-notes" ? "Notas recientes" :
    kind === "embed-spaced" ? "Cola FSRS-6" :
    kind === "embed-stats" ? "Estadísticas de estudio" :
    "Embed"
  );
  return `
    <section class="jr-block jr-embed" data-block-id="${block.id}" data-embed-type="${kind}">
      <h3 class="jr-section-title">${escapeHtml(title)}</h3>
      <div class="jr-embed-body">
        <div class="jr-embed-loading">Cargando…</div>
      </div>
      <button class="jr-embed-refresh btn ghost tiny" data-act="embed-refresh">↻ Refrescar</button>
    </section>
  `;
}

function renderFree(block) {
  return `
    <section class="jr-block jr-free" data-block-id="${block.id}">
      <div class="jr-editable" data-act="edit-block" data-block-id="${block.id}" contenteditable="true" role="textbox" placeholder="Escribe aquí…">${escapeHtml(block.text || "")}</div>
    </section>
  `;
}

/* ============================================================
 * Live-embed loader: when an embed block enters the viewport,
 * call /journal/embed/resolve and replace the body.
 * ============================================================ */
let intersectObserver = null;
const embedQueue = new Map(); // type → pending

export async function hydrateEmbeds(rootEl) {
  if (!apiRef) return;
  if (typeof IntersectionObserver === "undefined") {
    // Fallback: hydrate all immediately.
    Array.from(rootEl.querySelectorAll(".jr-embed")).forEach((el) => hydrateOne(el));
    return;
  }
  if (!intersectObserver) {
    intersectObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) hydrateOne(e.target);
      }
    }, { rootMargin: "200px" });
  }
  Array.from(rootEl.querySelectorAll(".jr-embed")).forEach((el) => intersectObserver.observe(el));
  // Refresh button hooks
  rootEl.querySelectorAll("[data-act='embed-refresh']").forEach((btn) => {
    btn.addEventListener("click", () => hydrateOne(btn.closest(".jr-embed")));
  });
}

async function hydrateOne(el) {
  const type = el.dataset.embedType;
  if (!type) return;
  const body = el.querySelector(".jr-embed-body");
  if (!body) return;
  body.innerHTML = `<div class="jr-embed-loading">Cargando…</div>`;
  try {
    const r = await apiRef._raw("POST", "/journal/embed/resolve", { type });
    body.innerHTML = renderEmbedData(type, r?.items ?? []);
  } catch (e) {
    body.innerHTML = `<div class="muted small">Sin datos. Comprueba la conexión.</div>`;
  }
}

function renderEmbedData(type, items) {
  if (!items || items.length === 0) {
    return `<div class="muted small">Nada para mostrar. ¡Quizás día libre!</div>`;
  }
  if (type === "query-cards-due" || type === "embed-spaced") {
    return `<ul class="jr-embed-list">
      ${items.map((c) => `<li class="jr-embed-card">
        <strong>${escapeHtml(c.front || "(sin pregunta)")}</strong>
        ${c.subject ? `<small class="muted">${escapeHtml(c.subject)}</small>` : ""}
      </li>`).join("")}
    </ul>`;
  }
  if (type === "query-events-today") {
    return `<ul class="jr-embed-list">
      ${items.map((e) => `<li class="jr-embed-event">
        <strong>${escapeHtml(e.title || "(evento)")}</strong>
        <small class="muted">${formatTime(e.start)}</small>
      </li>`).join("")}
    </ul>`;
  }
  if (type === "query-tasks-open") {
    return `<ul class="jr-embed-tasks">
      ${items.map((t) => `<li><input type="checkbox" ${t.done ? "checked" : ""}/> <span>${escapeHtml(t.text || "")}</span></li>`).join("")}
    </ul>`;
  }
  if (type === "query-recent-notes") {
    return `<ul class="jr-embed-notes">
      ${items.map((n) => `<li><a href="#/notes?id=${encodeURIComponent(n.id)}">${escapeHtml(n.title)}</a><small class="muted">${escapeHtml(n.subject || "")}</small></li>`).join("")}
    </ul>`;
  }
  if (type === "embed-stats") {
    if (typeof items === "object" && items.windowDays !== undefined) {
      return `<div class="jr-embed-stats">
        <div class="jr-stat"><strong>${items.journalCount}</strong><small>journals / ${items.windowDays}d</small></div>
        <div class="jr-stat"><strong>${items.cardsStudied}</strong><small>tarjetas estudiadas</small></div>
        <div class="jr-stat"><strong>${items.avgDaily}</strong><small>avg/día</small></div>
      </div>`;
    }
    return `<div class="muted small">Sin estadísticas todavía.</div>`;
  }
  return `<pre class="muted tiny">${escapeHtml(JSON.stringify(items, null, 2))}</pre>`;
}

function formatTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

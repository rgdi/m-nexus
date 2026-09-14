/* ============================================================
 * screens/overview.js — landing screen
 * v1.3.0 — i18n integration
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";

const HOUR = 3600 * 1000;
const PAD = (n) => String(n).padStart(2, "0");
const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
};
const fmtRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`;
const sameDay = (a, b) => {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear()
    && x.getMonth() === y.getMonth()
    && x.getDate() === y.getDate();
};

const COLOR_FOR = {
  math: "var(--subj-red)",
  pol:  "var(--subj-yellow)",
  deu:  "var(--subj-blue)",
  phy:  "var(--subj-purple)",
  che:  "var(--subj-green)",
  default: "var(--subj-gray)",
};

export async function renderOverview(root) {
  const eventsAll = await dataSource.events.list();
  const events = eventsAll.filter(e => sameDay(e.start, Date.now()));
  const subjects = await dataSource.subjects.list();
  const tasksAll = await dataSource.tasks.list();
  const openTasks = tasksAll.filter(t => !t.done);

  const nextDeadline = events
    .filter(e => e.start > Date.now() && e.start - Date.now() < 48 * HOUR)
    .sort((a, b) => a.start - b.start)[0];

  const cardsHtml = subjects.slice(0, 5).map(s => `
    <a class="subj-bubble" href="#/subjects" style="background:${s.color}">
      <div>
        <div class="corner">${renderIcon(s.icon || s.name?.[0] || "?")}</div>
        <div class="name">${escapeHtml(s.name)}</div>
        <div class="perf">${s.performance ? `+${s.performance}%` : ""} performance</div>
      </div>
    </a>
  `).join("");

  const todayLabel = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const notes = await dataSource.notes.list();
  const gradedSubjects = subjects.filter(s => s.grade);

  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <h1 class="h-title">${i18n.t("dock.overview")}</h1>
        <span class="h-sub">${todayLabel}</span>
        <div class="spacer"></div>
        ${nextDeadline ? `<span class="chip bad">${i18n.t("overview.referatBadge", { time: fmtRange(nextDeadline.start, nextDeadline.end).slice(0, -3) })}</span>` : ""}
      </header>

      <div class="grid grid-3" style="align-items:start">
        <div>
          <h3 class="muted small semibold" style="margin-bottom: var(--s-3)">${i18n.t("overview.todaySchedule")}</h3>
          <div class="col gap-2">
            ${events.length === 0
              ? `<div class="empty">${i18n.t("overview.noEvents")}</div>`
              : events.map(e => `
                <div class="card" style="border-left: 3px solid ${COLOR_FOR[e.subject] || COLOR_FOR.default}">
                  <div class="muted tiny">${fmtRange(e.start, e.end)}</div>
                  <div class="row gap-2" style="margin-top: 4px">
                    <strong>${escapeHtml(e.title)}</strong>
                    ${e.room ? `<span class="chip muted">${escapeHtml(e.room)}</span>` : ""}
                    ${e.type ? `<span class="chip ${e.type === "Referat" ? "good" : "info"}">${escapeHtml(e.type)}</span>` : ""}
                  </div>
                  ${e.prof ? `<div class="muted tiny" style="margin-top: 4px">${escapeHtml(e.prof)}</div>` : ""}
                </div>`).join("")}
          </div>
        </div>

        <div>
          <h3 class="muted small semibold" style="margin-bottom: var(--s-3)">${i18n.t("overview.subjects")}</h3>
          <div class="grid grid-2">${cardsHtml}</div>
        </div>

        <div>
          <h3 class="muted small semibold" style="margin-bottom: var(--s-3)">${i18n.t("overview.atGlance")}</h3>
          <div class="col gap-3">
            <div class="stat">
              <div class="lbl">${i18n.t("overview.dueToday")}</div>
              <div class="val">${openTasks.filter(t => t.due && sameDay(t.due, Date.now())).length}</div>
              <div class="sub">${openTasks.length} ${i18n.t("overview.openTasks")}</div>
            </div>
            <div class="stat">
              <div class="lbl">${i18n.t("overview.nextReferat")}</div>
              <div class="val" style="font-size: var(--fs-xl)">${nextDeadline ? fmtTime(nextDeadline.start) : "—"}</div>
              <div class="sub">${nextDeadline ? escapeHtml(nextDeadline.title) : i18n.t("overview.noDeadline")}</div>
            </div>
            <div class="stat">
              <div class="lbl">${i18n.t("overview.avgGrade")}</div>
              <div class="val">${avg(gradedSubjects.map(s => s.grade)).toFixed(2)}</div>
              <div class="sub">${i18n.t("overview.acrossSubjects", { n: gradedSubjects.length })}</div>
            </div>
          </div>

          <h3 class="muted small semibold" style="margin: var(--s-5) 0 var(--s-3)">${i18n.t("overview.quickNotes")}</h3>
          <div class="grid grid-2">${renderQuickNotes(notes)}</div>
        </div>
      </div>
    </div>
  `;
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }

function renderQuickNotes(notes) {
  const items = notes.slice(0, 4);
  if (!items.length) return `<div class="muted small">${i18n.t("notes.noNotes")}</div>`;
  return items.map(n => `
    <a href="#/notes" class="card interactive" style="padding: var(--s-3)">
      <div class="bold truncate">${escapeHtml(n.title)}</div>
      <div class="muted tiny truncate">${escapeHtml((n.body || "").slice(0, 40))}</div>
    </a>
  `).join("");
}

function renderIcon(letter) {
  return `<div style="background:rgba(255,255,255,.18);border-radius:10px;width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800">${escapeHtml(letter)}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

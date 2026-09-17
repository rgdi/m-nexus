/* ============================================================
 * screens/calendar.js — day / week calendar
 * v1.3.0 — i18n integration
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";
import { i18n } from "../services/i18n.js";
import { makeModal } from "../widgets/modal.js";

const HOUR = 3600 * 1000;
const PAD = (n) => String(n).padStart(2, "0");
const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
};
const COLOR_FOR = {
  math: "var(--subj-red)",
  pol:  "var(--subj-yellow)",
  deu:  "var(--subj-blue)",
  phy:  "var(--subj-purple)",
  che:  "var(--subj-green)",
  default: "var(--subj-gray)",
};

const state = { view: "day", date: new Date() };

export async function renderCalendar(root) {
  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <h1 class="h-title">${i18n.t("dock.calendar")}</h1>
        <div class="spacer"></div>
        <div class="view-toggle" role="tablist">
          <button class="seg ${state.view === "day" ? "active" : ""}" data-view="day">${i18n.t("calendar.day")}</button>
          <button class="seg ${state.view === "week" ? "active" : ""}" data-view="week">${i18n.t("calendar.week")}</button>
        </div>
        <button class="btn primary" id="new-event">${i18n.t("calendar.create")}</button>
      </header>

      <div id="cal-body"><div class="empty"><div class="em-title">${i18n.t("common.loading")}</div></div></div>
    </div>
  `;
  root.querySelectorAll(".view-toggle .seg").forEach((b) => {
    b.addEventListener("click", () => { state.view = b.dataset.view; renderCalendar(root); });
  });
  root.querySelector("#new-event").addEventListener("click", () => openEventModal(null, () => renderCalendar(root)));

  const body = root.querySelector("#cal-body");
  const events = await dataSource.events.list();
  eventsCache = events;
  body.innerHTML = state.view === "day" ? renderDay(events) : renderWeek(events);
  attachDayHandlers(body);
}

function renderDay(events) {
  const date = new Date(state.date);
  date.setHours(0, 0, 0, 0);
  const dayStart = date.getTime();
  const dayEnd = dayStart + 24 * HOUR;

  const today = events.filter(e => e.start >= dayStart && e.start < dayEnd).sort((a, b) => a.start - b.start);
  const hours = Array.from({ length: 17 }, (_, i) => 6 + i);
  const rows = hours.map(h => `
    <div class="cal-time">${PAD(h)}:00</div>
    <div class="cal-grid-line" data-h="${h}"></div>
  `).join("");

  const blocks = today.map(e => {
    const top = ((e.start - dayStart) / HOUR - 6) * 80;
    const dur = Math.max(60, (e.end - e.start) / 60000);
    const h = (dur / 60) * 80;
    return `
      <div class="cal-event" data-id="${e.id}"
           style="top:${top}px;height:${h}px;border-left-color:${COLOR_FOR[e.subject] || COLOR_FOR.default}"
           title="Click to edit">
        <div class="time">${fmtTime(e.start)} – ${fmtTime(e.end)}</div>
        <div class="title">${escapeHtml(e.title)}</div>
        <div class="prof">${escapeHtml(e.prof || "")} ${e.room ? `<span class="room">${escapeHtml(e.room)}</span>` : ""}</div>
      </div>
    `;
  }).join("");

  const now = new Date();
  const sameDay = now.toDateString() === date.toDateString();
  const nowTop = sameDay ? ((now.getHours() + now.getMinutes() / 60) - 6) * 80 : -100;

  return `
    <div class="calendar">
      <div class="cal-times">${rows}</div>
      <div class="cal-events" id="cal-events" style="position:relative">
        ${blocks}
        ${nowTop >= 0 ? `<div class="cal-now" style="top:${nowTop}px"></div>` : ""}
        <div class="cal-drag-hint">Drag to create event</div>
      </div>
    </div>
  `;
}

function renderWeek(events) {
  const date = new Date(state.date);
  const dow = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dow);
  date.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(date); d.setDate(d.getDate() + i);
    const dayStart = d.getTime();
    const dayEnd = dayStart + 24 * HOUR;
    const ev = events.filter(e => e.start >= dayStart && e.start < dayEnd).slice(0, 4);
    const today = new Date().toDateString() === d.toDateString();
    return `
      <div class="week-day ${today ? "today" : ""}">
        <div class="name">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
        <div class="num">${d.getDate()}</div>
        ${ev.map(e => `
          <div class="ev" style="border-left-color:${COLOR_FOR[e.subject] || COLOR_FOR.default}">
            ${fmtTime(e.start)} ${escapeHtml(e.title)}
          </div>
        `).join("")}
      </div>
    `;
  }).join("");

  return `<div class="week-grid">${days}</div>`;
}

function attachDayHandlers(root) {
  root.querySelectorAll(".cal-event").forEach((el) => {
    el.addEventListener("click", () => {
      // v1.7.2: single click = detail modal (read-only), double click = edit
      if (el._clickTimer) {
        clearTimeout(el._clickTimer);
        el._clickTimer = null;
        openEventModal(el.dataset.id, () => renderCalendar(document.getElementById("app")));
      } else {
        el._clickTimer = setTimeout(() => {
          el._clickTimer = null;
          openEventDetail(el.dataset.id);
        }, 220);
      }
    });
  });
  root.querySelectorAll(".ev").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.id;
      if (id) openEventDetail(id);
    });
  });
  // attach data-id to .ev elements
  root.querySelectorAll(".ev").forEach((el, i) => {
    const ev = eventsCache[i];
    if (ev) el.dataset.id = ev.id;
  });
  // v1.9.2: drag-to-create event on day timeline
  const events = root.querySelector("#cal-events");
  if (events) attachDragCreate(events);
}

function attachDragCreate(eventsContainer) {
  let dragging = false;
  let startY = 0;
  let previewEl = null;

  eventsContainer.addEventListener("pointerdown", (e) => {
    // ignore if click was on an existing event
    if (e.target.closest(".cal-event")) return;
    dragging = true;
    startY = e.clientY;
    previewEl = document.createElement("div");
    previewEl.className = "cal-drag-preview";
    previewEl.style.top = `${e.offsetY}px`;
    previewEl.style.height = "40px";
    eventsContainer.appendChild(previewEl);
    eventsContainer.setPointerCapture(e.pointerId);
  });
  eventsContainer.addEventListener("pointermove", (e) => {
    if (!dragging || !previewEl) return;
    const dy = e.clientY - startY;
    const startTop = e.offsetY - dy;
    const h = Math.max(20, dy);
    previewEl.style.top = `${Math.max(0, startTop)}px`;
    previewEl.style.height = `${h}px`;
  });
  eventsContainer.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = e.clientY - startY;
    const rect = eventsContainer.getBoundingClientRect();
    const startTopRel = e.clientY - dy - rect.top;
    const startTop = Math.max(0, startTopRel);
    const height = Math.max(40, dy);
    // Convert to time: 1px = 80/60 min, so 1px = 1.333 min
    const startMinutes = 6 * 60 + (startTop / 80) * 60;
    const durationMinutes = (height / 80) * 60;
    const baseDate = new Date(state.date);
    baseDate.setHours(0, 0, 0, 0);
    const start = baseDate.getTime() + startMinutes * 60 * 1000;
    const end = start + durationMinutes * 60 * 1000;
    previewEl.remove();
    previewEl = null;
    // Open create modal pre-filled
    openEventModalPre(start, end, () => renderCalendar(document.getElementById("app")));
  });
}

function openEventModalPre(startMs, endMs, onSaved) {
  openEventModal(null, onSaved, {
    title: "",
    prof: "",
    room: "",
    type: "",
    subject: "default",
    start: startMs,
    end: endMs,
  });
}

let eventsCache = [];

/**
 * openEventDetail — modal read-only con info del evento + notas linkadas.
 * v1.7.2 — linked notes = notas con mismo subject creadas en ±2 horas.
 */
async function openEventDetail(id) {
  const ev = await dataSource.events.get(id).catch(() => null);
  if (!ev) return;
  // buscar notas linkadas (mismo subject, ventana ±2h)
  const winStart = ev.start - 2 * HOUR;
  const winEnd = ev.end + 2 * HOUR;
  const allNotes = await dataSource.notes.list();
  const linkedNotes = allNotes.filter((n) => {
    const subMatch = n.subject === ev.subject || n.subject === ev.title;
    const timeMatch = (n.updatedAt >= winStart && n.updatedAt <= winEnd) || (n.createdAt >= winStart && n.createdAt <= winEnd);
    return subMatch && timeMatch;
  });

  const html = `
    <div class="sheet" style="max-width: 640px">
      <div class="sheet-header">
        <h3>${escapeHtml(ev.title)}</h3>
        <button class="btn icon" data-close>✕</button>
      </div>
      <div class="ev-detail" style="border-left: 4px solid ${COLOR_FOR[ev.subject] || COLOR_FOR.default}; padding-left: var(--s-4); margin-bottom: var(--s-4)">
        <div class="muted small">${i18n.t("calendar.detail.when")}</div>
        <div style="font-size: var(--fs-md); font-weight: 600">${fmtTime(ev.start)} – ${fmtTime(ev.end)}</div>
        ${ev.prof ? `<div class="muted small" style="margin-top: var(--s-2)">${i18n.t("calendar.prof")}: ${escapeHtml(ev.prof)}</div>` : ""}
        ${ev.room ? `<div class="muted small">${i18n.t("calendar.room")}: ${escapeHtml(ev.room)}</div>` : ""}
        ${ev.type ? `<div style="margin-top: var(--s-2)"><span class="badge">${escapeHtml(ev.type)}</span></div>` : ""}
      </div>

      <h4 style="margin: var(--s-4) 0 var(--s-2); font-size: var(--fs-md)">${i18n.t("calendar.detail.linkedNotes")} (${linkedNotes.length})</h4>
      ${linkedNotes.length === 0
        ? `<div class="muted small" style="padding: var(--s-3); background: var(--bg-sunken); border-radius: 10px">${i18n.t("calendar.detail.noNotes")}</div>`
        : `<div class="linked-notes">${linkedNotes.slice(0, 5).map((n) => `
            <a href="#/notes" data-note-id="${n.id}" class="linked-note">
              <div class="title">${escapeHtml(n.title)}</div>
              <div class="muted tiny">${escapeHtml((n.body || "").slice(0, 80))}</div>
            </a>
          `).join("")}</div>`
      }

      <div class="row gap-2" style="margin-top: var(--s-5)">
        <button class="btn primary" data-act="edit">${i18n.t("common.edit")}</button>
        <button class="btn danger" data-act="del">${i18n.t("common.delete")}</button>
        <button class="btn" data-close style="margin-left:auto">${i18n.t("common.close")}</button>
      </div>
    </div>
  `;
  const { scrim, close } = makeModal(html);
  document.body.appendChild(scrim);
  scrim.querySelector('[data-act="edit"]').addEventListener("click", () => {
    close();
    openEventModal(id, () => renderCalendar(document.getElementById("app")));
  });
  scrim.querySelector('[data-act="del"]').addEventListener("click", async () => {
    await dataSource.events.remove(id);
    close();
    renderCalendar(document.getElementById("app"));
  });
  scrim.querySelectorAll(".linked-note").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const nid = a.dataset.noteId;
      document.dispatchEvent(new CustomEvent("notes:open", { detail: { id: nid } }));
      location.hash = `#/notes/${nid}`;
      close();
    });
  });
}

function openEventModal(id, onSaved, prefill) {
  dataSource.events.get(id).then((event) => {
    const e = event || prefill || {
      title: "", prof: "", room: "", type: "",
      subject: "default",
      start: Date.now(), end: Date.now() + HOUR,
    };

    const html = `
      <div class="sheet bottom">
        <div class="sheet-header">
          <h3>${id ? i18n.t("calendar.edit") : i18n.t("calendar.new")}</h3>
          <button class="btn icon" data-close>✕</button>
        </div>
        <div class="col gap-3">
          <input class="input" id="ev-title" placeholder="${i18n.t("calendar.title")}" value="${escapeHtml(e.title)}" />
          <div class="row gap-2">
            <input class="input" id="ev-prof" placeholder="${i18n.t("calendar.prof")}" value="${escapeHtml(e.prof || "")}" />
            <input class="input" id="ev-room" placeholder="${i18n.t("calendar.room")}" value="${escapeHtml(e.room || "")}" />
          </div>
          <div class="row gap-2">
            <input class="input" id="ev-start" type="datetime-local"
                   value="${toLocalDateTime(e.start)}" />
            <input class="input" id="ev-end" type="datetime-local"
                   value="${toLocalDateTime(e.end)}" />
          </div>
          <select class="input" id="ev-type">
            <option value="">—</option>
            <option value="Lecture" ${e.type === "Lecture" ? "selected" : ""}>${i18n.t("calendar.type.lecture")}</option>
            <option value="Homework" ${e.type === "Homework" ? "selected" : ""}>${i18n.t("calendar.type.homework")}</option>
            <option value="Referat" ${e.type === "Referat" ? "selected" : ""}>${i18n.t("calendar.type.referat")}</option>
            <option value="Exam" ${e.type === "Exam" ? "selected" : ""}>${i18n.t("calendar.type.exam")}</option>
          </select>
          <div class="row gap-2">
            ${id ? `<button class="btn danger" data-act="del" style="margin-right:auto">${i18n.t("common.delete")}</button>` : ""}
            <button class="btn primary" data-act="save">${i18n.t("common.save")}</button>
          </div>
        </div>
      </div>
    `;
    const { scrim, close } = makeModal(html, { className: "scrim sheet-bottom" });
    document.body.appendChild(scrim);

    scrim.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const title = scrim.querySelector("#ev-title").value.trim();
      if (!title) return;
      const payload = {
        title,
        prof: scrim.querySelector("#ev-prof").value,
        room: scrim.querySelector("#ev-room").value,
        start: fromLocalDateTime(scrim.querySelector("#ev-start").value),
        end: fromLocalDateTime(scrim.querySelector("#ev-end").value),
        type: scrim.querySelector("#ev-type").value,
        subject: e.subject ?? "default",
      };
      if (id) await dataSource.events.update(id, payload);
      else await dataSource.events.create(payload);
      close();
      onSaved?.();
    });

    scrim.querySelector('[data-act="del"]')?.addEventListener("click", async () => {
      await dataSource.events.remove(id);
      close();
      onSaved?.();
    });
  });
}

function toLocalDateTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}T${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}
function fromLocalDateTime(s) { return new Date(s).getTime(); }

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

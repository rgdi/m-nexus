/* ============================================================
 * screens/calendar.js — day / week calendar
 * v1.1.0 — conectado al backend via dataSource
 * ============================================================ */

import { dataSource } from "../services/dataSource.js";

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
        <h1 class="h-title">Calendar</h1>
        <div class="spacer"></div>
        <div class="view-toggle" role="tablist">
          <button class="seg ${state.view === "day" ? "active" : ""}" data-view="day">Day</button>
          <button class="seg ${state.view === "week" ? "active" : ""}" data-view="week">Week</button>
        </div>
        <button class="btn primary" id="new-event">+ Create event</button>
      </header>

      <div id="cal-body"><div class="empty"><div class="em-title">Loading…</div></div></div>
    </div>
  `;
  root.querySelectorAll(".view-toggle .seg").forEach((b) => {
    b.addEventListener("click", () => { state.view = b.dataset.view; renderCalendar(root); });
  });
  root.querySelector("#new-event").addEventListener("click", () => openEventModal(null, () => renderCalendar(root)));

  const body = root.querySelector("#cal-body");
  const events = await dataSource.events.list();
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
      <div class="cal-events" style="position:relative">
        ${blocks}
        ${nowTop >= 0 ? `<div class="cal-now" style="top:${nowTop}px"></div>` : ""}
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
    el.addEventListener("click", () => openEventModal(el.dataset.id, () => renderCalendar(document.getElementById("app"))));
  });
}

function openEventModal(id, onSaved) {
  dataSource.events.get(id).then((event) => {
    const e = event || {
      title: "", prof: "", room: "", type: "",
      subject: "default",
      start: Date.now(), end: Date.now() + HOUR,
    };

    const scrim = document.createElement("div");
    scrim.className = "scrim sheet-bottom";
    scrim.innerHTML = `
      <div class="sheet bottom">
        <div class="sheet-header">
          <h3>${id ? "Edit" : "New"} event</h3>
          <button class="btn icon" data-act="close">✕</button>
        </div>
        <div class="col gap-3">
          <input class="input" id="ev-title" placeholder="Title" value="${escapeHtml(e.title)}" />
          <div class="row gap-2">
            <input class="input" id="ev-prof" placeholder="Prof / Teacher" value="${escapeHtml(e.prof || "")}" />
            <input class="input" id="ev-room" placeholder="Room" value="${escapeHtml(e.room || "")}" />
          </div>
          <div class="row gap-2">
            <input class="input" id="ev-start" type="datetime-local"
                   value="${toLocalDateTime(e.start)}" />
            <input class="input" id="ev-end" type="datetime-local"
                   value="${toLocalDateTime(e.end)}" />
          </div>
          <select class="input" id="ev-type">
            <option value="">—</option>
            <option value="Lecture" ${e.type === "Lecture" ? "selected" : ""}>Lecture</option>
            <option value="Homework" ${e.type === "Homework" ? "selected" : ""}>Homework</option>
            <option value="Referat" ${e.type === "Referat" ? "selected" : ""}>Referat</option>
            <option value="Exam" ${e.type === "Exam" ? "selected" : ""}>Exam</option>
          </select>
          <div class="row gap-2">
            ${id ? `<button class="btn danger" data-act="del" style="margin-right:auto">Delete</button>` : ""}
            <button class="btn primary" data-act="save">Save</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(scrim);

    const close = () => scrim.remove();
    scrim.querySelector('[data-act="close"]').addEventListener("click", close);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });

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

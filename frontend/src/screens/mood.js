/* screens/mood.js — v2.38.1 mood tracker.
 *
 * Was a readout inside a modal in the journal, reachable from one link.
 * It is a screen now, because the question "how have I actually been?"
 * is not answered by a hover.
 *
 * Everything on it is measured: the streak counts days you logged, the
 * averages are over days you logged (and say how many), and the chart
 * has an axis. There is no "7" in a template.
 */

import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";
import { showToast } from "../widgets/toast.js";

const BASE = detectApiBase();

const FACES = [
  { v: 1, emoji: "😞", label: "Muy bajo" },
  { v: 2, emoji: "😕", label: "Bajo" },
  { v: 3, emoji: "😐", label: "Normal" },
  { v: 4, emoji: "🙂", label: "Bueno" },
  { v: 5, emoji: "😄", label: "Muy bueno" },
];

const RANGES = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
  { days: 365, label: "Año" },
];

let range = 30;
let entries = [];
let saving = false;

const faceOf = (v) => FACES.find((f) => f.v === v) ?? FACES[2];
const colorOf = (v) =>
  v >= 4 ? "var(--m-ok, #34d399)" : v === 3 ? "var(--m-warn, #ffa53d)" : "var(--m-danger, #ff4d6d)";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function renderMood(root) {
  root.innerHTML = `
    <section class="screen m-screen mood">
      <div style="padding:calc(var(--m-safe-t) + 18px) 4px 10px">
        <p class="m-eyebrow">Diario</p>
        <h1 class="m-display">CÓMO<br>ESTÁS</h1>
        <p class="m-body">Un toque al día. Nada más.</p>
      </div>
      <div data-mood-host></div>
    </section>
  `;
  const host = root.querySelector("[data-mood-host]");
  paint(host);
  await load(host);
  paint(host);
}

async function load(host) {
  try {
    const r = await fetch(`${BASE}/api/v1/journal/mood-history?days=${range}`, { headers: authHeaders() });
    if (r.ok) entries = (await r.json()).entries ?? [];
  } catch {
    // Offline. Show the empty state rather than pretending there is data.
    entries = [];
  }
}

function stats(list) {
  const logged = list.filter((e) => e.mood);
  const sum = logged.reduce((s, e) => s + e.mood, 0);
  const avg = logged.length ? sum / logged.length : null;

  // A streak that ends yesterday is still alive: the day is not over.
  let streak = 0;
  const set = new Set(logged.map((e) => e.date));
  let cursor = new Date();
  if (!set.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(dayKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }

  const last7 = list.slice(-7);
  const w7 = last7.filter((e) => e.mood);
  const avg7 = w7.length ? w7.reduce((s, e) => s + e.mood, 0) / w7.length : null;

  return { logged: logged.length, avg, streak, avg7, coverage: list.length ? logged.length / list.length : 0 };
}

function paint(host) {
  const s = stats(entries);
  const today = dayKey(new Date());
  const todayEntry = entries.find((e) => e.date === today);

  host.innerHTML = `
    <div class="mood-today">
      <h2>Hoy</h2>
      <div class="mood-faces">
        ${FACES.map((f) => `
          <button class="mood-face ${todayEntry?.mood === f.v ? "is-on" : ""}"
                  data-mood-set="${f.v}" aria-label="${esc(f.label)}" aria-pressed="${todayEntry?.mood === f.v}">
            <span class="mood-face-emoji">${f.emoji}</span>
            <span class="mood-face-lbl">${f.label}</span>
          </button>`).join("")}
      </div>
      <p class="mood-today-note">
        ${todayEntry?.mood
          ? `Registrado como <strong>${esc(faceOf(todayEntry.mood).label)}</strong>.`
          : "Sin registrar hoy."}
      </p>
    </div>

    <div class="mood-stats">
      <div class="m-stat"><div class="m-stat-num">${s.streak > 0 ? s.streak : "—"}</div><div class="m-stat-lbl">Días seguidos</div></div>
      <div class="m-stat"><div class="m-stat-num">${s.avg !== null ? s.avg.toFixed(1) : "—"}</div><div class="m-stat-lbl">Media ${range} d</div></div>
      <div class="m-stat"><div class="m-stat-num">${s.logged}</div><div class="m-stat-lbl">Días anotados</div></div>
    </div>

    <nav class="mood-ranges">
      ${RANGES.map((r) => `
        <button class="mood-range ${r.days === range ? "is-on" : ""}" data-mood-range="${r.days}">${r.label}</button>`).join("")}
    </nav>

    <div class="mood-chart" data-mood-chart>${chartHtml()}</div>

    <div class="mood-legend">
      <span class="mood-legend-item"><i style="background:${colorOf(5)}"></i> bueno</span>
      <span class="mood-legend-item"><i style="background:${colorOf(3)}"></i> normal</span>
      <span class="mood-legend-item"><i style="background:${colorOf(1)}"></i> bajo</span>
      <span class="mood-legend-spacer"></span>
      <span>${Math.round(s.coverage * 100)}% de días con registro</span>
    </div>

    ${trendList()}
  `;
  wire(host);
}

function chartHtml() {
  if (!entries.length) {
    return `<p class="m-muted mood-empty">Sin datos todavía. Registra un día para empezar.</p>`;
  }
  const n = entries.length;
  const W = 100;
  const H = 42;
  const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => v ? H - ((v - 1) / 4) * H : H;

  const pts = entries.map((e, i) => `${x(i).toFixed(2)},${y(e.mood).toFixed(2)}`).join(" ");
  const dots = entries.map((e, i) => (e.mood
    ? `<circle cx="${x(i).toFixed(2)}" cy="${y(e.mood).toFixed(2)}" r="1.3" fill="${colorOf(e.mood)}"><title>${esc(e.date)} · ${faceOf(e.mood).label}</title></circle>`
    : `<circle cx="${x(i).toFixed(2)}" cy="${H}" r="0.7" fill="var(--m-hairline)"/>`)).join("");

  return `
    <svg viewBox="0 0 ${W} ${H + 4}" class="mood-svg" preserveAspectRatio="none" role="img"
         aria-label="Tendencia de ánimo de los últimos ${n} días">
      <line x1="0" y1="${y(3).toFixed(2)}" x2="${W}" y2="${y(3).toFixed(2)}" stroke="var(--m-hairline)" stroke-dasharray="2 2" stroke-width="0.3"/>
      <polyline points="${pts}" fill="none" stroke="var(--m-primary, #7c5cff)" stroke-width="0.8" stroke-linejoin="round"/>
      ${dots}
    </svg>`;
}

/** The days worth looking at, not a wall of 365 rows. */
function trendList() {
  const recent = [...entries].reverse().filter((e) => e.mood).slice(0, 14);
  if (!recent.length) return "";
  return `
    <h3 class="mood-list-h">Últimos registros</h3>
    <div class="mood-clear"></div>
    <div class="mood-list">
      ${recent.map((e) => `
        <div class="mood-list-row">
          <span class="mood-list-emoji">${faceOf(e.mood).emoji}</span>
          <span class="mood-list-date">${esc(e.date)}</span>
          <span class="mood-list-label">${esc(faceOf(e.mood).label)}</span>
        </div>`).join("")}
    </div>`;
}

function wire(host) {
  host.querySelectorAll("[data-mood-range]").forEach((b) =>
    b.addEventListener("click", async () => {
      range = Number(b.dataset.moodRange);
      await load(host);
      paint(host);
    }));

  host.querySelectorAll("[data-mood-set]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (saving) return;
      const v = Number(b.dataset.moodSet);
      const existing = entries.find((e) => e.date === dayKey(new Date()));
      saving = true;
      try {
        // The mood hangs off a daily journal note, not off a date.
        // POST /journal/today is get-or-create, so a first-ever log does
        // not need a separate "create the journal entry" step.
        const jr = await fetch(`${BASE}/api/v1/journal/today`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ date: dayKey(new Date()) }),
        });
        if (!jr.ok) throw new Error(`HTTP ${jr.status}`);
        const j = await jr.json();

        // Same endpoint the journal screen uses, so a mood logged here
        // and a mood logged there are the same row, not two.
        const r = await fetch(`${BASE}/api/v1/journal/${j.id}/mood`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ score: v }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await load(host);
        paint(host);
        showToast(`Registrado: ${faceOf(v).label}`);
      } catch (e) {
        showToast(`No se pudo guardar: ${e.message}`, "error");
      } finally {
        saving = false;
      }
    }));
}

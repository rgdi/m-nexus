/* ============================================================
 * widgets/github_heatmap.js — GitHub-style contribution heatmap.
 *
 * v2.35.0 — 53 weeks × 7 days grid, 5 intensity levels, tooltips,
 * horizontal scroll on mobile, month labels + weekday labels.
 *
 * Data: GET /api/v1/progress/heatmap?weeks=53
 *   → { weeks, start, end, today, days[], totals }
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_LABELS = ["", "L", "", "M", "", "J", ""]; // Sun..Sat (ES single letters)

/**
 * mountHeatmap(host, opts)
 * @param opts.weeks  number  default 53
 * @param opts.lang   "es" | "en"
 * @param opts.onTap  (day) => void
 */
export function mountHeatmap(host, opts = {}) {
  const weeks = opts.weeks ?? 53;
  const lang = opts.lang ?? "es";
  const months = lang === "en" ? MONTHS_EN : MONTHS_ES;

  host.innerHTML = `
    <section class="m-heat" aria-label="Mapa de actividad">
      <div class="m-chart-head">
        <div>
          <div class="m-eyebrow">Actividad</div>
          <h3 class="m-chart-title" data-heat-title>Cargando…</h3>
        </div>
        <div class="m-chart-value" data-heat-streak>—</div>
      </div>
      <div class="m-heat-scroll">
        <div class="m-heat-months" data-heat-months></div>
        <div class="m-heat-wrap">
          <div class="m-heat-dows" aria-hidden="true">${DOW_LABELS.map((d) => `<span>${d}</span>`).join("")}</div>
          <div class="m-heat-grid" data-heat-grid role="grid" aria-label="Días"></div>
        </div>
      </div>
      <div class="m-heat-legend">
        <span>Menos</span>
        ${[0, 1, 2, 3, 4].map((lv) => `<span class="m-heat-cell" data-lv="${lv}"></span>`).join("")}
        <span>Más</span>
      </div>
    </section>
  `;

  const grid = host.querySelector("[data-heat-grid]");
  const monthsEl = host.querySelector("[data-heat-months]");
  const titleEl = host.querySelector("[data-heat-title]");
  const streakEl = host.querySelector("[data-heat-streak]");

  // Tooltip singleton
  let tip = null;
  function showTip(el, day) {
    hideTip();
    tip = document.createElement("div");
    tip.className = "m-heat-tip";
    const n = day.reviews;
    tip.innerHTML = `<b>${n} ${n === 1 ? "review" : "reviews"}</b>${day.date}${day.minutes ? ` · ${Math.round(day.minutes)} min` : ""}`;
    document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    tip.style.left = `${r.left + r.width / 2}px`;
    tip.style.top = `${r.top - 10}px`;
  }
  function hideTip() {
    if (tip) { tip.remove(); tip = null; }
  }

  fetch(`${BASE}/api/v1/progress/heatmap?weeks=${weeks}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((data) => render(data))
    .catch((e) => {
      grid.innerHTML = "";
      titleEl.textContent = "Sin datos de actividad";
      streakEl.textContent = "—";
      const p = document.createElement("p");
      p.className = "m-muted";
      p.style.fontSize = "13px";
      p.textContent = `No se pudo cargar el mapa (${e.message}).`;
      grid.appendChild(p);
    });

  function render(data) {
    const { days, totals, today } = data;
    grid.innerHTML = "";

    // Build month labels aligned to column starts
    const monthCells = [];
    let lastMonth = -1;
    for (let i = 0; i < days.length; i += 7) {
      const d = days[i];
      const m = parseInt(d.date.slice(5, 7), 10) - 1;
      if (m !== lastMonth) {
        monthCells.push(`<span style="grid-column:${i / 7 + 1}">${months[m]}</span>`);
        lastMonth = m;
      }
    }
    monthsEl.innerHTML = monthCells.join("");
    monthsEl.style.gridTemplateColumns = `repeat(${Math.ceil(days.length / 7)}, 13px)`;

    // Cells
    const frag = document.createDocumentFragment();
    for (const d of days) {
      const b = document.createElement("button");
      b.className = "m-heat-cell";
      b.dataset.lv = String(d.future ? 0 : d.level);
      if (d.date === today) b.classList.add("is-today");
      b.dataset.date = d.date;
      b.dataset.reviews = String(d.reviews);
      b.setAttribute("role", "gridcell");
      b.setAttribute(
        "aria-label",
        `${d.date}: ${d.reviews} reviews${d.minutes ? `, ${Math.round(d.minutes)} minutos` : ""}`,
      );
      // Touch/hover tooltip
      b.addEventListener("mouseenter", () => showTip(b, d));
      b.addEventListener("mouseleave", hideTip);
      b.addEventListener("focus", () => showTip(b, d));
      b.addEventListener("blur", hideTip);
      b.addEventListener("touchstart", () => showTip(b, d), { passive: true });
      if (opts.onTap) b.addEventListener("click", () => opts.onTap(d));
      frag.appendChild(b);
    }
    grid.appendChild(frag);
    window.addEventListener("scroll", hideTip, { passive: true });

    // Headline numbers
    titleEl.textContent = `${totals.reviews} reviews · ${totals.activeDays} días`;
    streakEl.innerHTML = totals.currentStreak > 0
      ? `🔥 ${totals.currentStreak}`
      : "—";

    // Expose totals for the caller
    host._heatTotals = totals;
  }

  return {
    destroy() { hideTip(); host.innerHTML = ""; },
  };
}

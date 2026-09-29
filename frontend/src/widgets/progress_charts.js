/* ============================================================
 * widgets/progress_charts.js — Dependency-free SVG charts.
 *
 * v2.35.0 — Line (area), bar, donut, sparkline. All hand-rolled SVG
 * so we add zero bytes to the bundle and render instantly on mobile.
 *
 * Data sources:
 *   - mountLineChart   → GET /api/v1/progress/series?days=N
 *   - mountBarChart    → GET /api/v1/progress/retention?weeks=N
 *   - mountDonut       → GET /api/v1/progress/breakdown
 *   - mountSparkline   → inline data (no fetch)
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";

const BASE = detectApiBase();

/* Shared gradient defs (idempotent, injected once) */
let defsInjected = false;
function ensureDefs() {
  if (defsInjected) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0";
  svg.innerHTML = `
    <defs>
      <linearGradient id="mAreaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--m-accent)" stop-opacity=".34"/>
        <stop offset="100%" stop-color="var(--m-accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>`;
  document.body.appendChild(svg);
  defsInjected = true;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": String.fromCharCode(38) + "amp;",
  "<": String.fromCharCode(38) + "lt;",
  ">": String.fromCharCode(38) + "gt;",
  '"': String.fromCharCode(38) + "quot;",
  "'": String.fromCharCode(38) + "#39;",
}[c]));

function nice(n) { return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }

/* ============================================================
 * Line / area chart — reviews per day
 * ============================================================ */
export function mountLineChart(host, opts = {}) {
  const days = opts.days ?? 30;
  ensureDefs();

  host.innerHTML = `
    <section class="m-chart">
      <div class="m-chart-head">
        <div>
          <div class="m-eyebrow">${esc(opts.eyebrow ?? "Ritmo")}</div>
          <h3 class="m-chart-title">${esc(opts.title ?? "Reviews por día")}</h3>
        </div>
        <div class="m-chart-value" data-line-total>—</div>
      </div>
      <div data-line-body>
        <div class="m-empty-state" style="padding:24px">
          <span class="m-emoji">📈</span>
          <p>Cargando…</p>
        </div>
      </div>
    </section>
  `;
  const body = host.querySelector("[data-line-body]");
  const totalEl = host.querySelector("[data-line-total]");

  fetch(`${BASE}/api/v1/progress/series?days=${days}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => render(d.points))
    .catch((e) => {
      body.innerHTML = `<div class="m-empty-state" style="padding:24px">
        <span class="m-emoji">📉</span><p>Sin datos (${esc(e.message)})</p></div>`;
    });

  function render(points) {
    if (!points?.length) {
      body.innerHTML = `<div class="m-empty-state" style="padding:24px">
        <span class="m-emoji">🌱</span><p>Aún no hay reviews. ¡Empieza hoy!</p></div>`;
      return;
    }
    const W = 320, H = 128, PAD_X = 6, PAD_Y = 12;
    const max = Math.max(1, ...points.map((p) => p.reviews));
    const stepX = (W - PAD_X * 2) / Math.max(1, points.length - 1);
    const y = (v) => H - PAD_Y - (v / max) * (H - PAD_Y * 2);

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${(PAD_X + i * stepX).toFixed(1)},${y(p.reviews).toFixed(1)}`).join(" ");
    const area = `${line} L${(PAD_X + (points.length - 1) * stepX).toFixed(1)},${H} L${PAD_X},${H} Z`;

    // Peak marker
    const peakIdx = points.reduce((best, p, i) => (p.reviews > points[best].reviews ? i : best), 0);

    // X labels: first / mid / last
    const lbl = (i, anchor) => `<text class="m-axis-lbl" x="${(PAD_X + i * stepX).toFixed(1)}" y="${H + 4}" text-anchor="${anchor}">${points[i].date.slice(8)}/${points[i].date.slice(5, 7)}</text>`;
    const last = points.length - 1;
    const mid = Math.floor(last / 2);

    body.innerHTML = `
      <svg viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="Reviews por día">
        <line class="m-axis" x1="0" y1="${H}" x2="${W}" y2="${H}"/>
        <text class="m-axis-lbl" x="${PAD_X}" y="9">max ${max}</text>
        <path class="m-chart-area" d="${area}"/>
        <path class="m-chart-line" d="${line}"/>
        <circle class="m-chart-dot" cx="${(PAD_X + peakIdx * stepX).toFixed(1)}" cy="${y(points[peakIdx].reviews).toFixed(1)}" r="3.5"/>
        ${lbl(0, "start")}${lbl(mid, "middle")}${lbl(last, "end")}
      </svg>`;
    const sum = points.reduce((s, p) => s + p.reviews, 0);
    totalEl.textContent = nice(sum);
  }
}

/* ============================================================
 * Bar chart — weekly retention
 * ============================================================ */
export function mountBarChart(host, opts = {}) {
  const weeks = opts.weeks ?? 12;
  ensureDefs();

  host.innerHTML = `
    <section class="m-chart">
      <div class="m-chart-head">
        <div>
          <div class="m-eyebrow">${esc(opts.eyebrow ?? "Memoria")}</div>
          <h3 class="m-chart-title">${esc(opts.title ?? "Retención semanal")}</h3>
        </div>
        <div class="m-chart-value" data-bar-val>—</div>
      </div>
      <div data-bar-body>
        <div class="m-empty-state" style="padding:24px"><p>Cargando…</p></div>
      </div>
    </section>
  `;
  const body = host.querySelector("[data-bar-body]");
  const valEl = host.querySelector("[data-bar-val]");

  fetch(`${BASE}/api/v1/progress/retention?weeks=${weeks}`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => render(d.points))
    .catch((e) => {
      body.innerHTML = `<div class="m-empty-state" style="padding:24px">
        <span class="m-emoji">📊</span><p>Sin datos (${esc(e.message)})</p></div>`;
    });

  function render(points) {
    const active = points.filter((p) => p.reviews > 0);
    if (!active.length) {
      body.innerHTML = `<div class="m-empty-state" style="padding:24px">
        <span class="m-emoji">🧠</span><p>Sin reviews registrados todavía</p></div>`;
      return;
    }
    const W = 320, H = 110, PAD = 8, GAP = 4;
    const bw = (W - PAD * 2) / points.length;
    const bars = points.map((p, i) => {
      const h = Math.max(2, p.retention * (H - PAD * 2));
      const x = PAD + i * bw;
      const y = H - PAD - h;
      const col = p.retention >= 0.9 ? "var(--m-ok)" : p.retention >= 0.75 ? "var(--m-warn)" : "var(--m-danger)";
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(3, bw - GAP).toFixed(1)}" height="${h.toFixed(1)}"
        rx="3" fill="${col}" opacity="${p.reviews > 0 ? 1 : 0.18}"><title>${p.weekStart}: ${Math.round(p.retention * 100)}% (${p.reviews} reviews)</title></rect>`;
    }).join("");

    const avg = active.reduce((s, p) => s + p.retention, 0) / active.length;
    body.innerHTML = `
      <svg viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="Retención semanal">
        <line class="m-axis" x1="0" y1="${H - PAD}" x2="${W}" y2="${H - PAD}"/>
        ${bars}
        <text class="m-axis-lbl" x="${PAD}" y="${H + 4}">${points[0].weekStart.slice(5)}</text>
        <text class="m-axis-lbl" x="${W - PAD}" y="${H + 4}" text-anchor="end">${points[points.length - 1].weekStart.slice(5)}</text>
      </svg>`;
    valEl.textContent = `${Math.round(avg * 100)}%`;
  }
}

/* ============================================================
 * Donut — reviews per subject
 * ============================================================ */
export function mountDonut(host, opts = {}) {
  ensureDefs();

  host.innerHTML = `
    <section class="m-chart">
      <div class="m-chart-head">
        <div>
          <div class="m-eyebrow">${esc(opts.eyebrow ?? "Distribución")}</div>
          <h3 class="m-chart-title">${esc(opts.title ?? "Reviews por asignatura")}</h3>
        </div>
      </div>
      <div data-donut-body>
        <div class="m-empty-state" style="padding:24px"><p>Cargando…</p></div>
      </div>
    </section>
  `;
  const body = host.querySelector("[data-donut-body]");

  fetch(`${BASE}/api/v1/progress/breakdown`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((d) => render(d.slices || [], d.totalReviews || 0))
    .catch((e) => {
      body.innerHTML = `<div class="m-empty-state" style="padding:24px">
        <span class="m-emoji">🍩</span><p>Sin datos (${esc(e.message)})</p></div>`;
    });

  function render(slices, total) {
    if (!slices.length) {
      body.innerHTML = `<div class="m-empty-state" style="padding:24px">
        <span class="m-emoji">🎯</span><p>Crea flashcards para ver tu distribución</p></div>`;
      return;
    }
    const R = 44, C = 2 * Math.PI * R, GAP = slices.length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = slices.map((s) => {
      const frac = total > 0 ? s.reviews / total : 0;
      const len = Math.max(0, frac * C - GAP);
      const el = `<circle r="${R}" cx="58" cy="58"
        stroke="${s.color}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
        stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 58 58)">
        <title>${esc(s.subject)}: ${s.reviews}</title></circle>`;
      offset += frac * C;
      return el;
    }).join("");

    const legend = slices.map((s) => `
      <div class="m-legend-row">
        <span class="m-legend-dot" style="background:${s.color}"></span>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.subject)}</span>
        <span class="m-legend-val">${nice(s.reviews)}</span>
      </div>`).join("");

    body.innerHTML = `
      <div class="m-donut-wrap">
        <svg class="m-donut" viewBox="0 0 116 116" role="img" aria-label="Distribución por asignatura">
          ${arcs}
          <text x="58" y="54" text-anchor="middle" style="font-size:19px;font-weight:850;fill:var(--m-ink);font-family:var(--m-font)">${nice(total)}</text>
          <text x="58" y="70" text-anchor="middle" style="font-size:9px;font-weight:700;fill:var(--m-ink-4);font-family:var(--m-font)">reviews</text>
        </svg>
        <div class="m-legend">${legend}</div>
      </div>`;
  }
}

/* ============================================================
 * Sparkline (inline, no fetch)
 * ============================================================ */
export function sparkline(values, opts = {}) {
  const w = opts.width ?? 120;
  const h = opts.height ?? 34;
  if (!values || values.length < 2) return "";
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const range = max - min || 1;
  const stepX = w / (values.length - 1);
  const y = (v) => h - 2 - ((v - min) / range) * (h - 4);
  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg class="m-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${d}"/></svg>`;
}

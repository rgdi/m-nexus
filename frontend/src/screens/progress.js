/* screens/progress.js — Progress screen (heatmap + charts).
 *
 * v2.35.0 — "MI PROGRESO" screen. GitHub-style contribution heatmap,
 * reviews/day line chart, weekly retention bars, per-subject donut.
 * All data from /api/v1/progress/*.
 */

import { mountHeatmap } from "../widgets/github_heatmap.js";
import { mountLineChart, mountBarChart, mountDonut } from "../widgets/progress_charts.js";
import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";

const BASE = detectApiBase();

export async function renderProgress(root) {
  root.innerHTML = `
    <section class="screen m-screen">
      <div style="padding:calc(var(--m-safe-t) + 18px) 4px 14px">
        <p class="m-eyebrow">Rendimiento</p>
        <h1 class="m-display">MI PROGRESO</h1>
      </div>

      <div data-prog-stats class="m-stat-grid">
        <div class="m-stat"><div class="m-stat-num" data-stat-reviews>—</div><div class="m-stat-lbl">Reviews totales</div></div>
        <div class="m-stat"><div class="m-stat-num" data-stat-streak>—</div><div class="m-stat-lbl">Racha actual</div></div>
        <div class="m-stat"><div class="m-stat-num" data-stat-mastered>—</div><div class="m-stat-lbl">Dominadas</div></div>
        <div class="m-stat"><div class="m-stat-num" data-stat-retention>—</div><div class="m-stat-lbl">Retención 30d</div></div>
      </div>

      <div data-prog-heat></div>
      <div data-prog-line></div>
      <div data-prog-bar></div>
      <div data-prog-donut></div>
    </section>
  `;

  // ---- Headline stats ----
  const streakEl = root.querySelector("[data-stat-streak]");
  fetch(`${BASE}/api/v1/progress/heatmap?weeks=53`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : null))
    .then((h) => { if (h) streakEl.textContent = fmt(h.totals.currentStreak); })
    .catch(() => { streakEl.textContent = "0"; });

  fetch(`${BASE}/api/v1/progress/stats`, { headers: authHeaders() })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((s) => {
      root.querySelector("[data-stat-reviews]").textContent = fmt(s.reviewsTotal);
      root.querySelector("[data-stat-mastered]").textContent = fmt(s.cardsMastered);
      root.querySelector("[data-stat-retention]").textContent = `${Math.round((s.retention30 ?? 1) * 100)}%`;
    })
    .catch(() => {});

  // ---- Heatmap ----
  const heatHost = root.querySelector("[data-prog-heat]");
  mountHeatmap(heatHost, {
    weeks: 53,
    onTap: (d) => {
      if (d.reviews === 0) return;
      root.__heatTap?.(d);
    },
  });

  // ---- Charts ----
  mountLineChart(root.querySelector("[data-prog-line]"), { days: 30 });
  mountBarChart(root.querySelector("[data-prog-bar]"), { weeks: 12 });
  mountDonut(root.querySelector("[data-prog-donut]"));
}

function fmt(n) {
  if (n == null) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

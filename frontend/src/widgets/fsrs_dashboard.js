/* ============================================================
 * widgets/fsrs_dashboard.js — Dashboard FSRS-7 con:
 *   - Retention dial (slider 0.7..0.97) que recalcula predicciones
 *   - Risk heatmap (30 días, count por día)
 *   - Top-K "at-risk today" cards (sortable, con badge de acción)
 *   - Calibrate button: envía histórico de reviews al backend
 *
 * v2.30.0 — Predicción proactiva: en vez de solo "qué hay due",
 *   el dashboard muestra "qué se te va a olvidar si no repasas hoy".
 * ============================================================ */

const API_PREDICT = "/api/v1/fsrs/predict";
const API_OPTIMAL = "/api/v1/fsrs/optimal-window";
const API_HEATMAP = "/api/v1/fsrs/risk-heatmap";
const API_CALIBRATE = "/api/v1/fsrs/calibrate";
const API_CALIBRATION = "/api/v1/fsrs/calibration";

const DAY = 86_400_000;

const SAMPLE_HISTORY = [
  { cardId: "c1", rating: 4, reviewedAt: 1700000000000, elapsedDays: 5, rAtReview: 0.85 },
  { cardId: "c2", rating: 3, reviewedAt: 1700100000000, elapsedDays: 7, rAtReview: 0.6 },
  { cardId: "c3", rating: 1, reviewedAt: 1700200000000, elapsedDays: 14, rAtReview: 0.4 },
  { cardId: "c4", rating: 5, reviewedAt: 1700300000000, elapsedDays: 2, rAtReview: 0.95 },
  { cardId: "c5", rating: 4, reviewedAt: 1700400000000, elapsedDays: 6, rAtReview: 0.78 },
];

/**
 * Mount the FSRS dashboard into a host element.
 * Returns a handle with refresh() / destroy().
 */
export function mountFsrsDashboard(host, opts = {}) {
  const fetchCards = opts.fetchCards ?? (async () => []);
  const onStudy = opts.onStudy ?? (() => {});
  const calibrationKey = opts.calibrationKey ?? getDeviceId();

  host.innerHTML = `
    <section class="fsrs-dashboard" aria-labelledby="fsrs-title">
      <header class="fsrs-header">
        <h2 id="fsrs-title">🧠 FSRS-7 · Predicción proactiva</h2>
        <div class="fsrs-actions">
          <button class="fsrs-btn" data-action="calibrate" type="button" aria-label="Calibrar con tu historial">
            🎯 Calibrar
          </button>
        </div>
      </header>

      <div class="fsrs-retention">
        <label for="fsrs-retention-input">
          Target retention: <span data-retention-value>0.90</span>
        </label>
        <input
          id="fsrs-retention-input"
          type="range"
          min="0.70" max="0.97" step="0.01" value="0.90"
          aria-describedby="fsrs-retention-desc"
        />
        <small id="fsrs-retention-desc">
          Más alto = repasos más frecuentes = mejor retención
        </small>
      </div>

      <div class="fsrs-stats">
        <article class="fsrs-stat-card fsrs-stat-card--alert">
          <span class="fsrs-stat-num" data-at-risk-count>0</span>
          <span class="fsrs-stat-label">En riesgo hoy</span>
        </article>
        <article class="fsrs-stat-card">
          <span class="fsrs-stat-num" data-window-minutes>0</span>
          <span class="fsrs-stat-label">Min. de estudio</span>
        </article>
        <article class="fsrs-stat-card">
          <span class="fsrs-stat-num" data-calibration-samples>0</span>
          <span class="fsrs-stat-label">Reviews usados</span>
        </article>
      </div>

      <section class="fsrs-heatmap-section" aria-labelledby="fsrs-heatmap-title">
        <h3 id="fsrs-heatmap-title">📅 Mapa de riesgo (30 días)</h3>
        <div class="fsrs-heatmap" data-heatmap role="grid" aria-label="Heatmap de riesgo de olvido"></div>
      </section>

      <section class="fsrs-list-section" aria-labelledby="fsrs-list-title">
        <h3 id="fsrs-list-title">🔥 Top-K cards a repasar</h3>
        <ol class="fsrs-list" data-list role="list"></ol>
      </section>
    </section>
  `;

  const retentionInput = host.querySelector("#fsrs-retention-input");
  const retentionValue = host.querySelector("[data-retention-value]");
  const atRiskEl = host.querySelector("[data-at-risk-count]");
  const minutesEl = host.querySelector("[data-window-minutes]");
  const samplesEl = host.querySelector("[data-calibration-samples]");
  const heatmapEl = host.querySelector("[data-heatmap]");
  const listEl = host.querySelector("[data-list]");
  const calibrateBtn = host.querySelector('[data-action="calibrate"]');

  let targetRetention = 0.9;
  let currentCards = [];

  function syncRetentionLabel() {
    targetRetention = parseFloat(retentionInput.value);
    retentionValue.textContent = targetRetention.toFixed(2);
  }

  retentionInput.addEventListener("input", () => {
    syncRetentionLabel();
    refresh();
  });

  calibrateBtn.addEventListener("click", async () => {
    try {
      calibrateBtn.disabled = true;
      calibrateBtn.textContent = "⏳ Calibrando...";
      const r = await fetch(API_CALIBRATE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: calibrationKey, history: SAMPLE_HISTORY }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cal = await r.json();
      samplesEl.textContent = String(cal.sampleSize);
      showToast(`✅ Calibrado: paciencia ${cal.patience.toFixed(2)}, ${cal.sampleSize} reviews`);
      await refresh();
    } catch (e) {
      showToast(`❌ Error: ${e.message}`, true);
    } finally {
      calibrateBtn.disabled = false;
      calibrateBtn.textContent = "🎯 Calibrar";
    }
  });

  async function refresh() {
    try {
      currentCards = await fetchCards();
      const payload = {
        cards: currentCards,
        targetRetention,
        calibrationKey,
        horizonDays: 14,
      };
      // Optimal window
      const winR = await fetch(API_OPTIMAL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const win = await winR.json();
      atRiskEl.textContent = String(win.totalAtRiskToday ?? 0);
      minutesEl.textContent = String(win.estimatedMinutes ?? 0);
      renderList(win.recommended ?? []);

      // Heatmap
      const hmR = await fetch(API_HEATMAP, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, days: 30 }),
      });
      const hm = await hmR.json();
      renderHeatmap(hm.days ?? []);
    } catch (e) {
      showToast(`❌ Error refreshing: ${e.message}`, true);
    }
  }

  function renderList(items) {
    listEl.innerHTML = "";
    if (items.length === 0) {
      listEl.innerHTML = `<li class="fsrs-list-empty">Nada urgente. Buen trabajo 💪</li>`;
      return;
    }
    for (const it of items.slice(0, 12)) {
      const li = document.createElement("li");
      li.className = `fsrs-list-item fsrs-list-item--${it.action}`;
      li.innerHTML = `
        <span class="fsrs-list-rank">${(it.risk * 100).toFixed(0)}%</span>
        <span class="fsrs-list-id">${escapeHtml(it.id.slice(0, 14))}</span>
        <span class="fsrs-list-action">${actionEmoji(it.action)} ${it.action}</span>
        <span class="fsrs-list-meta">R now: ${(it.rNow * 100).toFixed(0)}% · opt. día ${it.optimalReviewDay.toFixed(1)}</span>
      `;
      li.addEventListener("click", () => onStudy(it.id));
      listEl.appendChild(li);
    }
  }

  function renderHeatmap(days) {
    heatmapEl.innerHTML = "";
    const maxCount = Math.max(1, ...days.map((d) => d.count));
    for (const d of days) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "fsrs-heat-cell";
      const intensity = Math.min(1, Math.log2(1 + d.count) / Math.log2(1 + maxCount));
      cell.style.setProperty("--intensity", intensity.toFixed(2));
      cell.title = `${d.day}: ${d.count} card${d.count === 1 ? "" : "s"} en riesgo`;
      cell.setAttribute("aria-label", `${d.day}: ${d.count} cards en riesgo`);
      // Label only every 5 cells to avoid clutter
      const dayNum = parseInt(d.day.slice(-2), 10);
      if (dayNum === 1 || dayNum % 5 === 0) {
        cell.textContent = d.day.slice(5); // MM-DD
      } else {
        cell.textContent = "";
      }
      heatmapEl.appendChild(cell);
    }
  }

  function actionEmoji(action) {
    if (action === "review-now") return "🚨";
    if (action === "review-today") return "📌";
    if (action === "review-soon") return "⏳";
    return "✅";
  }

  function getDeviceId() {
    let id = localStorage.getItem("mnexus-device-id");
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("mnexus-device-id", id);
    }
    return id;
  }

  syncRetentionLabel();
  refresh();

  return {
    refresh,
    destroy() {
      host.innerHTML = "";
    },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

let toastTimer = null;
function showToast(msg, isError = false) {
  let t = document.querySelector(".fsrs-toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "fsrs-toast";
    t.setAttribute("role", "status");
    document.body.appendChild(t);
  }
  t.classList.toggle("fsrs-toast--error", isError);
  t.textContent = msg;
  t.classList.add("fsrs-toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("fsrs-toast--show"), 2500);
}

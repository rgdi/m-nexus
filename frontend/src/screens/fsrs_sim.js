/* ============================================================
 * fsrs_sim.js — Day-by-day FSRS simulator UI (v2.9.0).
 *
 * User specifies: deck size, days, daily capacity, simulated retention.
 * Backend runs actual FSRS algorithm day-by-day with the calibrated
 * params. UI shows:
 *   - Per-day stats (reviews, new, retention)
 *   - Retention curve over time
 *   - Final card states (stability, difficulty, due days)
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { escapeHtml } from "../services/safe.js";

export async function renderFsrsSim(root) {
  root.innerHTML = `
    <div class="screen fsrs-sim-screen">
      <header class="screen-header">
        <button class="btn icon" id="back" aria-label="Back">←</button>
        <h1 class="h-title">${i18n.t("fsrs.title") || "FSRS day-by-day simulator"}</h1>
        <span class="h-sub">${i18n.t("fsrs.subtitle") || "Watch actual FSRS scheduling over N days"}</span>
      </header>

      <div class="sim-config card">
        <div class="sim-row">
          <label>${i18n.t("fsrs.deckSize") || "Deck size (cards)"}</label>
          <input class="input" id="deck" type="number" value="30" min="5" max="500" />
        </div>
        <div class="sim-row">
          <label>${i18n.t("fsrs.days") || "Days to simulate"}</label>
          <input class="input" id="days" type="number" value="14" min="1" max="60" />
        </div>
        <div class="sim-row">
          <label>${i18n.t("fsrs.maxReviews") || "Max reviews/day"}</label>
          <input class="input" id="maxR" type="number" value="40" min="5" max="200" />
        </div>
        <div class="sim-row">
          <label>${i18n.t("fsrs.retention") || "Simulated retention"}</label>
          <input class="input" id="ret" type="number" value="85" min="0" max="100" />
          <span class="muted">%</span>
        </div>
        <div class="sim-row">
          <label>${i18n.t("fsrs.initialDiff") || "Initial difficulty (1-10)"}</label>
          <input class="input" id="diff" type="number" value="5" min="1" max="10" />
        </div>
        <button class="btn primary" id="run">${i18n.t("fsrs.run") || "Run simulation →"}</button>
      </div>

      <div id="sim-out"></div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => history.back());

  root.querySelector("#run").addEventListener("click", async () => {
    const deck = Number(root.querySelector("#deck").value);
    const days = Number(root.querySelector("#days").value);
    const maxR = Number(root.querySelector("#maxR").value);
    const ret = Number(root.querySelector("#ret").value) / 100;
    const diff = Number(root.querySelector("#diff").value);
    const out = root.querySelector("#sim-out");
    out.innerHTML = `<div class="card"><p class="muted">${i18n.t("common.loading") || "Running…"}</p></div>`;

    try {
      const cards = Array.from({ length: deck }, (_, i) => ({
        id: `c${i}`,
        topicId: "sim",
      }));
      const r = await api.study.simulateFsrs({
        cards,
        days,
        maxDailyReviews: maxR,
        maxNewPerDay: 10,
        defaultRetention: ret,
        diagnostic: {
          fsrsProfile: {
            initialStability: 1,
            initialDifficulty: diff,
            desiredRetention: 0.9,
          },
          knowledgeRatio: 0,
          confidence: 0.5,
        },
      });
      renderResult(out, r);
    } catch (e) {
      out.innerHTML = `<div class="card"><p>Error: ${escapeHtml(e.message)}</p></div>`;
    }
  });
}

function renderResult(root, r) {
  if (!r.ok) {
    root.innerHTML = `<div class="card"><p>Error: ${escapeHtml(r.error || "unknown")}</p></div>`;
    return;
  }
  const days = r.days || [];
  const finalStates = r.finalStates || [];
  const curve = r.retentionCurve || [];

  // Stats
  const totalReviews = r.totalReviews || 0;
  const totalNew = r.totalNewCards || 0;
  const avgRetention = curve.length
    ? curve.reduce((s, x) => s + x, 0) / curve.length
    : 0;
  const finalRetention = curve.length ? curve[curve.length - 1] : 0;

  // Card states distribution
  const stateCount = { 0: 0, 1: 0, 2: 0, 3: 0 };
  finalStates.forEach((s) => { stateCount[s.state] = (stateCount[s.state] || 0) + 1; });

  root.innerHTML = `
    <div class="card">
      <h2>${i18n.t("fsrs.results") || "Simulation results"}</h2>
      <div class="sim-stats">
        <div class="sim-stat"><span class="lbl">Total reviews</span><span class="val">${totalReviews}</span></div>
        <div class="sim-stat"><span class="lbl">New cards</span><span class="val">${totalNew}</span></div>
        <div class="sim-stat"><span class="lbl">Avg retention</span><span class="val">${(avgRetention * 100).toFixed(0)}%</span></div>
        <div class="sim-stat"><span class="lbl">Final retention</span><span class="val">${(finalRetention * 100).toFixed(0)}%</span></div>
      </div>

      <h3>${i18n.t("fsrs.retentionCurve") || "Retention curve"}</h3>
      <div class="sim-curve">
        ${curve.map((r, i) => `<div class="sim-bar" style="height: ${r * 100}%" title="Day ${i + 1}: ${(r * 100).toFixed(0)}%"></div>`).join("")}
      </div>

      <h3>${i18n.t("fsrs.dailyLoad") || "Daily load"}</h3>
      <div class="sim-days">
        ${days.map((d) => `
          <div class="sim-day">
            <div class="sim-day-date">Day ${d.dayIdx + 1}</div>
            <div class="sim-day-load">${d.reviews} reviews · ${d.newLearned} new</div>
            <div class="sim-day-urgency">${(d.retention * 100).toFixed(0)}% ret</div>
          </div>
        `).join("")}
      </div>

      <h3>${i18n.t("fsrs.cardStates") || "Card states distribution"}</h3>
      <div class="sim-states">
        <div class="sim-state"><span class="lbl">New</span><span class="val">${stateCount[0]}</span></div>
        <div class="sim-state"><span class="lbl">Learning</span><span class="val">${stateCount[1]}</span></div>
        <div class="sim-state"><span class="lbl">Review</span><span class="val">${stateCount[2]}</span></div>
        <div class="sim-state"><span class="lbl">Relearning</span><span class="val">${stateCount[3]}</span></div>
      </div>
    </div>
  `;
}

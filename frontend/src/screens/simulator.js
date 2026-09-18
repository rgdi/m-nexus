/* ============================================================
 * simulator.js — Fake recording / future-exam simulation UI (v2.8.0).
 *
 * Workflow:
 * 1. Pick a topic (e.g. "Húmero")
 * 2. Run diagnostic → calibrate FSRS
 * 3. Schedule study sessions based on a simulated exam date
 * 4. Simulate spaced repetition over N days
 * 5. Visualize "knowledge retention curve"
 *
 * This screen DOES NOT modify real data; it's a sandbox.
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { escapeHtml } from "../services/safe.js";

export async function renderSimulator(root) {
  root.innerHTML = `
    <div class="screen simulator-screen">
      <header class="screen-header">
        <button class="btn icon" id="back" aria-label="Back">←</button>
        <h1 class="h-title">${i18n.t("simulator.title") || "Future-exam simulator"}</h1>
        <span class="h-sub">${i18n.t("simulator.subtitle") || "Simulate your study trajectory"}</span>
      </header>

      <div class="sim-config card">
        <div class="sim-row">
          <label>${i18n.t("simulator.topic") || "Topic"}</label>
          <input class="input" id="topic" value="humerus" />
        </div>
        <div class="sim-row">
          <label>${i18n.t("simulator.examDays") || "Days until exam"}</label>
          <input class="input" id="days" type="number" value="14" min="1" max="60" />
        </div>
        <div class="sim-row">
          <label>${i18n.t("simulator.dailyMin") || "Daily study minutes"}</label>
          <input class="input" id="daily" type="number" value="60" min="15" max="240" step="15" />
        </div>
        <div class="sim-row">
          <label>${i18n.t("simulator.knownRatio") || "Knowledge before start"}</label>
          <input class="input" id="ratio" type="number" value="20" min="0" max="100" />
          <span class="muted">%</span>
        </div>
        <button class="btn primary" id="run">${i18n.t("simulator.run") || "Run simulation →"}</button>
      </div>

      <div id="sim-result"></div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => history.back());

  root.querySelector("#run").addEventListener("click", async () => {
    const topic = root.querySelector("#topic").value.trim();
    const days = Number(root.querySelector("#days").value);
    const daily = Number(root.querySelector("#daily").value);
    const ratio = Number(root.querySelector("#ratio").value) / 100;

    const out = root.querySelector("#sim-result");
    out.innerHTML = `<div class="card"><p class="muted">${i18n.t("common.loading") || "Running simulation…"}</p></div>`;

    try {
      const examDate = new Date(Date.now() + days * 86400000).toISOString();
      const r = await api.study.planStudy(
        [{ id: "sim", topicId: topic, topicName: topic, date: examDate, totalTopics: 30 }],
        { [topic]: { knowledgeRatio: ratio, confidence: 0.7, fsrsProfile: { initialStability: 1 + ratio * 10, initialDifficulty: 7 - 5 * ratio, desiredRetention: 0.9 } } },
        { dailyMinutes: daily, targetRetention: 0.9 },
      );
      renderSimResult(out, r.sessions, { topic, days, ratio });
    } catch (e) {
      out.innerHTML = `<div class="card"><p>Error: ${escapeHtml(e.message)}</p></div>`;
    }
  });
}

function renderSimResult(root, sessions, cfg) {
  const totalCards = sessions.reduce((s, x) => s + x.cardsToReview + x.newCardsToLearn, 0);
  const totalMin = sessions.reduce((s, x) => s + x.durationMin, 0);
  // Estimate retention curve: exponential approach to retention goal
  //  retention(t) = goal * (1 - (1-ratio) * exp(-k * t))
  const goal = 0.9;
  const k = 0.2;
  const curve = [];
  for (let d = 0; d <= cfg.days; d++) {
    const r = goal * (1 - (1 - cfg.ratio) * Math.exp(-k * d));
    curve.push({ day: d, retention: r });
  }

  root.innerHTML = `
    <div class="card">
      <h2>${i18n.t("simulator.results") || "Simulation results"}</h2>
      <div class="sim-stats">
        <div class="sim-stat"><span class="lbl">Total sessions</span><span class="val">${sessions.length}</span></div>
        <div class="sim-stat"><span class="lbl">Total minutes</span><span class="val">${totalMin}</span></div>
        <div class="sim-stat"><span class="lbl">Total cards</span><span class="val">${totalCards}</span></div>
      </div>
      <h3>${i18n.t("simulator.retention") || "Predicted retention on exam day"}</h3>
      <div class="sim-curve">
        ${curve.map((p, i) => `
          <div class="sim-bar" style="height: ${p.retention * 100}%" title="Day ${p.day}: ${(p.retention * 100).toFixed(0)}%"></div>
        `).join("")}
      </div>
      <h3>${i18n.t("simulator.daily") || "Daily plan"}</h3>
      <div class="sim-days">
        ${sessions.map((s) => `
          <div class="sim-day sim-urg-${s.urgency}">
            <div class="sim-day-date">${escapeHtml(s.date.slice(5))}</div>
            <div class="sim-day-load">${s.durationMin} min · ${s.cardsToReview + s.newCardsToLearn} cards</div>
            <div class="sim-day-urgency">${s.urgency}</div>
            <div class="sim-day-reason muted">${escapeHtml(s.reason)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

/* ============================================================
 * diagnostic.js — Knowledge diagnostic + study planner UI (v2.8.0).
 *
 * Flow:
 * 1. User picks a topic (or types a syllabus)
 * 2. System generates 8-10 control questions from syllabus (heuristic or LLM)
 * 3. User answers; system computes FSRS starting profile
 * 4. Profile is saved to localStorage and used by future card creation
 *
 * Also: study planner view that shows daily sessions from a planned exam.
 * ============================================================ */

import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { escapeHtml } from "../services/safe.js";
import { dataSource } from "../services/dataSource.js";

const SYLLABUS_KEY = "mnexus.diagnostic.syllabus";
const PROFILE_KEY_PREFIX = "mnexus.fsrs.profile.";

export function saveProfile(topicId, profile) {
  try { localStorage.setItem(PROFILE_KEY_PREFIX + topicId, JSON.stringify(profile)); }
  catch { /* ignore */ }
}

export function getProfile(topicId) {
  try {
    const raw = localStorage.getItem(PROFILE_KEY_PREFIX + topicId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function renderDiagnostic(root) {
  root.innerHTML = `
    <div class="screen diag-screen">
      <header class="screen-header">
        <button class="btn icon" id="back" aria-label="Back">←</button>
        <h1 class="h-title">${i18n.t("diagnostic.title") || "Knowledge diagnostic"}</h1>
        <span class="h-sub">${i18n.t("diagnostic.subtitle") || "Calibrate FSRS before studying"}</span>
      </header>

      <div class="diag-steps" id="diag-steps">
        <div class="diag-step" data-step="1">
          <h2>${i18n.t("diagnostic.s1.title") || "1. Pick a topic & syllabus"}</h2>
          <p class="muted">${i18n.t("diagnostic.s1.help") || "Paste your temario / syllabus below. We'll extract key concepts to ask you about."}</p>
          <div class="diag-row">
            <input class="input" id="topic-id" placeholder="topic id (e.g. humerus)" />
            <button class="btn" id="load-subject">${i18n.t("diagnostic.s1.loadSubject") || "Load from subject"}</button>
          </div>
          <textarea class="input" id="syllabus" rows="10" placeholder="- Concept 1: definition..."></textarea>
          <button class="btn primary" id="start">${i18n.t("diagnostic.s1.start") || "Generate questions →"}</button>
        </div>
      </div>
    </div>
  `;
  root.querySelector("#back").addEventListener("click", () => history.back());

  // Wire load subject button (loads syllabus from a subject name)
  root.querySelector("#load-subject").addEventListener("click", async () => {
    const id = root.querySelector("#topic-id").value.trim();
    if (!id) return;
    try {
      const subjects = await dataSource.subjects.list();
      const subj = subjects.find((s) => s.name?.toLowerCase().includes(id.toLowerCase()) || s.id === id);
      if (subj) {
        root.querySelector("#topic-id").value = subj.id;
        // Pull notes for this subject as syllabus
        const notes = await dataSource.notes.list();
        const filtered = notes.filter((n) => n.subject === subj.id);
        if (filtered.length) {
          root.querySelector("#syllabus").value = filtered
            .map((n) => `- ${n.title}: ${(n.pages || []).flatMap((p) => (p.placeholders || []).map((ph) => ph.text || "")).join("; ")}`)
            .join("\n");
        }
      }
    } catch (e) { console.warn("load subject", e); }
  });

  root.querySelector("#start").addEventListener("click", async () => {
    const topicId = root.querySelector("#topic-id").value.trim();
    const syllabus = root.querySelector("#syllabus").value.trim();
    if (!topicId || !syllabus) {
      alert("Topic id and syllabus required");
      return;
    }
    const btn = root.querySelector("#start");
    btn.disabled = true;
    btn.textContent = i18n.t("common.loading") || "Loading…";
    try {
      const r = await api.study.generateDiagnostic(topicId, syllabus, 10);
      if (!r.questions?.length) {
        alert("No questions generated — try a different syllabus");
        return;
      }
      await renderQuestionsStep(root, topicId, syllabus, r.questions);
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = i18n.t("diagnostic.s1.start") || "Generate questions →";
    }
  });
}

async function renderQuestionsStep(root, topicId, syllabus, questions) {
  let currentIdx = 0;
  const answers = [];
  const startedAt = Date.now();
  const stepEl = root.querySelector("#diag-steps");

  function renderCurrent() {
    if (currentIdx >= questions.length) {
      finish();
      return;
    }
    const q = questions[currentIdx];
    stepEl.innerHTML = `
      <div class="diag-step">
        <h2>${i18n.t("diagnostic.s2.title", { i: currentIdx + 1, n: questions.length })}</h2>
        <div class="diag-progress">
          <div class="diag-progress-bar" style="width: ${(currentIdx / questions.length) * 100}%"></div>
        </div>
        <p class="diag-prompt">${escapeHtml(q.prompt)}</p>
        <textarea class="input" id="answer" rows="4" placeholder="${i18n.t("diagnostic.s2.placeholder") || "Your answer…"}"></textarea>
        <div class="diag-actions">
          <button class="btn primary" id="next">${currentIdx === questions.length - 1
            ? (i18n.t("diagnostic.s2.finish") || "Finish")
            : (i18n.t("diagnostic.s2.next") || "Next →")}</button>
        </div>
      </div>
    `;
    root.querySelector("#answer").focus();
    const startTime = Date.now();
    root.querySelector("#next").addEventListener("click", () => {
      const userAnswer = root.querySelector("#answer").value.trim();
      const elapsed = Date.now() - startTime;
      const correct = compareAnswers(userAnswer, q.correct);
      answers.push({ questionId: q.id, answer: userAnswer, correct, timeMs: elapsed });
      currentIdx++;
      renderCurrent();
    });
  }

  async function finish() {
    stepEl.innerHTML = `<div class="diag-step"><h2>${i18n.t("diagnostic.s3.title") || "3. Computing profile…"}</h2><div class="muted">Please wait</div></div>`;
    try {
      const r = await api.study.runDiagnostic(topicId, questions, answers);
      if (!r.result) throw new Error("No result");
      saveProfile(topicId, r.result);
      renderResult(r.result, answers.length);
    } catch (e) {
      stepEl.innerHTML = `<div class="diag-step"><h2>Error</h2><pre>${escapeHtml(e.message)}</pre></div>`;
    }
  }

  function renderResult(profile, totalAnswered) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    stepEl.innerHTML = `
      <div class="diag-step">
        <h2>${i18n.t("diagnostic.s4.title") || "4. Your FSRS profile"}</h2>
        <div class="diag-result-grid">
          <div class="diag-card">
            <div class="diag-card-label">${i18n.t("diagnostic.knowledge") || "Knowledge"}</div>
            <div class="diag-card-value">${(profile.knowledgeRatio * 100).toFixed(0)}%</div>
            <div class="diag-card-sub">${profile.correctCount}/${profile.totalQuestions} correct</div>
          </div>
          <div class="diag-card">
            <div class="diag-card-label">${i18n.t("diagnostic.confidence") || "Confidence"}</div>
            <div class="diag-card-value">${(profile.confidence * 100).toFixed(0)}%</div>
            <div class="diag-card-sub">${elapsed}s total</div>
          </div>
          <div class="diag-card">
            <div class="diag-card-label">Initial stability</div>
            <div class="diag-card-value">${profile.fsrsProfile.initialStability} d</div>
          </div>
          <div class="diag-card">
            <div class="diag-card-label">Initial difficulty</div>
            <div class="diag-card-value">${profile.fsrsProfile.initialDifficulty} / 10</div>
          </div>
          <div class="diag-card">
            <div class="diag-card-label">Target retention</div>
            <div class="diag-card-value">${(profile.fsrsProfile.desiredRetention * 100).toFixed(0)}%</div>
          </div>
        </div>
        <div class="diag-concept-breakdown">
          <h3>${i18n.t("diagnostic.byConcept") || "By concept"}</h3>
          ${Object.entries(profile.byConcept).map(([concept, data]) => `
            <div class="diag-concept-row">
              <span class="diag-concept-name">${escapeHtml(concept)}</span>
              <div class="diag-concept-bar">
                <div class="diag-concept-fill" style="width: ${data.ratio * 100}%"></div>
              </div>
              <span class="diag-concept-score">${data.correct}/${data.total}</span>
            </div>
          `).join("")}
        </div>
        <div class="diag-actions">
          <button class="btn primary" id="go-study">${i18n.t("diagnostic.startStudy") || "Start studying →"}</button>
          <button class="btn" id="restart">${i18n.t("diagnostic.restart") || "New diagnostic"}</button>
        </div>
      </div>
    `;
    root.querySelector("#go-study").addEventListener("click", () => {
      location.hash = "#/notes?topic=" + encodeURIComponent(topicId);
    });
    root.querySelector("#restart").addEventListener("click", () => {
      location.hash = "#/diagnostic";
    });
  }

  renderCurrent();
}

function compareAnswers(user, correct) {
  if (!user) return false;
  // Tokenize, compare with high tolerance: case-insensitive + ignore punctuation
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-záéíóúüñ0-9]+/gi, " ").trim();
  const u = norm(user);
  const c = norm(correct);
  if (!c) return false;
  if (u === c) return true;
  // Fuzzy: check if all words of correct are in user
  const cw = c.split(/\s+/);
  const uw = u.split(/\s+/);
  // require at least 70% of correct's words to appear in user
  const overlap = cw.filter((w) => uw.some((x) => x.includes(w) || w.includes(x))).length;
  return overlap / cw.length >= 0.7;
}

/* ============================================================
 * syllabus_dashboard.js — Dashboard widget v2.1.1
 *
 * Muestra por cada subject:
 *   - Nombre + countdown al examen
 *   - Progress bar: % topics mastered (>= 0.8 mastery)
 *   - Status: on-track / behind / critical
 *   - Tips accionables
 *   - Lista de gap topics (mastery < 0.7 o stale)
 *
 * Botones:
 *   - Definir syllabus (manual o auto-extraído)
 *   - Set exam date
 *   - Study now → opens exam/session for that subject
 * ============================================================ */

import * as syl from "../services/syllabus.js";

let styleMounted = false;

const STYLE = `
.syl-dashboard { padding: 0; }
.syl-card {
  background: var(--bg-elevated, #fff);
  border: 1px solid var(--border, #ddd);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 12px;
  box-shadow: var(--shadow-1);
}
.syl-card h4 {
  margin: 0 0 6px;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.syl-countdown {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--bg-sunken, #f4f5f8);
  color: var(--fg-muted, #555);
}
.syl-countdown.critical { background: #fee2e2; color: #b91c1c; font-weight: 600; }
.syl-countdown.behind   { background: #fef3c7; color: #92400e; font-weight: 600; }
.syl-countdown.ok       { background: #dcfce7; color: #166534; font-weight: 600; }
.syl-progress {
  width: 100%;
  height: 10px;
  background: var(--bg-sunken, #f4f5f8);
  border-radius: 5px;
  overflow: hidden;
  margin: 8px 0;
}
.syl-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #5b8def, #10b981);
  transition: width 400ms var(--ease);
}
.syl-progress-fill.critical { background: linear-gradient(90deg, #f59e0b, #ef4444); }
.syl-progress-fill.behind   { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.syl-meta {
  font-size: 12px;
  color: var(--fg-muted, #666);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.syl-tips {
  margin: 8px 0 0;
  padding: 8px 12px;
  background: var(--bg-sunken, #f8f9fb);
  border-radius: 8px;
  font-size: 13px;
}
.syl-tips li { margin: 2px 0; }
.syl-gaps {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.syl-gap {
  background: #fef3c7;
  color: #92400e;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  cursor: pointer;
}
.syl-gap.mastered { background: #dcfce7; color: #166534; cursor: default; }
.syl-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.syl-actions button {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--border, #ddd);
  background: var(--bg-elevated, #fff);
  cursor: pointer;
}
.syl-actions button.primary {
  background: #5b8def; color: white; border-color: #5b8def;
}
.syl-modal {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 200;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.syl-modal-panel {
  background: var(--bg-elevated, #fff);
  border-radius: 16px;
  padding: 20px;
  max-width: 500px;
  width: 100%;
  max-height: 80vh;
  overflow-y: auto;
}
.syl-modal-panel h3 { margin-top: 0; }
.syl-modal-panel textarea {
  width: 100%; min-height: 120px;
  font-family: inherit; font-size: 13px;
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  padding: 8px;
  resize: vertical;
}
.syl-modal-panel label {
  display: block; margin: 8px 0 4px;
  font-size: 12px; color: var(--fg-muted, #666);
}
.syl-modal-panel input[type=date] {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid var(--border, #ddd);
}
.syl-modal-panel .suggested {
  display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0;
}
.syl-modal-panel .suggested-chip {
  background: #dbeafe; color: #1e40af;
  padding: 2px 8px; border-radius: 10px;
  font-size: 12px; cursor: pointer;
}
.syl-modal-panel .suggested-chip.added { background: #dcfce7; color: #166534; }
.syl-empty {
  padding: 24px;
  text-align: center;
  color: var(--fg-muted, #666);
  background: var(--bg-elevated, #fff);
  border: 1px dashed var(--border, #ddd);
  border-radius: 14px;
}
`;

/**
 * openSyllabusDashboard — mounts the dashboard inside a host element.
 * @param host HTMLElement
 */
export function openSyllabusDashboard(host, opts = {}) {
  if (!styleMounted) {
    const s = document.createElement("style");
    s.textContent = STYLE;
    document.head.appendChild(s);
    styleMounted = true;
  }
  render(host, opts);
}

function render(host, opts) {
  const overview = syl.overview();
  host.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "syl-dashboard";

  if (overview.length === 0) {
    const empty = document.createElement("div");
    empty.className = "syl-empty";
    empty.innerHTML = `
      <h3>🎓 Syllabus tracker</h3>
      <p>No hay temarios definidos todavía. Define el syllabus de tus asignaturas para hacer seguimiento del progreso antes del examen.</p>
      <button class="btn primary" id="syl-setup-btn">+ Definir primer syllabus</button>
    `;
    wrap.appendChild(empty);
    host.appendChild(wrap);
    empty.querySelector("#syl-setup-btn").addEventListener("click", () => {
      openSetupModal(opts.subjects || [], opts.notes || [], () => render(host, opts));
    });
    return;
  }

  for (const subj of overview) {
    const plan = syl.studyPlan(subj.id);
    const gaps = syl.gapTopics(subj.id);
    const card = document.createElement("div");
    card.className = "syl-card";
    const pct = Math.round((subj.coverage || 0) * 100);
    const daysLeft = plan?.daysLeft;
    const status = plan?.status || "no-deadline";
    const countdownClass = status === "critical" ? "critical" : status === "behind" ? "behind" : status === "on-track" ? "ok" : "";
    const fillClass = status === "critical" ? "critical" : status === "behind" ? "behind" : "";
    card.innerHTML = `
      <h4>📚 ${escapeHtml(subj.name)}</h4>
      ${daysLeft !== null
        ? `<span class="syl-countdown ${countdownClass}">${daysLeft === 0 ? "📌 HOY" : `${daysLeft} día(s)`}</span>`
        : ""}
      <div class="syl-progress">
        <div class="syl-progress-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="syl-meta">
        <span>📊 ${pct}% mastered</span>
        <span>✅ ${subj.mastered}/${subj.totalTopics} topics</span>
        <span>🟡 ${subj.partial} partial</span>
        <span>⚪ ${subj.untouched} untouched</span>
        ${plan?.reviewsPerDay !== undefined ? `<span>⏱ ${plan.reviewsPerDay.toFixed(1)} rev/día</span>` : ""}
        ${plan?.projectedCoverage !== undefined && plan.daysLeft !== null
          ? `<span>📈 Proyección: ${Math.round(plan.projectedCoverage * 100)}%</span>`
          : ""}
      </div>
      ${plan?.tips?.length ? `
        <ul class="syl-tips">
          ${plan.tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
        </ul>
      ` : ""}
      ${gaps.length ? `
        <div class="syl-gaps">
          ${gaps.slice(0, 8).map((g) =>
            `<span class="syl-gap" data-topic="${g.id}" title="mastery ${(g.mastery * 100).toFixed(0)}%">${escapeHtml(g.name)}</span>`
          ).join("")}
          ${gaps.length > 8 ? `<span class="syl-gap">+${gaps.length - 8} más</span>` : ""}
        </div>
      ` : ""}
      <div class="syl-actions">
        <button data-act="setup" data-subj="${subj.id}">⚙ Editar syllabus</button>
        ${gaps.length ? `<button class="primary" data-act="study" data-subj="${subj.id}">📖 Estudiar gaps (${gaps.length})</button>` : ""}
        ${daysLeft !== null && daysLeft <= 3 ? `<button data-act="cram" data-subj="${subj.id}" style="background:#fee2e2;border-color:#ef4444;color:#b91c1c">⚡ Cramming mode</button>` : ""}
      </div>
    `;
    wrap.appendChild(card);
  }

  // Add subject button
  const add = document.createElement("div");
  add.style.marginTop = "12px";
  add.innerHTML = `<button class="btn" id="syl-add-btn">+ Añadir asignatura</button>`;
  wrap.appendChild(add);

  host.appendChild(wrap);

  // Wire up
  add.querySelector("#syl-add-btn").addEventListener("click", () => {
    openSetupModal(opts.subjects || [], opts.notes || [], () => render(host, opts), null);
  });
  wrap.querySelectorAll('[data-act="setup"]').forEach((b) => {
    b.addEventListener("click", () => {
      openSetupModal(opts.subjects || [], opts.notes || [], () => render(host, opts), b.dataset.subj);
    });
  });
  wrap.querySelectorAll('[data-act="study"]').forEach((b) => {
    b.addEventListener("click", async () => {
      const subj = b.dataset.subj;
      // Open exam wizard with this subject pre-selected, university mode
      const { openExamWizard } = await import("./exam_runner.js");
      const cards = opts.cards || [];
      const occ = opts.occCards || [];
      const exam = await import("../services/exams.js").then((m) =>
        m.buildExam({ kind: "subject", value: subj }, cards, occ, { mode: "university" })
      );
      if (exam.items.length === 0) {
        alert("No hay cards para este subject todavía.");
        return;
      }
      openExamWizard(cards, occ);
      // Pre-set subject after wizard opens (small delay for mount)
      setTimeout(() => {
        const kind = document.querySelector('[data-kind="subject"]');
        if (kind) kind.click();
        setTimeout(() => {
          const item = document.querySelector(`.opt[data-v="${subj}"]`);
          if (item) item.click();
        }, 50);
      }, 100);
    });
  });
  wrap.querySelectorAll('[data-act="cram"]').forEach((b) => {
    b.addEventListener("click", async () => {
      const subj = b.dataset.subj;
      const { openExamWizard } = await import("./exam_runner.js");
      const cards = opts.cards || [];
      const occ = opts.occCards || [];
      openExamWizard(cards, occ);
      setTimeout(() => {
        const cram = document.querySelector('[data-mode="cram"]');
        if (cram) cram.click();
        const kind = document.querySelector('[data-kind="subject"]');
        if (kind) kind.click();
        setTimeout(() => {
          const item = document.querySelector(`.opt[data-v="${subj}"]`);
          if (item) item.click();
        }, 50);
      }, 100);
    });
  });
  wrap.querySelectorAll(".syl-gap[data-topic]").forEach((g) => {
    g.addEventListener("click", () => {
      const topicId = g.dataset.topic;
      // Pulse animation + log as recommendation
      g.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }],
        { duration: 200 }
      );
      syl.pushRecommendation(b.dataset.subj, topicId, "clicked-from-dashboard");
    });
  });
}

function openSetupModal(subjects, notes, onClose, editSubjId) {
  const scrim = document.createElement("div");
  scrim.className = "syl-modal";
  const isEdit = !!editSubjId;
  const subjId = editSubjId || (subjects[0]?.id || subjects[0] || "new-subject");
  const existing = isEdit ? syl.getSyllabus(subjId) : null;
  const currentTopics = (existing?.topics || []).map((t) => t.name);
  const suggested = syl.suggestTopicsFromNotes(notes, subjId);

  scrim.innerHTML = `
    <div class="syl-modal-panel">
      <h3>${isEdit ? "⚙ Editar" : "+ Nuevo"} syllabus</h3>
      <label>Asignatura</label>
      ${isEdit
        ? `<div><b>${escapeHtml(subjId)}</b></div>`
        : `<select id="syl-subj-select" style="width:100%;padding:6px;border-radius:8px">
            ${subjects.map((s) => `<option value="${escapeHtml(s.id || s)}">${escapeHtml(s.name || s.id || s)}</option>`).join("")}
          </select>`}
      <label>Fecha del examen</label>
      <input type="date" id="syl-exam-date" value="${existing?.examDate?.slice(0, 10) || ""}" />
      <label>Topics (uno por línea)</label>
      <textarea id="syl-topics" placeholder="Anatomía: fémur&#10;Anatomía: tibia&#10;...">${currentTopics.join("\n")}</textarea>
      ${suggested.length ? `
        <label>Sugeridos (extraídos de tus notas — clic para añadir)</label>
        <div class="suggested" id="syl-suggested">
          ${suggested.slice(0, 30).map((s) =>
            `<span class="suggested-chip" data-name="${escapeHtml(s)}">${escapeHtml(s)}</span>`
          ).join("")}
        </div>
      ` : ""}
      <div class="syl-actions" style="justify-content:flex-end;margin-top:14px">
        <button data-act="cancel">Cancelar</button>
        ${isEdit ? `<button data-act="delete" style="background:#fee2e2;border-color:#ef4444;color:#b91c1c">Borrar</button>` : ""}
        <button class="primary" data-act="save">${isEdit ? "Guardar" : "Crear"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(scrim);

  scrim.querySelector('[data-act="cancel"]').addEventListener("click", () => scrim.remove());
  if (isEdit) {
    scrim.querySelector('[data-act="delete"]').addEventListener("click", () => {
      if (confirm("¿Borrar syllabus de esta asignatura?")) {
        syl.deleteSyllabus(subjId);
        scrim.remove();
        onClose();
      }
    });
  }
  scrim.querySelector('[data-act="save"]').addEventListener("click", () => {
    const id = isEdit ? subjId : (scrim.querySelector("#syl-subj-select")?.value || subjId);
    const date = scrim.querySelector("#syl-exam-date").value || null;
    const topicsRaw = scrim.querySelector("#syl-topics").value.split("\n").map((l) => l.trim()).filter(Boolean);
    // Save
    syl.setSyllabus(id, {
      name: id,
      examDate: date,
      topics: topicsRaw.map((name) => ({
        id: `t-${name}-${Math.random().toString(36).slice(2, 6)}`,
        name, mastery: 0, reps: 0, lastReview: 0, due: Date.now(),
      })),
    });
    scrim.remove();
    onClose();
  });
  scrim.querySelectorAll(".suggested-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const name = chip.dataset.name;
      const ta = scrim.querySelector("#syl-topics");
      const lines = ta.value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.includes(name)) {
        lines.push(name);
        ta.value = lines.join("\n");
        chip.classList.add("added");
      }
    });
  });
  // Click outside to close
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) scrim.remove();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// screens/prior_probe.js — "¿qué sabes ya?" — y la excavación cuando no.
//
// v2.38.5
//
// Tres pasos, no un test:
//
//   L0  escribe lo que sabes
//   L1  se estrecha: pasa a opciones, o te da una pista
//   L2  se compara con algo cercano, en vez de repetirte la pregunta
//   L3  tres preguntas de control, para separar "no sé esto" de
//       "no sé el tema" de "se me ha ido"
//
// Aciertas en L0 y se acabó. Fallas y bajas un nivel, sin que nadie te
// lo diga ni te ponga un contador en rojo.
//
// Al final no sale un nota. Sale una frase y una fecha.
//
// El botón de "no lo sé" no es un rendirse: baja al siguiente nivel
// por ti, que es justo lo que se busca. Nadie se atasca en L0 con una
// palabra en blanco.

import { i18n } from "../services/i18n.js";
import { api } from "../services/api.js";
import { authHeaders } from "../services/auth.js";
import { detectApiBase } from "../services/api_base.js";
import { escapeHtml } from "../services/safe.js";

const BASE = detectApiBase();

const LEVEL_COPY = {
  0: { tag: "Primero", hint: "Escribe lo que se te ocurra. No está mal, se está mirando." },
  1: { tag: "Con opciones", hint: "Ahora un poco más fácil. No es la misma pregunta." },
  2: { tag: "Comparando", hint: "Fíjate en la diferencia con lo de al lado." },
  3: { tag: "Control", hint: "Tres comprobaciones. La primera que falles, para." },
};

export async function renderPriorProbe(root) {
  const user = JSON.parse(localStorage.getItem("mnexus.user") || "null");
  root.innerHTML = `
    <div class="screen">
      <header class="screen-header">
        <h1 class="h-title">${i18n.t("diag.title") || "¿Qué sabes ya?"}</h1>
      </header>
      <div class="screen-body">
        <p class="muted small">${i18n.t("diag.intro") || "Cuatro temas, dos minutos. Lo que no sepas entra en la cola de estudio con una fecha corta."}</p>
        <div id="diag-body" class="diag-body">
          <div class="diag-loading">${i18n.t("common.loading") || "Cargando…"}</div>
        </div>
        <div id="diag-outcome"></div>
      </div>
    </div>
  `;

  const body = root.querySelector("#diag-body");
  const outcome = root.querySelector("#diag-outcome");

  let plan;
  try {
    plan = await api.get("/api/v1/diagnostic/plan").catch(() => null);
  } catch {
    plan = null;
  }

  if (!plan || !plan.queue || !plan.queue.length) {
    body.innerHTML = `
      <div class="empty">
        <div class="em-title">${i18n.t("diag.clearTitle") || "Nada que medir ahora mismo"}</div>
        <p>${i18n.t("diag.clearBody") || "Los temas que tienes controlados se han medido hace poco. Vuelve cuando haya examen cerca o algo te falle en revisión."}</p>
      </div>`;
    return;
  }

  const queue = plan.queue.slice(0, 4);
  let idx = 0;
  let session = null;
  const started = Date.now();

  async function loadSession() {
    session = await api.post("/api/v1/diagnostic/session", {
      concept: queue[idx].concept,
      reason: queue[idx].reason,
      daysToExam: queue[idx].daysToExam,
    });
    paint();
  }

  function paint() {
    const s = session;
    if (!s || !s.step) {
      body.innerHTML = `<div class="diag-loading">${i18n.t("common.loading") || "…"}</div>`;
      return;
    }
    const step = s.step;
    const copy = LEVEL_COPY[step.level] || LEVEL_COPY[0];
    const exam = queue[idx].daysToExam != null
      ? `<p class="diag-why">${
          queue[idx].daysToExam <= 3
            ? "Examen en menos de 3 días: se indaga a fondo."
            : `Examen en ${queue[idx].daysToExam} días.`
        }</p>`
      : "";

    body.innerHTML = `
      <div class="diag-progress">
        <span class="diag-dot ${idx < queue.length ? "is-on" : ""}"></span>
        ${queue.map((_, i) => `<span class="diag-dot ${i <= idx ? "is-on" : ""}"></span>`).join("")}
        <span class="muted small">${i18n.t("diag.topicN") || "Tema"} ${idx + 1} de ${queue.length}</span>
      </div>
      ${exam}
      <div class="card diag-card">
        <div class="diag-level">${escapeHtml(copy.tag)}</div>
        <h2 class="diag-q">${escapeHtml(step.question)}</h2>
        <p class="muted small">${escapeHtml(copy.hint)}</p>
        ${step.kind === "open" ? `
          <textarea id="diag-open" class="input" rows="4" placeholder="${escapeHtml(i18n.t("diag.write") || "Escribe con tus palabras…")}"></textarea>
        ` : `
          <div class="diag-options">
            ${(step.options || []).map((o, i) => `
              <button class="diag-option" data-choice="${i}">${escapeHtml(o)}</button>
            `).join("")}
          </div>
        `}
        ${step.kind === "control" && step.controls ? `
          <div class="diag-controls">
            ${step.controls.map((c) => `
              <div class="diag-control">
                <p>${escapeHtml(c.question)}</p>
                <div class="diag-options">
                  ${c.options.map((o, i) => `<button class="diag-option small" data-control="${escapeHtml(c.id)}" data-choice="${i}">${escapeHtml(o)}</button>`).join("")}
                </div>
              </div>
            `).join("")}
          </div>
        ` : ""}
        <div class="diag-actions">
          <button class="btn primary" id="diag-send">${i18n.t("diag.send") || "Responder"}</button>
          <button class="btn ghost" id="diag-dunno">${i18n.t("diag.dunno") || "No lo sé"}</button>
        </div>
      </div>`;

    body.querySelector("#diag-send")?.addEventListener("click", () => answer(null));
    body.querySelector("#diag-dunno")?.addEventListener("click", () => answer(false));
    body.querySelectorAll("[data-choice]").forEach((btn) => {
      btn.addEventListener("click", () => {
        body.querySelectorAll("[data-choice]").forEach((o) => o.classList.remove("is-picked"));
        btn.classList.add("is-picked");
        answer(true, Number(btn.dataset.choice));
      });
    });
  }

  async function answer(correct, choiceIndex) {
    const step = session.step;
    const typed = body.querySelector("#diag-open")?.value.trim() || "";

    let pivotChoice;
    let referenceBack;
    if (step.kind === "pivot" && step.options && choiceIndex != null) {
      pivotChoice = step.options[choiceIndex];
      referenceBack = step.reference?.back;
    }

    const res = await api.post(`/api/v1/diagnostic/answer/${session.id}`, {
      level: step.level,
      kind: step.kind,
      correct: !!correct,
      ms: Date.now() - started,
      answer: typed || pivotChoice || "",
      pivotChoice,
      referenceBack,
    });

    if (res?.step) {
      // Baja un nivel. Nadie te lo dice y no hay contador en rojo.
      session.step = res.step;
      paint();
      return;
    }
    idx += 1;
    if (idx < queue.length) {
      await loadSession();
    } else {
      const report = await api.get("/api/v1/diagnostic/report").catch(() => null);
      showReport(report);
    }
  }

  function showReport(report) {
    body.innerHTML = "";
    const rows = (report?.items || []).map((it) => `
      <div class="card diag-result diag-result--${escapeHtml(it.verdict)}">
        <div class="diag-result-head">
          <strong>${escapeHtml(it.concept)}</strong>
          <span class="diag-verdict">${escapeHtml(verdictLabel(it.verdict))}</span>
        </div>
        <p class="muted small">${escapeHtml(it.narrative)}</p>
        <p class="diag-when">${escapeHtml(it.when)}</p>
      </div>`).join("");

    outcome.innerHTML = `
      <h2 class="h-section">${i18n.t("diag.result") || "Dónde estás"}</h2>
      ${rows || `<p class="muted">${i18n.t("common.noData") || "Sin datos."}</p>`}
      <p class="muted small diag-next">${i18n.t("diag.nextRun") || "La próxima sesión programada"}: ${new Date(report?.nextRunAt || Date.now()).toLocaleString("es-ES")}</p>
    `;
    outcome.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  await loadSession();
}

function verdictLabel(v) {
  return (
    {
      known: "Lo tienes",
      unstable: "Justo",
      forgotten: "Se te había ido",
      mismatched: "Al revés",
      absent: "No está",
    }[v] || v
  );
}

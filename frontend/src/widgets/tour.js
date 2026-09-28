/* ============================================================
 * widgets/tour.js — Guided tour of M-NEXUS screens.
 *
 * v2.34.0 — Pantalla por pantalla. Highlights elements with a
 * popover that explains each step. Users can skip, go back/forward,
 * or exit at any time.
 *
 * Triggers:
 *   - First login (mnexus.tour.completed absent in localStorage).
 *   - Manual: Settings → Help → "Iniciar tour".
 *   - Keyboard: `?` opens it.
 *
 * Steps are tied to specific hash routes and CSS selectors. The
 * tour waits for the target element to appear before showing the
 * popover (helpful for SPA navigation).
 * ============================================================ */

const TOUR_STORAGE_KEY = "mnexus.tour.completed";
const TOUR_STEPS = [
  {
    id: "overview",
    route: "#/overview",
    title: "Overview",
    selector: ".overview, .screen-header, body",
    body: "Tu dashboard. Aquí ves la agenda del día, asignaturas, flashcards próximas y accesos rápidos. Pulsa `?` en cualquier momento para volver a abrir este tour.",
  },
  {
    id: "calendar",
    route: "#/calendar",
    title: "Calendar",
    selector: ".calendar, .screen-header",
    body: "Vista día / semana / mes. Los eventos están enlazados a notas: si tomas apuntes en una clase, quedan vinculados a esa hora.",
  },
  {
    id: "subjects",
    route: "#/subjects",
    title: "Subjects",
    selector: ".subjects, .screen-header",
    body: "Tus asignaturas. Puedes añadir cualquier materia (ingeniería, derecho, veterinaria, etc.) con sus propias notas, flashcards y notas.",
  },
  {
    id: "notes",
    route: "#/notes",
    title: "Notes",
    selector: ".notes-content, .screen-header",
    body: "Editor con atomic blocks, wikilinks [[x]], OCR inline. Tip: escribe `/f`, `/occlusion` o `/test` en cualquier input para abrir un popup flotante (no se inyecta nada en el texto).",
  },
  {
    id: "todos",
    route: "#/todos",
    title: "To-dos",
    selector: ".todos, .screen-header",
    body: "Tus tareas. Conectadas al FSRS: tareas recurrentes aparecen antes de su due date.",
  },
  {
    id: "ai",
    route: "#/ai",
    title: "AI Tutor",
    selector: ".ai-screen, .screen-header",
    body: "Tutor con soporte multi-provider (Ollama, OpenRouter, OpenAI). Tiene contexto de la nota que estás viendo.",
  },
  {
    id: "journal",
    route: "#/journal",
    title: "Journal",
    selector: ".journal-screen, .screen-header",
    body: "Diario tipo Notion: templates, mood tracker, streak, heatmap, semana/mes.",
  },
  {
    id: "insights",
    route: "#/v232",
    title: "Insights",
    selector: ".insights-screen, .screen-header",
    body: "3 tabs: Knowledge Graph (canvas force-directed), Multi-board SR (cross-deck diagnostic), FSRS Dashboard (predicción de retención).",
  },
  {
    id: "settings",
    route: "#/settings",
    title: "Settings",
    selector: ".settings-screen, .screen-header",
    body: "Tema, idioma, vault, backup. Aquí también puedes re-iniciar el tour.",
  },
  {
    id: "drawer-advanced",
    route: "#/overview",
    selector: ".hamburger-fab, body",
    body: "Pulsa el FAB de abajo-izquierda para abrir el drawer. La sección Advanced contiene PDF, Graph y Cluster — items menos usados.",
    action: "open-drawer",
  },
];

let _active = null;
let _stepIdx = 0;

export function startTour(opts = {}) {
  if (_active) return _active;

  const root = document.createElement("div");
  root.className = "tour-root";
  document.body.appendChild(root);

  _active = { root, popover: null, scrim: null, stepIdx: opts.startAt || 0 };
  _stepIdx = _active.stepIdx;
  renderTourStep();

  // Keyboard handler
  const onKey = (e) => {
    if (e.key === "Escape") endTour({ completed: false });
    if (e.key === "ArrowRight" || e.key === "Enter") nextStep();
    if (e.key === "ArrowLeft") prevStep();
  };
  document.addEventListener("keydown", onKey);
  _active.onKey = onKey;

  return _active;
}

export function endTour({ completed = true } = {}) {
  if (!_active) return;
  if (completed) {
    try { localStorage.setItem(TOUR_STORAGE_KEY, String(Date.now())); } catch {}
  }
  cleanupTour();
}

export function resetTour() {
  try { localStorage.removeItem(TOUR_STORAGE_KEY); } catch {}
}

export function isTourCompleted() {
  try { return !!localStorage.getItem(TOUR_STORAGE_KEY); } catch { return false; }
}

async function renderTourStep() {
  if (!_active) return;
  const step = TOUR_STEPS[_stepIdx];
  if (!step) {
    endTour({ completed: true });
    return;
  }

  // Navigate to the step's route if needed.
  if (step.route && location.hash !== step.route) {
    location.hash = step.route;
    // Wait for SPA navigation + render
    await new Promise((r) => setTimeout(r, 600));
  }

  // Side effect for steps that need to trigger something (e.g. open drawer)
  if (step.action === "open-drawer") {
    const hamb = document.getElementById("hamburger");
    if (hamb) hamb.click();
    await new Promise((r) => setTimeout(r, 400));
  }

  // Find the target element.
  let target = null;
  if (step.selector) {
    const candidates = step.selector.split(",").map((s) => s.trim());
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { target = el; break; }
    }
  }

  // Remove previous popover.
  if (_active.popover) _active.popover.remove();
  if (_active.scrim) _active.scrim.remove();

  // Scrim.
  const scrim = document.createElement("div");
  scrim.className = "tour-scrim";
  document.body.appendChild(scrim);
  _active.scrim = scrim;

  // Highlight the target.
  if (target) target.classList.add("tour-highlight");

  // Popover.
  const pop = document.createElement("div");
  pop.className = "tour-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Tour paso " + (_stepIdx + 1));

  const total = TOUR_STEPS.length;
  pop.innerHTML = `
    <header class="tour-pop-header">
      <span class="tour-step-count">${_stepIdx + 1} / ${total}</span>
      <h2 class="tour-title">${escapeText(step.title)}</h2>
      <button type="button" class="tour-close" data-tour-action="close" aria-label="Salir del tour">✕</button>
    </header>
    <div class="tour-body">${escapeText(step.body)}</div>
    <footer class="tour-footer">
      <button type="button" class="tour-btn tour-btn--ghost" data-tour-action="prev" ${_stepIdx === 0 ? "disabled" : ""}>← Anterior</button>
      <button type="button" class="tour-btn tour-btn--ghost" data-tour-action="skip">Saltar</button>
      <button type="button" class="tour-btn tour-btn--primary" data-tour-action="next">
        ${_stepIdx === total - 1 ? "✓ Terminar" : "Siguiente →"}
      </button>
    </footer>
  `;
  document.body.appendChild(pop);
  _active.popover = pop;

  positionPopover(pop, target);

  // Wire actions.
  pop.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tour-action]");
    if (!btn) return;
    const action = btn.dataset.tourAction;
    if (action === "close") endTour({ completed: false });
    if (action === "skip") endTour({ completed: true });
    if (action === "next") nextStep();
    if (action === "prev") prevStep();
  });

  // Reposition on resize.
  const onResize = () => positionPopover(pop, target);
  window.addEventListener("resize", onResize);
  _active.onResize = onResize;
}

function positionPopover(pop, target) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const isMobile = W < 600;

  if (isMobile || !target) {
    pop.style.left = "16px";
    pop.style.right = "16px";
    pop.style.top = "auto";
    pop.style.bottom = "16px";
    pop.style.transform = "none";
    pop.classList.add("tour-popover--bottom");
    return;
  }

  // Position next to the target.
  const rect = target.getBoundingClientRect();
  pop.style.visibility = "hidden";
  pop.style.left = "0px";
  pop.style.top = "0px";
  pop.classList.remove("tour-popover--bottom");
  requestAnimationFrame(() => {
    const popRect = pop.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - popRect.width / 2;
    let top = rect.bottom + 12;

    // If it would overflow below, put above.
    if (top + popRect.height > H - 16) {
      top = rect.top - popRect.height - 12;
    }
    if (top < 16) top = 16;

    // Clamp horizontally.
    if (left < 16) left = 16;
    if (left + popRect.width > W - 16) left = W - 16 - popRect.width;

    pop.style.left = left + "px";
    pop.style.top = top + "px";
    pop.style.visibility = "visible";
  });
}

function nextStep() {
  if (!_active) return;
  cleanupHighlights();
  _stepIdx += 1;
  if (_stepIdx >= TOUR_STEPS.length) {
    endTour({ completed: true });
    return;
  }
  renderTourStep();
}

function prevStep() {
  if (!_active) return;
  cleanupHighlights();
  _stepIdx = Math.max(0, _stepIdx - 1);
  renderTourStep();
}

function cleanupHighlights() {
  document.querySelectorAll(".tour-highlight").forEach((el) => el.classList.remove("tour-highlight"));
}

function cleanupTour() {
  cleanupHighlights();
  if (_active) {
    if (_active.popover) _active.popover.remove();
    if (_active.scrim) _active.scrim.remove();
    if (_active.onKey) document.removeEventListener("keydown", _active.onKey);
    if (_active.onResize) window.removeEventListener("resize", _active.onResize);
    if (_active.root) _active.root.remove();
  }
  _active = null;
}

function escapeText(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": String.fromCharCode(38) + "amp;",
    "<": String.fromCharCode(38) + "lt;",
    ">": String.fromCharCode(38) + "gt;",
    '"': String.fromCharCode(38) + "quot;",
    "'": String.fromCharCode(38) + "#39;",
  }[c]));
}

// Global keyboard shortcut: `?` opens the tour (skip if user is typing in an input).
document.addEventListener("keydown", (e) => {
  if (e.key !== "?") return;
  if (e.target.matches?.("input, textarea, [contenteditable]")) return;
  startTour();
});

// Auto-trigger on first login.
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (!isTourCompleted() && !_active) {
        // Only auto-start if we're on the overview route.
        if (location.hash === "#/overview" || location.hash === "" || location.hash === "#") {
          startTour();
        }
      }
    }, 1200);
  });
}

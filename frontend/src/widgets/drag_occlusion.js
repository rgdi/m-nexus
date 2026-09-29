/* widgets/drag_occlusion.js — v2.38.1
 *
 * Drag an answer onto a masked region of an image.
 *
 * Image occlusion works by covering part of a figure and asking you to
 * recall what was under it. But the label for a mask is normally fixed
 * when the mask is drawn, which only works if the author already knew
 * the answer. The interesting version is the reverse: the figure is
 * already masked, the answers are already written, and the question is
 * which answer belongs under which mask.
 *
 * That is a drag-to-gap exercise with pixels instead of underscores, and
 * it is the thing `drag_gap.js` could not do — it renders a sentence,
 * not an image.
 *
 * ── Why this uses Pointer Events and not HTML5 drag ────────────────
 * Same reason as drag_gap.js in v2.37.0. HTML5 drag-and-drop does not
 * fire on touch screens: on Android and ChromeOS the drag simply never
 * begins, and the only working path is tap-then-tap. Everything here
 * goes through pointerdown/move/up so a finger, a mouse and a stylus
 * share one code path, and the tap-then-tap route is kept for
 * accessibility.
 *
 * ── Geometry ──────────────────────────────────────────────────────
 * Masks are stored normalised (0..1) against the page, so they survive
 * any render size. Hit testing converts the pointer's viewport position
 * into that same space rather than comparing pixels, which is what makes
 * this work on a retina phone and a 4K monitor with the same code.
 */

import { authHeaders } from "../services/auth.js";
import { showToast } from "./toast.js";
import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

/** A chip the user can drop onto a mask. */
/**
 * mountDragOcclusion({
 *   host,          // position:relative container the figure goes in
 *   imageUrl,      // absolute URL of the figure
 *   occlusions,    // [{ id, x, y, w, h, label }] — normalised 0..1
 *   chips,         // [{ id, text }] — the answers to place
 *   isCorrect,     // (chipText, occlusion) => boolean
 *   onComplete,    // (result) => void
 *   onSave,        // optional (occlusionId, label) => Promise
 *   alt,
 * })
 *
 * @returns { destroy() }
 */
let selected = null;
// v2.38.1: this was assigned in mountDragOcclusion without ever being
// declared. ES modules are strict, so the first mount threw
// "drops is not defined" and the whole exercise failed to render — the
// unit tests exercised the pure helpers, not mount().
let drops = [];
let drag = null;
let ghost = null;
let hotMask = null;
let suppressClick = false;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * Render the exercise.
 *
 * @returns a handle with `destroy()`, so a screen that re-renders does
 *          not leave a stale global drag state behind.
 */
export function mountDragOcclusion(opts) {
  const { host, occlusions, chips } = opts;
  drops = [];
  const started = Date.now();

  // A mask can hold one chip; a chip can go in one mask.
  const maskOf = (chipId) => drops.find((d) => d.chipId === chipId) ?? null;
  const isUsed = (chipId) => maskOf(chipId) !== null;
  const isFilled = (maskId) => drops.some((d) => d.occlusionId === maskId);

  host.classList.add("do-host");
  host.innerHTML = `
    <div class="do-stage">
      <img class="do-img" src="${esc(opts.imageUrl)}" alt="${esc(opts.alt ?? "Figura")}" draggable="false">
      <div class="do-masks">
        ${occlusions.map((o, i) => `
          <button class="do-mask" data-mask="${esc(o.id)}" data-i="${i}"
                  style="left:${o.x * 100}%;top:${o.y * 100}%;width:${o.w * 100}%;height:${o.h * 100}%"
                  aria-label="Zona ${i + 1}">
            <span class="do-mask-label"></span>
          </button>`).join("")}
      </div>
    </div>
    <div class="do-chips" role="listbox" aria-label="Respuestas">
      ${chips.map((c) => `
        <button class="do-chip" data-chip="${esc(c.id)}" role="option" aria-selected="false">
          ${esc(c.text)}
        </button>`).join("")}
    </div>
    <div class="do-actions">
      <button class="m-btn m-btn--ghost" data-do-reset>Reiniciar</button>
      <button class="m-btn" data-do-check>Comprobar</button>
      <button class="m-btn" data-do-finish hidden>Continuar →</button>
    </div>
    <div class="do-feedback" data-do-feedback></div>
  `;

  
  const feedback = host.querySelector("[data-do-feedback]");
  const checkBtn = host.querySelector("[data-do-check]");
  const finishBtn = host.querySelector("[data-do-finish]");

  function repaint() {
    host.querySelectorAll("[data-chip]").forEach((b) => {
      const id = b.dataset.chip;
      const used = isUsed(id);
      b.classList.toggle("is-used", used);
      b.classList.toggle("is-selected", selected === id);
      b.setAttribute("aria-disabled", String(used));
      b.setAttribute("aria-selected", String(selected === id));
    });
    host.querySelectorAll("[data-mask]").forEach((m) => {
      const id = m.dataset.mask;
      const d = drops.find((x) => x.occlusionId === id);
      m.classList.toggle("is-filled", !!d);
      m.classList.toggle("is-correct", !!d && d.correct);
      m.classList.toggle("is-wrong", !!d && !d.correct);
      const chip = d ? chips.find((c) => c.id === d.chipId) : null;
      m.querySelector(".do-mask-label").textContent = chip ? chip.text : "";
    });
    checkBtn.disabled = drops.length === 0;
  }

  function place(chipId, maskId) {
    const chip = chips.find((c) => c.id === chipId);
    const mask = occlusions.find((o) => o.id === maskId);
    if (!chip || !mask || isUsed(chipId)) return;

    // A chip in one mask frees the other, rather than vanishing.
    const prior = maskOf(chipId);
    if (prior) drops.splice(drops.indexOf(prior), 1);
    // Two chips cannot occupy one mask.
    const occupant = drops.findIndex((d) => d.occlusionId === maskId);
    if (occupant >= 0) drops.splice(occupant, 1);

    drops.push({ occlusionId: maskId, chipId, correct: opts.isCorrect(chip.text, mask) });
    selected = null;
    repaint();
  }

  /* ---- pointer drag ---- */

  function maskUnder(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el?.closest?.("[data-mask]")?.getAttribute("data-mask") ?? null;
  }

  function ensureGhost(text) {
    if (!ghost) {
      ghost = document.createElement("div");
      ghost.className = "do-ghost";
      document.body.appendChild(ghost);
    }
    ghost.textContent = text;
  }

  function clearHot() {
    if (hotMask) {
      host.querySelector(`[data-mask="${CSS.escape(hotMask)}"]`)?.classList.remove("is-hot");
    }
    hotMask = null;
  }

  host.querySelectorAll("[data-chip]").forEach((b) => {
    const id = b.dataset.chip;

    (b).addEventListener("click", () => {
      // The click that follows a drag must not also select.
      if (suppressClick) { suppressClick = false; return; }
      if (isUsed(id)) return;
      selected = selected === id ? null : id;
      repaint();
    });

    (b).addEventListener("pointerdown", (e) => {
      const ev = e;
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if (isUsed(id)) return;
      drag = { chipId: id, pointerId: ev.pointerId, startX: ev.clientX, startY: ev.clientY, active: false };
      (b).setPointerCapture?.(ev.pointerId);
    });

    (b).addEventListener("pointermove", (e) => {
      const ev = e;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.active) {
        // 8px threshold: a tap selects, it does not start a drag.
        if (Math.hypot(dx, dy) < 8) return;
        drag.active = true;
        b.classList.add("is-dragging");
      }
      ev.preventDefault();
      const chip = chips.find((c) => c.id === drag.chipId);
      ensureGhost(chip?.text ?? "");
      ghost.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%, -50%)`;
      const over = maskUnder(ev.clientX, ev.clientY);
      if (over !== hotMask) {
        clearHot();
        if (over) {
          hotMask = over;
          host.querySelector(`[data-mask="${CSS.escape(over)}"]`)?.classList.add("is-hot");
        }
      }
    });

    const end = (e) => {
      const ev = e;
      if (!drag || drag.pointerId !== ev.pointerId) return;
      const wasActive = drag.active;
      const chipId = drag.chipId;
      b.classList.remove("is-dragging");
      ghost?.remove();
      ghost = null;
      clearHot();
      drag = null;
      if (!wasActive) return;
      suppressClick = true;
      const maskId = maskUnder(ev.clientX, ev.clientY);
      if (maskId) place(chipId, maskId);
    };
    (b).addEventListener("pointerup", end);
    (b).addEventListener("pointercancel", end);
  });

  host.querySelectorAll("[data-mask]").forEach((m) => {
    (m).addEventListener("click", () => {
      if (!selected) return;
      place(selected, m.dataset.mask);
    });
  });

  host.querySelector("[data-do-reset]")?.addEventListener("click", () => {
    drops.length = 0;
    selected = null;
    feedback.innerHTML = "";
    finishBtn.hidden = true;
    repaint();
  });

  checkBtn.addEventListener("click", async () => {
    // Reveal only what was attempted, not the whole answer key.
    let correct = 0;
    for (const d of drops) {
      const mask = occlusions.find((o) => o.id === d.occlusionId);
      if (d.correct) correct++;
      if (d.correct) {
        opts.onSave?.(d.occlusionId, mask?.label ?? "").catch(() => {});
      }
    }
    const total = occlusions.length;
    feedback.innerHTML = `
      <div class="do-score ${correct === drops.length && drops.length > 0 ? "is-full" : ""}">
        <strong>${correct} / ${drops.length}</strong> correctas
        ${drops.length < total ? `<span class="do-score-rest">de ${total} zonas</span>` : ""}
      </div>`;
    if (drops.length >= total) {
      finishBtn.hidden = false;
      checkBtn.disabled = true;
    }
  });

  finishBtn.addEventListener("click", () => {
    opts.onComplete({
      perMask: occlusions.map((o) => {
        const d = drops.find((x) => x.occlusionId === o.id);
        return { occlusionId: o.id, chipId: d?.chipId ?? null, correct: d ? d.correct : null };
      }),
      correctCount: drops.filter((d) => d.correct).length,
      filledCount: drops.length,
      durationMs: Date.now() - started,
    });
  });

  repaint();

  return {
    destroy() {
      ghost?.remove();
      ghost = null;
      drag = null;
      hotMask = null;
      selected = null;
      host.classList.remove("do-host");
      host.innerHTML = "";
    },
  };
}

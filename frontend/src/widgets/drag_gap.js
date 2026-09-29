/* ============================================================
 * widgets/drag_gap.js — Drag-the-answer-into-the-gap exercise.
 *
 * v2.36.0 — The hardest card type, and the one that actually builds
 * durable memory: the learner must physically place the right term
 * into the right hole instead of recognising it among distractors.
 *
 * Interaction
 *   - A sentence with `___` gaps, or an explicit `gaps: [{id, x, y}]`.
 *   - Draggable answer chips at the bottom.
 *   - Drag a chip onto a gap (or tap a chip then tap a gap — the
 *     accessible path, since drag is unusable with a keyboard).
 *   - Wrong placements snap back and shake; correct ones lock in green.
 *   - Optional hint: reveals one chip's destination after N seconds.
 *   - Score: placed / total, plus per-gap correctness for the FSRS log.
 *
 * Everything is pointer-events based, so mouse, touch and pen all work.
 * No dependencies.
 * ============================================================ */

import { openFloatingWindow } from "./floating_window.js";

let seq = 0;
const nextId = (p) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": String.fromCharCode(38) + "amp;",
  "<": String.fromCharCode(38) + "lt;",
  ">": String.fromCharCode(38) + "gt;",
  '"': String.fromCharCode(38) + "quot;",
  "'": String.fromCharCode(38) + "#39;",
}[c]));

/**
 * openDragGap({ title, sentence, answers, onComplete })
 *
 * @param sentence  string with ___ placeholders, e.g.
 *                  "La presión ___ sistólica es ___ mmHg."
 * @param answers   string[] — the correct terms, one per gap, shuffled
 *                  for display. Must match the gap count.
 * @param distractors string[] — extra wrong chips to make it harder.
 * @param onComplete (result) => void
 *        result = { placed, total, correct, perGap, durationMs }
 */
export function openDragGap(opts = {}) {
  const sentence = opts.sentence || "";
  const correctAnswers = (opts.answers || []).filter(Boolean);
  const distractors = (opts.distractors || []).filter(Boolean);

  // Derive gaps from the ___ placeholders when the caller did not
  // specify positions explicitly.
  const gapCount = (sentence.match(/___/g) || []).length || correctAnswers.length;
  const chips = shuffle([...correctAnswers, ...distractors]);

  const state = {
    gaps: Array.from({ length: gapCount }, (_, i) => ({
      id: nextId("gap"),
      index: i,
      filled: null,       // chip id
      correct: null,      // boolean once locked
    })),
    chips: chips.map((text, i) => ({ id: nextId("chip"), text, used: false, correctText: text })),
    startedAt: Date.now(),
  };

  const body = document.createElement("div");
  body.className = "m-drag-gap";

  const win = openFloatingWindow({
    id: "drag-gap-session",
    title: opts.title || "🧩 Arrastra a la casilla",
    icon: "🧩",
    body,
    width: 520,
    height: 480,
    kind: "popup",
  });

  paint();

  function paint() {
    const placedCount = state.gaps.filter((g) => g.correct === true).length;
    const done = state.gaps.every((g) => g.correct !== null);

    body.innerHTML = `
      <div class="m-drag-gap-head">
        <span class="m-study-progress-bar"><span class="m-study-progress-fill" style="width:${(placedCount / Math.max(1, gapCount)) * 100}%"></span></span>
        <span class="m-mono" style="font-size:12px;color:var(--m-ink-3)">${placedCount}/${gapCount}</span>
      </div>

      <p class="m-drag-gap-sentence">${renderSentence()}</p>

      <div class="m-drag-gap-chips" role="listbox" aria-label="Fichas de respuesta">
        ${state.chips.map((c) => `
          <button type="button" class="m-drag-chip${c.used ? " is-used" : ""}${selectedChip === c.id ? " is-selected" : ""}"
                  data-chip="${c.id}" role="option" aria-selected="${selectedChip === c.id}"
                  ${c.used ? "disabled" : ""}>${esc(c.text)}</button>
        `).join("")}
      </div>

      <p class="m-drag-gap-hint">
        ${done
          ? "✅ ¡Completo!"
          : "Arrastra una ficha a una casilla, o tócala y luego toca la casilla."}
      </p>

      <div class="m-drag-gap-actions">
        <button type="button" class="m-btn m-btn--quiet" data-dg="reset">↺ Reiniciar</button>
        <button type="button" class="m-btn m-btn--ghost" data-dg="check" ${done ? "" : "disabled"}>✓ Comprobar</button>
        ${done ? `<button type="button" class="m-btn" data-dg="finish">Continuar →</button>` : ""}
      </div>
    `;

    wire();
  }

  let selectedChip = null;
  // v2.37.0: pointer-drag bookkeeping. `dragState` is the in-flight drag,
  // `ghost` the floating chip, `hotGapId` the gap currently under the
  // pointer, and `dragJustEnded` suppresses the synthetic click that
  // follows a pointerup on a chip we just dragged.
  let dragState = null;
  let ghost = null;
  let hotGapId = null;
  let dragJustEnded = false;

  function renderSentence() {
    let i = 0;
    return esc(sentence).replace(/___/g, () => {
      const g = state.gaps[i++];
      if (!g) return "___";
      const chip = g.filled ? state.chips.find((c) => c.id === g.filled) : null;
      const cls = g.correct === true ? " is-correct" : g.correct === false ? " is-wrong" : "";
      return `<span class="m-drag-gap-slot${cls}" data-gap="${g.id}" tabindex="0" role="button"
        aria-label="Casilla ${g.index + 1}${chip ? `: ${chip.text}` : ", vacía"}">${
          chip ? esc(chip.text) : "?"
        }</span>`;
    });
  }

  function wire() {
    // --- chips: tap to select, pointer-drag to drag ---
    //
    // v2.37.0: this used HTML5 drag events (draggable / dragstart /
    // dragover / drop). The file header claimed "Pointer Events", but
    // HTML5 drag-and-drop does not fire on touch screens — on Android
    // and ChromeOS the drag simply never started and the only working
    // path was tap-chip-then-tap-gap. Rewritten on Pointer Events so
    // mouse, finger and stylus share one code path, while keeping the
    // tap-tap route intact for accessibility.
    body.querySelectorAll("[data-chip]").forEach((el) => {
      const id = el.dataset.chip;

      el.addEventListener("click", () => {
        if (dragJustEnded) { dragJustEnded = false; return; }
        selectedChip = selectedChip === id ? null : id;
        paint();
      });

      el.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        // Long-press threshold: a tap should still select, not drag.
        dragState = {
          chipId: id,
          el,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          active: false,
        };
        el.setPointerCapture?.(e.pointerId);
      });

      el.addEventListener("pointermove", (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        if (!dragState.active) {
          if (Math.hypot(dx, dy) < 8) return; // still a tap
          dragState.active = true;
          dragState.el.classList.add("is-dragging");
          // Auto-scroll if the user drags toward an edge.
          document.body.classList.add("dg-scrolling");
        }
        e.preventDefault();
        moveGhost(e.clientX, e.clientY);
        highlightGapUnder(e.clientX, e.clientY);
      });

      const end = (e) => {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        const wasActive = dragState.active;
        const chipId = dragState.chipId;
        dragState.el.classList.remove("is-dragging");
        document.body.classList.remove("dg-scrolling");
        clearGapHighlight();
        removeGhost();
        dragState = null;
        if (!wasActive) return; // it was a tap; let click handle it
        dragJustEnded = true;
        const gapId = gapUnder(e.clientX, e.clientY);
        if (gapId) place(chipId, gapId);
      };
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
    });

    // --- gaps: tap to place the selected chip ---
    body.querySelectorAll("[data-gap]").forEach((el) => {
      el.addEventListener("click", () => {
        if (selectedChip) place(selectedChip, el.dataset.gap);
      });
    });

    body.querySelector('[data-dg="reset"]')?.addEventListener("click", reset);
    body.querySelector('[data-dg="check"]')?.addEventListener("click", check);
    body.querySelector('[data-dg="finish"]')?.addEventListener("click", finish);
  }

  /* ---- pointer-drag helpers ---- */

  function ensureGhost() {
    if (ghost) return ghost;
    ghost = document.createElement("div");
    ghost.className = "dg-ghost";
    document.body.appendChild(ghost);
    return ghost;
  }

  function moveGhost(x, y) {
    if (!dragState) return;
    const chip = state.chips.find((c) => c.id === dragState.chipId);
    const g = ensureGhost();
    g.textContent = chip?.text ?? "";
    g.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  function removeGhost() {
    ghost?.remove();
    ghost = null;
  }

  /** Which gap is under this viewport point? */
  function gapUnder(x, y) {
    const el = document.elementFromPoint(x, y);
    return el?.closest?.("[data-gap]")?.dataset.gap ?? null;
  }

  function highlightGapUnder(x, y) {
    const id = gapUnder(x, y);
    if (id === hotGapId) return;
    clearGapHighlight();
    if (id) {
      hotGapId = id;
      body.querySelector(`[data-gap="${CSS.escape(id)}"]`)?.classList.add("is-over");
    }
  }

  function clearGapHighlight() {
    if (hotGapId) {
      body.querySelector(`[data-gap="${CSS.escape(hotGapId)}"]`)?.classList.remove("is-over");
    }
    hotGapId = null;
  }

  function place(chipId, gapId) {
    const chip = state.chips.find((c) => c.id === chipId);
    const gap = state.gaps.find((g) => g.id === gapId);
    if (!chip || !gap || chip.used) return;

    // Remove the chip from any other gap first (a chip is used once).
    for (const g of state.gaps) {
      if (g.filled === chipId) { g.filled = null; g.correct = null; }
    }

    // Clear the target gap.
    if (gap.filled) {
      const prev = state.chips.find((c) => c.id === gap.filled);
      if (prev) prev.used = false;
    }

    gap.filled = chipId;
    chip.used = true;
    selectedChip = null;
    paint();
  }

  function check() {
    for (const g of state.gaps) {
      if (g.filled == null) continue;
      const chip = state.chips.find((c) => c.id === g.filled);
      if (!chip) continue;
      g.correct = chip.text === correctAnswers[g.index];
    }
    paint();
  }

  function reset() {
    for (const g of state.gaps) { g.filled = null; g.correct = null; }
    for (const c of state.chips) c.used = false;
    selectedChip = null;
    paint();
  }

  function finish() {
    const correct = state.gaps.filter((g) => g.correct === true).length;
    const result = {
      placed: state.gaps.filter((g) => g.filled != null).length,
      total: state.gaps.length,
      correct,
      perGap: state.gaps.map((g) => ({
        index: g.index,
        correct: g.correct === true,
        placed: g.filled ? state.chips.find((c) => c.id === g.filled)?.text ?? null : null,
        expected: correctAnswers[g.index] ?? null,
      })),
      durationMs: Date.now() - state.startedAt,
    };
    if (opts.onComplete) opts.onComplete(result);
    win.close();
  }

  return win;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

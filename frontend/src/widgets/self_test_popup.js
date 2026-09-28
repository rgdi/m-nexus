/* ============================================================
 * widgets/self_test_popup.js — Floating self-test popup.
 *
 * v2.34.0 — Opens in a floating window (NOT inline in the note body).
 * Triggered by /test slash command. Generates questions from the note
 * and quizzes the user with a card-style flow.
 * ============================================================ */

import { openFloatingWindow } from "./floating_window.js";

const escHtml = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({
  "&": String.fromCharCode(38) + "amp;",
  "<": String.fromCharCode(38) + "lt;",
  ">": String.fromCharCode(38) + "gt;",
  '"': String.fromCharCode(38) + "quot;",
  "'": String.fromCharCode(38) + "#39;",
}[c]));

/**
 * openSelfTestPopup({ note, cards })
 *
 * Either pass a `note` (we'll extract <mark> highlights) or pre-built
 * `cards` array.
 */
export function openSelfTestPopup(opts = {}) {
  const fwId = "self-test-popup-" + (opts.note?.id || "global");

  // Build cards from the note: prefer explicit cards, else mine <mark> spans.
  let cards = opts.cards || [];
  if (!cards.length && opts.note?.body) {
    const html = String(opts.note.body);
    const marks = [...html.matchAll(/<mark[^>]*>([\s\S]*?)<\/mark>/gi)].map((m) => m[1]);
    if (marks.length) {
      cards = marks.map((text, i) => ({
        front: "¿Cuál es este concepto?",
        back: text.replace(/<[^>]+>/g, ""),
        id: "highlight-" + i,
      }));
    }
  }
  if (!cards.length && opts.note?.body) {
    // Fallback: split body by sentences
    const plain = String(opts.note.body).replace(/<[^>]+>/g, " ").trim();
    const sentences = plain.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30 && s.length < 200);
    cards = sentences.slice(0, 5).map((s, i) => ({
      front: "¿Cuál es el siguiente concepto de tu nota?",
      back: s,
      id: "sentence-" + i,
    }));
  }

  const body = document.createElement("div");
  body.className = "self-test-popup-body";
  body.innerHTML = `
    <div class="self-test-progress" data-st-progress></div>
    <div class="self-test-card-area" data-st-area></div>
    <div class="self-test-actions">
      <button type="button" class="self-test-btn self-test-btn--secondary" data-st-action="close">✕ Cerrar</button>
      <button type="button" class="self-test-btn self-test-btn--secondary" data-st-action="prev">← Anterior</button>
      <button type="button" class="self-test-btn self-test-btn--primary" data-st-action="reveal">👁 Mostrar respuesta</button>
      <button type="button" class="self-test-btn self-test-btn--secondary" data-st-action="next" disabled>Siguiente →</button>
    </div>
    <div class="self-test-grading" data-st-grading hidden>
      <span>¿Cómo te fue?</span>
      <button type="button" class="self-test-grade" data-grade="1">😖 Otra vez</button>
      <button type="button" class="self-test-grade" data-grade="2">😐 Bien</button>
      <button type="button" class="self-test-grade" data-grade="3">😎 Fácil</button>
    </div>
    <div class="self-test-status" data-st-status aria-live="polite"></div>
  `;

  const win = openFloatingWindow({
    id: fwId,
    title: "🧠 Self-test (" + cards.length + " preguntas)",
    icon: "🧠",
    body,
    width: 540,
    height: 420,
  });

  if (!cards.length) {
    body.querySelector("[data-st-area]").innerHTML = `
      <div class="self-test-empty">
        No hay preguntas en esta nota. Añade <code>&lt;mark&gt;</code>
        alrededor de conceptos clave o crea flashcards primero.
      </div>
    `;
    body.querySelector('[data-st-action="reveal"]').disabled = true;
    return win;
  }

  let idx = 0;
  let revealed = false;
  const area = body.querySelector("[data-st-area]");
  const progress = body.querySelector("[data-st-progress]");
  const status = body.querySelector("[data-st-status]");
  const grading = body.querySelector("[data-st-grading]");

  function render() {
    const c = cards[idx];
    revealed = false;
    grading.hidden = true;
    progress.textContent = "Pregunta " + (idx + 1) + " / " + cards.length;
    area.innerHTML = `
      <div class="self-test-front">${escHtml(c.front)}</div>
      <div class="self-test-back" hidden>${escHtml(c.back)}</div>
    `;
    body.querySelector('[data-st-action="next"]').disabled = (idx === cards.length - 1);
    body.querySelector('[data-st-action="prev"]').disabled = (idx === 0);
    body.querySelector('[data-st-action="reveal"]').disabled = false;
    body.querySelector('[data-st-action="reveal"]').textContent = "👁 Mostrar respuesta";
    status.textContent = "";
  }

  body.querySelector('[data-st-action="close"]').addEventListener("click", () => win.close());
  body.querySelector('[data-st-action="prev"]').addEventListener("click", () => {
    if (idx > 0) { idx--; render(); }
  });
  body.querySelector('[data-st-action="next"]').addEventListener("click", () => {
    if (idx < cards.length - 1) { idx++; render(); }
  });
  body.querySelector('[data-st-action="reveal"]').addEventListener("click", () => {
    revealed = !revealed;
    const back = area.querySelector(".self-test-back");
    back.hidden = !revealed;
    grading.hidden = !revealed;
    body.querySelector('[data-st-action="reveal"]').textContent =
      revealed ? "🙈 Ocultar respuesta" : "👁 Mostrar respuesta";
  });

  grading.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-grade]");
    if (!btn) return;
    const grade = parseInt(btn.dataset.grade, 10);
    const labels = { 1: "Otra vez", 2: "Bien", 3: "Fácil" };
    status.textContent = "✓ Marcada: " + labels[grade];
    if (idx < cards.length - 1) {
      setTimeout(() => { idx++; render(); }, 600);
    } else {
      status.textContent = "🎉 ¡Test completado! " + cards.length + "/" + cards.length;
      grading.hidden = true;
    }
  });

  render();
  return win;
}

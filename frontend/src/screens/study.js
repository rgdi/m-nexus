/* screens/study.js — Study session screen ("TARJETAS DE ESTUDIO").
 *
 * v2.35.0 — Mobile-first flashcard session. Host for the swipeable
 * card stack. On desktop it still works but the sheet is dismissable.
 */

import { startStudySession } from "../widgets/study_cards.js";
import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

export async function renderStudy(root) {
  root.innerHTML = `
    <section class="screen m-screen">
      <div style="padding:calc(var(--m-safe-t) + 18px) 4px 10px">
        <p class="m-eyebrow">Sesión de hoy</p>
        <h1 class="m-display">TARJETAS<br>DE ESTUDIO</h1>
        <p class="m-body">Repasa lo que el FSRS-7 dice que estás por olvidar.</p>
      </div>
      <div data-study-host></div>
    </section>
  `;

  const host = root.querySelector("[data-study-host]");

  // Show due count up-front, then open the session.
  let due = 0;
  try {
    const r = await fetch(`${BASE}/api/v1/flashcards`);
    const j = await r.json();
    const now = Date.now();
    due = (j.cards || []).filter((c) => (c.fsrs?.due ?? 0) <= now).length;
  } catch {}

  host.innerHTML = `
    <div class="m-stat-grid m-stat-grid--3" style="margin-bottom:16px">
      <div class="m-stat"><div class="m-stat-num" data-study-due>${due}</div><div class="m-stat-lbl">Deben repasar</div></div>
      <div class="m-stat"><div class="m-stat-num">~${Math.max(1, Math.round(due * 0.4))}</div><div class="m-stat-lbl">Min hoy</div></div>
      <div class="m-stat"><div class="m-stat-num">7</div><div class="m-stat-lbl">Días racha</div></div>
    </div>
    <button class="m-btn m-btn--block" data-study-start>
      ${due > 0 ? "Empezar sesión" : "Repasar de todas formas"}
    </button>
    <p class="m-muted" style="font-size:13px;text-align:center;margin-top:14px">
      Desliza ← para "de nuevo" · → para "fácil" · toca para ver la respuesta
    </p>
  `;

  const startBtn = host.querySelector("[data-study-start]");
  startBtn?.addEventListener("click", async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Preparando…";
    await startStudySession({
      onRate: async (cardId, rating) => {
        // Persist the FSRS review through the existing endpoint.
        try {
          await fetch(`${BASE}/api/v1/flashcards/${encodeURIComponent(cardId)}/review`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating }),
          });
        } catch {}
      },
      onClose: () => {
        startBtn.disabled = false;
        startBtn.textContent = "Empezar sesión";
      },
    });
    startBtn.disabled = false;
    startBtn.textContent = "Empezar sesión";
  });
}

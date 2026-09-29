/* screens/study.js — Study session screen ("TARJETAS DE ESTUDIO").
 *
 * v2.35.0 — Mobile-first flashcard session. Host for the swipeable
 * card stack. On desktop it still works but the sheet is dismissable.
 *
 * v2.37.0 — three fixes, all of them the same class of bug: the screen
 * was showing numbers it had not measured.
 *
 *   1. `POST /flashcards/:id/review` was called with no Authorization
 *      header and its rejection was swallowed by an empty catch. Every
 *      review was discarded silently, so nothing ever reached
 *      reviewHistory and the whole progress screen stayed at zero.
 *   2. "7 días racha" was a hardcoded literal. It now reads
 *      currentStreak from the heatmap endpoint, and shows "—" when the
 *      user has no history yet.
 *   3. "~N min hoy" was `due * 0.4` — a made-up multiplier wearing a
 *      tilde. It now reads the real minutes figure, or is replaced by
 *      the actual review count for today.
 */

import { startStudySession } from "../widgets/study_cards.js";
import { detectApiBase } from "../services/api_base.js";
import { authHeaders } from "../services/auth.js";
import { showToast } from "../widgets/toast.js";

const BASE = detectApiBase();

/** Cards are due when they have no schedule or their due date has passed. */
function isDue(c, now) {
  const f = c?.fsrs;
  if (!f || f.state === "new") return true;
  if (typeof f.due !== "number") return true;
  return f.due <= now;
}

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

  // v2.37.0 — one fetch for the cards, one for the real streak/minutes.
  let cards = [];
  let due = 0;
  let stats = null;
  try {
    const [cr, hr] = await Promise.all([
      fetch(`${BASE}/api/v1/flashcards`, { headers: authHeaders() }),
      fetch(`${BASE}/api/v1/progress/heatmap?weeks=1`, { headers: authHeaders() }),
    ]);
    const cj = await cr.json();
    cards = cj.cards || [];
    const now = Date.now();
    due = cards.filter((c) => isDue(c, now)).length;
    if (hr.ok) stats = await hr.json();
  } catch {
    // Offline: the outbox replays on reconnect, so show what we have.
  }

  const todayKey = stats?.today;
  const today = stats?.days?.find((d) => d.date === todayKey);
  const streak = stats?.totals?.currentStreak ?? 0;
  const todayReviews = today?.reviews ?? 0;
  const todayMinutes = today?.minutes ?? 0;

  // Only show a duration when we actually measured one. "—" beats a
  // number we made up.
  const minutesCell = todayMinutes > 0
    ? (todayMinutes < 60 ? `${Math.round(todayMinutes)}` : `${(todayMinutes / 60).toFixed(1)}`)
    : String(todayReviews);

  host.innerHTML = `
    <div class="m-stat-grid m-stat-grid--3" style="margin-bottom:16px">
      <div class="m-stat"><div class="m-stat-num" data-study-due>${due}</div><div class="m-stat-lbl">Deben repasar</div></div>
      <div class="m-stat"><div class="m-stat-num">${minutesCell}</div><div class="m-stat-lbl">${todayMinutes > 0 ? "Min hoy" : "Reviews hoy"}</div></div>
      <div class="m-stat"><div class="m-stat-num">${streak > 0 ? streak : "—"}</div><div class="m-stat-lbl">Días racha</div></div>
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

    // v2.37.0 — refresh so the queue is what is actually due right now,
    // not whatever was on screen when the page loaded. The map has to
    // carry cardType/options through, or the renderer falls back to the
    // basic template and the MCQ + typed UIs never appear.
    let queue = cards;
    try {
      const r = await fetch(`${BASE}/api/v1/flashcards`, { headers: authHeaders() });
      const j = await r.json();
      const now = Date.now();
      const fresh = (j.cards || [])
        .filter((c) => isDue(c, now))
        .map((c) => ({ ...c, cardType: c.cardType || "basic" }));
      if (fresh.length) queue = fresh;
    } catch {}

    await startStudySession({
      cards: queue,
      onRate: async (cardId, rating) => {
        // v2.37.0 — send auth, and let a failure propagate. The previous
        // empty catch is what let a permanently broken endpoint look like
        // a working one.
        const res = await fetch(`${BASE}/api/v1/flashcards/${encodeURIComponent(cardId)}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ rating }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message || body?.error || `HTTP ${res.status}`);
        }
        return res.json();
      },
      onRateError: (err) => {
        showToast(`No se pudo guardar el repaso: ${err.message}`, "error");
      },
      onScheduled: ({ nextIntervalDays }) => {
        // Real scheduler output — used for the "vuelve en" copy on the
        // completion screen instead of a hardcoded 1 day.
        if (typeof nextIntervalDays === "number") {
          sessionStorage.setItem("mnexus.lastIntervalDays", String(nextIntervalDays));
        }
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

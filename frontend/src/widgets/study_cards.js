/* ============================================================
 * widgets/study_cards.js — Swipeable flashcard stack.
 *
 * v2.35.0 — The "TARJETAS DE ESTUDIO" screen. Card stack with:
 *   - tap to flip (question ↔ answer)
 *   - swipe left = De nuevo, swipe right = Fácil
 *   - 4 rating buttons: De nuevo (<10m) / Difícil (6d) / Bien (15d) / Fácil (22d)
 *   - progress bar + counter
 *   - X close button that pops the card back
 *   - next-card "peek" scale animation
 *
 * Pure DOM + CSS transforms. Pointer Events so mouse + touch both work.
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

const RATINGS = [
  { r: 0, label: "De nuevo", interval: "<10m", color: "var(--m-danger)" },
  { r: 1, label: "Difícil", interval: "6d", color: "var(--m-warn)" },
  { r: 2, label: "Bien", interval: "15d", color: "var(--m-ok)" },
  { r: 3, label: "Fácil", interval: "22d", color: "var(--m-info)" },
];

/**
 * openStudySession({ cards, onRate, onClose })
 * @param cards  Array<{ id, front, back, subject }>
 * @param onRate (cardId, rating) => Promise|void  — persist to backend
 */
export function openStudySession({ cards = [], onRate, onClose } = {}) {
  // Build the sheet
  const scrim = document.createElement("div");
  scrim.className = "m-sheet-scrim";

  const sheet = document.createElement("div");
  sheet.className = "m-sheet m-sheet--full";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Sesión de estudio");

  let queue = [...cards];
  let done = 0;
  const total = cards.length;
  let flipped = false;

  sheet.innerHTML = `
    <div class="m-sheet-grip"></div>
    <div class="m-sheet-head">
      <button class="m-sheet-x" data-study-close aria-label="Cerrar sesión">✕</button>
      <div class="m-sheet-title" data-study-count>0 / ${total}</div>
      <div class="m-study-progress" style="flex:1;margin:0">
        <div class="m-study-progress-bar"><div class="m-study-progress-fill" data-study-bar style="width:0%"></div></div>
      </div>
    </div>
    <div class="m-sheet-body" data-study-body>
      ${total === 0 ? `
        <div class="m-empty-state">
          <span class="m-emoji">🎉</span>
          <h3>¡Todo al día!</h3>
          <p>No hay flashcards pendientes. Vuelve mañana o crea más con <code>/f</code>.</p>
        </div>` : `
        <div class="m-study" data-study-stack></div>
        <div class="m-study-ratings" data-study-ratings>
          ${RATINGS.map((x) => `
            <button class="m-rate" data-r="${x.r}" data-study-rate="${x.r}">
              <span class="m-rate-lbl">${x.label}</span>
              <span class="m-rate-int">${x.interval}</span>
            </button>`).join("")}
        </div>
        <button class="m-btn m-btn--block m-btn--ghost" data-study-show>👁 Mostrar respuesta</button>
      `}
    </div>
  `;

  document.body.appendChild(scrim);
  document.body.appendChild(sheet);

  const stack = sheet.querySelector("[data-study-stack]");
  const countEl = sheet.querySelector("[data-study-count]");
  const barEl = sheet.querySelector("[data-study-bar]");
  const ratingsEl = sheet.querySelector("[data-study-ratings]");
  const showBtn = sheet.querySelector("[data-study-show]");
  const bodyEl = sheet.querySelector("[data-study-body]");

  // ---- Card stack rendering ----
  function paint() {
    if (!stack) return;
    stack.innerHTML = "";
    // Render up to 4 (top first)
    for (let i = 0; i < Math.min(4, queue.length); i++) {
      const c = queue[i];
      const el = document.createElement("div");
      el.className = "m-study-card" + (flipped ? " is-flipped" : "");
      el.dataset.behind = String(i);
      el.dataset.id = c.id ?? String(i);
      el.innerHTML = `
        <div class="m-study-hint m-study-hint--left" data-hint-left>De nuevo</div>
        <div class="m-study-hint m-study-hint--right" data-hint-right>Fácil</div>
        ${c.subject ? `<div class="m-study-subject">${esc(c.subject)}</div>` : ""}
        <div class="m-study-q">${esc(c.front ?? c.q ?? "")}</div>
        <div class="m-study-a">${esc(c.back ?? c.a ?? "")}</div>
      `;
      if (i === 0) attachSwipe(el);
      else el.addEventListener("click", () => { /* no-op for behind cards */ });
      stack.appendChild(el);
    }
  }

  // ---- Swipe gesture (Pointer Events) ----
  function attachSwipe(el) {
    let startX = 0, startY = 0, dx = 0, dy = 0, dragging = false, pid = null;
    const hintL = el.querySelector("[data-hint-left]");
    const hintR = el.querySelector("[data-hint-right]");

    el.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      dx = dy = 0;
      el.classList.add("is-dragging");
      el.setPointerCapture?.(pid);
    });

    el.addEventListener("pointermove", (e) => {
      if (!dragging || e.pointerId !== pid) return;
      dx = e.clientX - startX;
      dy = e.clientY - startY;
      // Only horizontal-dominant drags count as swipe
      if (Math.abs(dx) < 6) return;
      const rot = (dx / 14);
      el.style.transform = `translateX(${dx}px) translateY(${dy * 0.25}px) rotate(${rot}deg)`;
      if (hintL) { hintL.style.opacity = Math.max(0, -dx / 90); hintL.style.left = "20px"; }
      if (hintR) { hintR.style.opacity = Math.max(0, dx / 90); hintR.style.right = "20px"; }
    });

    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
      el.style.transform = "";
      if (hintL) hintL.style.opacity = "0";
      if (hintR) hintR.style.opacity = "0";

      if (dx < -80) { grade(el, 0); return; }
      if (dx > 80) { grade(el, 3); return; }
      // Not far enough → treat as tap (flip)
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) flip();
    };

    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => { if (dragging) end(); });
  }

  function flip() {
    flipped = !flipped;
    const top = stack?.querySelector(".m-study-card[data-behind='0']");
    if (top) top.classList.toggle("is-flipped", flipped);
    if (showBtn) {
      showBtn.textContent = flipped ? "🙈 Ocultar respuesta" : "👁 Mostrar respuesta";
    }
  }

  function grade(el, rating) {
    if (!el) return;
    const cardId = el.dataset.id;
    const c = queue[0];
    if (!c) return;
    // Fly out
    el.style.setProperty("--fly", rating === 0 ? "-140%" : "140%");
    el.style.setProperty("--rot", rating === 0 ? "-22deg" : "22deg");
    el.classList.add("is-gone");

    queue.shift();
    done += 1;
    flipped = false;
    if (showBtn) showBtn.textContent = "👁 Mostrar respuesta";
    if (countEl) countEl.textContent = `${done} / ${total}`;
    if (barEl) barEl.style.width = `${(done / total) * 100}%`;

    // Persist (fire-and-forget)
    if (onRate) {
      try { Promise.resolve(onRate(c.id ?? cardId, rating)).catch(() => {}); } catch {}
    }
    // Slight delay so the fly-out reads
    setTimeout(() => {
      if (queue.length === 0) renderDone();
      else paint();
    }, 240);
  }

  function renderDone() {
    bodyEl.innerHTML = `
      <div class="m-empty-state">
        <span class="m-emoji">🎊</span>
        <h3>¡Sesión completa!</h3>
        <p>Has repasado ${done} tarjetas. Vuelve en ${nextDueHint()}.</p>
        <button class="m-btn m-btn--block" data-study-close style="margin-top:18px">Listo</button>
      </div>`;
    bodyEl.querySelector("[data-study-close]")?.addEventListener("click", close);
    if (stack) stack.remove();
    if (ratingsEl) ratingsEl.remove();
    if (showBtn) showBtn.remove();
    if (barEl) barEl.style.width = "100%";
    if (countEl) countEl.textContent = `${done} / ${total}`;
  }

  function nextDueHint() {
    if (queue.length > 0) return "un momento";
    return "mañana o más tarde";
  }

  // ---- Rating buttons ----
  if (ratingsEl) {
    ratingsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-study-rate]");
      if (!b) return;
      const r = parseInt(b.dataset.studyRate, 10);
      grade(stack?.querySelector(".m-study-card[data-behind='0']"), r);
    });
  }
  if (showBtn) showBtn.addEventListener("click", flip);

  // ---- Close ----
  function close() {
    scrim.remove();
    sheet.remove();
    document.removeEventListener("keydown", onKey);
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  sheet.querySelector("[data-study-close]")?.addEventListener("click", close);
  scrim.addEventListener("click", close);

  paint();
  return { close, get done() { return done; }, get total() { return total; } };
}

/** Fetch due cards and open the session. */
export async function startStudySession(opts = {}) {
  let cards = opts.cards;
  if (!cards) {
    try {
      const r = await fetch(`${BASE}/api/v1/flashcards`);
      const j = await r.json();
      const now = Date.now();
      cards = (j.cards || [])
        .filter((c) => (c.fsrs?.due ?? 0) <= now)
        .slice(0, 40)
        .map((c) => ({
          id: c.id,
          front: c.front,
          back: c.back,
          subject: c.subject,
        }));
    } catch {
      cards = [];
    }
  }
  return openStudySession({
    cards,
    onRate: opts.onRate,
    onClose: opts.onClose,
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": String.fromCharCode(38) + "amp;",
    "<": String.fromCharCode(38) + "lt;",
    ">": String.fromCharCode(38) + "gt;",
    '"': String.fromCharCode(38) + "quot;",
    "'": String.fromCharCode(38) + "#39;",
  }[c]));
}

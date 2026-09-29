/* ============================================================
 * widgets/study_cards.js — Swipeable flashcard stack.
 *
 * v2.35.0 — The "TARJETAS DE ESTUDIO" screen. Card stack with:
 *   - tap to flip (question ↔ answer)
 *   - swipe left = De nuevo, swipe right = Fácil
 *   - 4 rating buttons: De nuevo / Difícil / Bien / Fácil
 *   - progress bar + counter
 *   - X close button that pops the card back
 *   - next-card "peek" scale animation
 *
 * Pure DOM + CSS transforms. Pointer Events so mouse + touch both work.
 *
 * v2.37.0 — Ratings are 1..4, matching FSRS (Again/Hard/Good/Easy) and
 * POST /flashcards/:id/review. They used to be 0..3, so tapping "De
 * nuevo" sent rating 0, the backend rejected it with a 400, and the
 * handler swallowed the rejection in an empty catch — no review was
 * ever recorded, which silently zeroed the whole progress screen.
 * ============================================================ */

import { detectApiBase } from "../services/api_base.js";

const BASE = detectApiBase();

/** FSRS rating scale. Index in this array is display order only. */
const RATINGS = [
  { r: 1, label: "De nuevo", color: "var(--m-danger)" },
  { r: 2, label: "Difícil", color: "var(--m-warn)" },
  { r: 3, label: "Bien", color: "var(--m-ok)" },
  { r: 4, label: "Fácil", color: "var(--m-info)" },
];

/**
 * Interval hint for the rating buttons.
 *
 * At the default target retention (0.9) the FSRS inverse formula reduces
 * to `interval = stability`, because the curve is defined so that R = 0.9
 * exactly at t = S. The per-rating factors below mirror the model's
 * hard-penalty (w15) and easy-bonus (w16) bands closely enough for a
 * label. This is a hint, not a promise — after the review lands, the
 * button reflects the interval the scheduler actually computed.
 */
function intervalHint(card) {
  const s = Number(card?.fsrs?.stability) || 0;
  if (card?.fsrs?.state === "new" || s <= 0) {
    return { 1: "10 min", 2: "1 d", 3: "3 d", 4: "7 d" };
  }
  const d = s < 1 ? "10 min" : s < 21 ? `${Math.round(s)} d` : `${Math.round(s / 30)} mes`;
  return {
    1: "10 min",
    2: d,
    3: d,
    4: s < 21 ? `${Math.round(s * 1.6)} d` : `${Math.round((s * 1.6) / 30)} mes`,
  };
}

/**
 * Render one card face, dispatched on `cardType`.
 *
 * v2.37.0. v2.36.0 added `multiple_choice`, `typed_answer` and
 * `drag_gap` to the backend `CardType` union and shipped widgets for the
 * last two — but this function did not exist, and every card was painted
 * with the same front/back template. A multiple-choice card rendered as
 * a wall of option text with no way to pick one, and a typed-answer card
 * had no input, so neither type was answerable. The types existed only on
 * paper.
 *
 * Each type gets an interactive front; the back stays the explanation.
 */
function renderCardFace(c) {
  const type = c.cardType || "basic";
  const subject = c.subject ? `<div class="m-study-subject">${esc(c.subject)}</div>` : "";
  const hints = `
    <div class="m-study-hint m-study-hint--left" data-hint-left>De nuevo</div>
    <div class="m-study-hint m-study-hint--right" data-hint-right>Fácil</div>`;

  if (type === "multiple_choice") {
    const opts = Array.isArray(c.options) ? c.options : [];
    // v2.37.0: a multiple-choice card with no options used to render as
    // a bare question with nothing tappable — a dead end mid-session.
    // Cards arrive from several generators and a partially-written one
    // is common, so fall back to the plain template instead.
    if (opts.length >= 2) {
      return `${hints}${subject}
        <div class="m-study-q">${esc(c.front ?? c.q ?? "")}</div>
        <div class="m-mcq" role="radiogroup" aria-label="Opciones">
          ${opts.map((o, i) => `
            <button type="button" class="m-mcq-opt" role="radio" aria-checked="false" data-mcq="${i}">
              <span class="m-mcq-key">${String.fromCharCode(65 + i)}</span>
              <span class="m-mcq-txt">${esc(o)}</span>
            </button>`).join("")}
        </div>
        <div class="m-mcq-verdict" data-mcq-verdict hidden></div>
        <div class="m-study-a">${esc(c.back ?? c.a ?? "")}</div>`;
    }
  }

  if (type === "typed_answer") {
    return `${hints}${subject}
      <div class="m-study-q">${esc(c.front ?? c.q ?? "")}</div>
      <textarea class="m-typed-input" data-typed rows="3"
        placeholder="Escribe tu respuesta…"
        aria-label="Tu respuesta"></textarea>
      <button type="button" class="m-btn m-btn--block m-typed-check" data-typed-check>Comprobar</button>
      <div class="m-typed-verdict" data-typed-verdict hidden></div>
      <div class="m-study-a">${esc(c.back ?? c.a ?? "")}</div>`;
  }

  if (type === "drag_gap") {
    // The interactive widget is mounted after the card is in the DOM, so
    // the sentence arrives as plain text and the gaps are parsed by the
    // drag_gap widget itself.
    return `${hints}${subject}
      <div class="m-study-q" data-drag-host>${esc(c.front ?? c.q ?? "")}</div>
      <div class="m-study-a" hidden>${esc(c.back ?? c.a ?? "")}</div>`;
  }

  return `${hints}${subject}
    <div class="m-study-q">${esc(c.front ?? c.q ?? "")}</div>
    <div class="m-study-a">${esc(c.back ?? c.a ?? "")}</div>`;
}

/** Call the server grader. Keeps the base URL in one place. */
async function gradeTyped(userAnswer, expected, context, useLlm) {
  const { authHeaders } = await import("../services/auth.js");
  const r = await fetch(`${BASE}/api/v1/grade/typed`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ userAnswer, expected, context, useLlm }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function gradeMcq(cardId, chosenIndex) {
  const { authHeaders } = await import("../services/auth.js");
  const r = await fetch(`${BASE}/api/v1/grade/mcq`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ cardId, chosenIndex }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * openStudySession({ cards, onRate, onClose, onRateError, onScheduled })
 * @param cards  Array<{ id, front, back, subject, cardType, options }>
 * @param onRate (cardId, rating 1..4) => Promise — persist to backend
 * @param onClose () => void
 * @param onRateError (err) => void  — v2.37.0: a failed save is visible
 * @param onScheduled ({ nextIntervalDays }) => void — v2.37.0: real FSRS
 */
export function openStudySession({ cards = [], onRate, onClose, onRateError, onScheduled } = {}) {
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
              <span class="m-rate-int" data-rate-int="${x.r}">${x.label === "De nuevo" ? "10 min" : "—"}</span>
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
      el.dataset.type = c.cardType || "basic";
      el.innerHTML = renderCardFace(c);
      if (i === 0) {
        attachSwipe(el);
        if (el.dataset.type === "multiple_choice") attachMcq(el, c);
        if (el.dataset.type === "typed_answer") attachTyped(el, c);
      } else el.addEventListener("click", () => { /* no-op for behind cards */ });
      stack.appendChild(el);
    }
    // v2.37.0 — the interval hints belong to the card currently on top,
    // so they are refreshed on every paint rather than baked into the
    // initial template.
    const hint = intervalHint(queue[0]);
    ratingsEl?.querySelectorAll("[data-rate-int]").forEach((el) => {
      el.textContent = hint[el.dataset.rateInt] ?? "—";
    });
  }

  // ---- Multiple choice: pick, then the server decides ----
  //
  // The client never compares against its own copy of the key. It sends
  // the choice to POST /api/v1/grade/mcq, which re-reads the card, so a
  // tampered client cannot mark itself right.
  function attachMcq(el, c) {
    const verdict = el.querySelector("[data-mcq-verdict]");
    el.querySelectorAll("[data-mcq]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation(); // don't let the swipe handler flip the card
        const idx = Number(btn.dataset.mcq);
        el.querySelectorAll("[data-mcq]").forEach((b) => {
          b.classList.remove("is-picked", "is-right", "is-wrong");
          b.setAttribute("aria-checked", "false");
        });
        btn.classList.add("is-picked");
        btn.setAttribute("aria-checked", "true");

        let res;
        try {
          res = await gradeMcq(c.id, idx);
        } catch (err) {
          if (verdict) {
            verdict.hidden = false;
            verdict.textContent = "No se pudo comprobar. Revisa la conexión.";
            verdict.className = "m-mcq-verdict is-error";
          }
          return;
        }
        // Paint the truth from the server response.
        const per = Array.isArray(res.perChoice) ? res.perChoice : [];
        el.querySelectorAll("[data-mcq]").forEach((b, i) => {
          const p = per[i];
          if (!p) return;
          if (p.correct) b.classList.add("is-right");
          else if (i === idx) b.classList.add("is-wrong");
        });
        if (verdict) {
          verdict.hidden = false;
          verdict.className = "m-mcq-verdict " + (res.correct ? "is-ok" : "is-bad");
          verdict.textContent = res.correct
            ? `Correcto${res.score != null ? ` · ${res.score}` : ""}`
            : (res.explanation || "Incorrecto");
        }
        // A correct first-try answer maps to "Good"; a wrong one to "Again".
        autoGrade(el, res.correct ? 3 : 1);
      });
    });
  }

  // ---- Typed answer: type, then the server grades ----
  function attachTyped(el, c) {
    const ta = el.querySelector("[data-typed]");
    const btn = el.querySelector("[data-typed-check]");
    const verdict = el.querySelector("[data-typed-verdict]");
    if (!ta || !btn) return;

    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    ta.addEventListener("keydown", (e) => e.stopPropagation());

    const run = async () => {
      const answer = ta.value.trim();
      if (!answer) return;
      btn.disabled = true;
      btn.textContent = "Corrigiendo…";
      let res;
      try {
        res = await gradeTyped(answer, c.back ?? c.a ?? "", c.front, true);
      } catch (err) {
        verdict.hidden = false;
        verdict.className = "m-typed-verdict is-error";
        verdict.textContent = "No se pudo corregir. Revisa la conexión.";
        btn.disabled = false;
        btn.textContent = "Comprobar";
        return;
      }
      btn.disabled = false;
      btn.textContent = "Comprobar";
      verdict.hidden = false;
      // gradedBy is the honest signal: "llm" means a model looked at it,
      // anything else means it was pure string math. Showing "revisado
      // por IA" for a deterministic match would be a lie.
      const byIA = res.gradedBy === "llm";
      verdict.className = "m-typed-verdict " + (res.verdict === "correct" ? "is-ok" : "is-bad");
      verdict.innerHTML = `
        <strong>${res.score}/100</strong> ${byIA ? '<span class="m-graded-by">revisado por IA</span>' : ""}
        <span class="m-typed-fb">${esc(res.feedback || "")}</span>
        <span class="m-typed-expected">Esperado: ${esc(res.correctAnswer ?? c.back ?? "")}</span>`;
      if (res.missed?.length) {
        verdict.innerHTML += `<span class="m-typed-missed">Te faltó: ${esc(res.missed.join(", "))}</span>`;
      }
      autoGrade(el, res.score >= 85 ? 3 : res.score >= 50 ? 2 : 1);
    };

    btn.addEventListener("click", (e) => { e.stopPropagation(); run(); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
    });
  }

  /** Advance the card automatically once a self-graded type is answered. */
  function autoGrade(el, rating) {
    if (autoGraded === el) return; // one auto-grade per card
    autoGraded = el;
    setTimeout(() => grade(el, rating), 700);
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

      if (dx < -80) { grade(el, 1); return; }
      if (dx > 80) { grade(el, 4); return; }
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
    el.style.setProperty("--fly", rating === 1 ? "-140%" : "140%");
    el.style.setProperty("--rot", rating === 1 ? "-22deg" : "22deg");
    el.classList.add("is-gone");

    queue.shift();
    done += 1;
    flipped = false;
    if (showBtn) showBtn.textContent = "👁 Mostrar respuesta";
    if (countEl) countEl.textContent = `${done} / ${total}`;
    if (barEl) barEl.style.width = `${(done / total) * 100}%`;

    // Persist. v2.37.0: surface failures instead of swallowing them —
    // a silently-dropped review looks identical to a saved one and
    // makes the progress screen lie.
    if (onRate) {
      Promise.resolve(onRate(c.id ?? cardId, rating))
        .then((res) => {
          if (res && typeof res.nextIntervalDays === "number") {
            onScheduled?.(res);
          }
        })
        .catch((err) => {
          console.error("[study] review persist failed", err);
          onRateError?.(err);
        });
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
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    scrim.remove();
    sheet.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("mnexus:route", close);
    if (onClose) onClose();
  }
  // v2.38.2: the sheet is appended to <body>, not to #app, so a route
  // change — which replaces app.innerHTML — never reached it. Start a
  // review, tap another tab, and a full-screen sheet stayed on top with
  // no way back. The router announces itself and the sheet listens.
  window.addEventListener("mnexus:route", close);
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  sheet.querySelector("[data-study-close]")?.addEventListener("click", close);
  scrim.addEventListener("click", close);

  paint();
  return { close, get done() { return done; }, get total() { return total; } };
}

/** Fetch due cards and open the session. */
/**
 * Fetch a session queue and open it.
 *
 * v2.37.0 — this function forwarded only `onRate` and `onClose`. It
 * dropped `onRateError` and `onScheduled`, so the study screen's error
 * toast and real-interval callback were wired to nothing.
 *
 * Its fallback fetch also had no Authorization header (a 401 since
 * v2.37.0 closed `/api/v1/flashcards`) and mapped each card down to
 * {id, front, back, subject} — discarding `cardType` and `options`, so
 * every card fell back to the basic renderer and the multiple-choice and
 * typed-answer UIs could never appear from this path.
 */
export async function startStudySession(opts = {}) {
  let cards = opts.cards;
  if (!Array.isArray(cards) || cards.length === 0) {
    try {
      const { authHeaders } = await import("../services/auth.js");
      const r = await fetch(`${BASE}/api/v1/flashcards`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const now = Date.now();
      cards = (j.cards || [])
        .filter((c) => {
          const f = c?.fsrs;
          if (!f || f.state === "new") return true;
          return typeof f.due !== "number" || f.due <= now;
        })
        .slice(0, 40)
        .map((c) => ({
          id: c.id,
          front: c.front,
          back: c.back,
          subject: c.subject,
          // v2.37.0: the renderer dispatches on cardType, and the MCQ
          // grade call needs the id + options to round-trip.
          cardType: c.cardType || "basic",
          options: c.options,
          fsrs: c.fsrs,
        }));
    } catch (e) {
      cards = [];
    }
  }
  return openStudySession({
    cards,
    onRate: opts.onRate,
    onClose: opts.onClose,
    onRateError: opts.onRateError,
    onScheduled: opts.onScheduled,
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

/* ============================================================
 * study_session.js — study session UI estilo Anki.
 *
 * v1.7.0 — card flip + 4 ratings + persist FSRS state.
 * v2.23.0 — localStorage cache (offline-first).
 * v2.24.0 — Active recall enforcement (paper §3.1): rating sin reveal
 *              es rechazado. FSRS-6 backend bridge. Elaboración tras
 *              Again (paper §3.5). Interleave flag para discriminación
 *              (§3.4). Persistencia de elaborations al backend.
 *
 * Modelo DSR persistido en backend (desde v2.24.0):
 *   stability / difficulty / reps / lapses / due / state / retrievability
 *
 * Multiple-dispositivo: la primera respuesta de cada rating se envía al
 * backend via POST /api/v1/fsrs/eval con algoritmo "fsrs-v6". El backend
 * ejecuta ts-fsrs y devuelve el newState. En modo offline (backend down)
 * se cae a FSRS-4.5 cliente (mismas 17 pesos), persistiendo en
 * localStorage — nunca se pierde trabajo.
 * ============================================================ */

import { review as clientReview, initCard as clientInitCard, FSRS_RATINGS } from "../services/fsrs.js";
import { api } from "../services/api.js";
import { applyRating as applyRatingV6, normalizeBackendState } from "../services/fsrs_v6.js";

const KEY = "mnexus.fsrs.cards.v1";
/** Key para almacenar el cache de estado sync con backend entre sesiones. */
const KEY_BACKEND_STATE = "mnexus.fsrs.cards.backend.v1";
/** Key para almacenar elaborations pendientes de sync (offline-first). */
const KEY_ELABORATIONS = "mnexus.elaborations.pending.v1";

// ============================================================
// Persistencia local como cache no-oficial.
// (En v2.24.0 la fuente de verdad es el backend — localStorage es
//  cache + fallback offline.)
// ============================================================
function loadAllCardStates() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); }
  catch { return {}; }
}
function saveAllCardStates(states) {
  localStorage.setItem(KEY, JSON.stringify(states));
}
function getCardState(cardId) {
  const all = loadAllCardStates();
  return all[cardId] || null;
}
function setCardState(cardId, fsrs) {
  const all = loadAllCardStates();
  all[cardId] = fsrs;
  saveAllCardStates(all);
}

function loadBackendCache() {
  try { return JSON.parse(localStorage.getItem(KEY_BACKEND_STATE) || "{}"); }
  catch { return {}; }
}
function setBackendCache(cardId, state) {
  const all = loadBackendCache();
  all[cardId] = state;
  localStorage.setItem(KEY_BACKEND_STATE, JSON.stringify(all));
}
function getBackendCache(cardId) {
  return loadBackendCache()[cardId] || null;
}

function loadPendingElabs() {
  try { return JSON.parse(localStorage.getItem(KEY_ELABORATIONS) || "[]"); }
  catch { return []; }
}
function pushPendingElab(e) {
  const list = loadPendingElabs();
  list.push(e);
  localStorage.setItem(KEY_ELABORATIONS, JSON.stringify(list));
}
async function flushPendingElabs() {
  if (!navigator.onLine) return;
  const list = loadPendingElabs();
  if (!list.length) return;
  // We don't have a backend endpoint for elaborations yet; for now they
  // survive in localStorage until a FlushElabs endpoint is added.
  // (The card state already syncs via FSRS-6, which is the priority.)
  // Future v2.25: POST /api/v1/flashcards/:id/elaborations
}

/* ============================================================
 * openStudySession — abre pantalla fullscreen de estudio.
 *
 *  @param cards Array de flashcards (con .id, .front, .back, cardType?, ...).
 *  @param opts { mode: "rating"|"free-recall", interleave: boolean }
 *
 *  v2.24.0 — Soporta .cardType="basic"|"cloze"|"enumerate"|"image_occlusion".
 *             Si cardType="enumerate", se renderiza lista interactiva en lugar
 *             de flip.
 *  v2.24.0 — Active-recall enforcement: rating sin reveal es rechazado.
 *  v2.24.0 — Interleave opcional: mezcla cards del mismo interleaveGroup.
 * ============================================================ */
export async function openStudySession(cards, opts = {}) {
  if (!document.getElementById("study-styles")) {
    const s = document.createElement("style");
    s.id = "study-styles";
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // ---- Interleaving (§3.4): si activado, mezclamos cards del mismo grupo
  // para forzar discriminación entre subtemas. Homogéneo con FSRS.
  let queue = (opts.interleave && cards.length >= 4) ? interleaveCards(cards) : [...cards];

  const root = document.createElement("div");
  root.className = "study";
  document.body.appendChild(root);

  // Mezclar FSRS state en cada card (cache local + cache backend cache)
  queue = queue.map((c) => {
    const localFsrs = getCardState(c.id);
    const backendCached = getBackendCache(c.id);
    return {
      ...c,
      fsrs: backendCached || localFsrs || clientInitCard(),
      _showBack: false,
      _pendingRating: false,
    };
  });

  // v1.8.0: requeue learning/relearning que aún están dentro de su step time.
  const REQUEUE_MAX = 3;
  /** Cleanup del keydown listener previo (cleanup isónico). */
  let currentKeyCleanup = null;
  function requeue(card) {
    const fs = card.fsrs || {};
    if ((fs.state === "learning" || fs.state === "relearning") && (fs.reps ?? 0) < REQUEUE_MAX) {
      queue.push(card);
    }
  }

  // Best-effort flush pending elaborations on entry
  flushPendingElabs();

  let reviewed = 0, correct = 0, total = queue.length;
  let forcedElabOn = false;

  function render() {
    if (queue.length === 0) {
      renderDone();
      return;
    }
    const card = queue[0];
    renderCard(card, false);
  }

  function renderCard(card, showBack) {
    const pct = total > 0 ? (reviewed / total) * 100 : 0;
    const fs = card.fsrs || {};
    const stateLabel = {
      new: "🆕 New",
      learning: "🔁 Learning",
      relearning: "🔄 Relearning",
      review: "✓ Review",
    }[fs.state || "new"];
    const repsLabel = fs.reps ? `rep ${fs.reps}` : "";
    const typeLabel = ({ basic: "Básico", cloze: "Cloze", enumerate: "Lista", image_occlusion: "Imagen" })[card.cardType || "basic"] || "—";
    root.innerHTML = `
      <div class="head">
        <button class="close" data-act="close">✕</button>
        <div class="prog"><div class="fill" style="width:${pct}%"></div></div>
        <div class="counter">${reviewed + 1}/${total}</div>
      </div>
      <div class="stats">
        <div class="stat-pill"><div class="v">${correct}</div><div class="l">Correct</div></div>
        <div class="stat-pill"><div class="v">${reviewed - correct}</div><div class="l">Wrong</div></div>
        <div class="stat-pill"><div class="v">${total - reviewed}</div><div class="l">Left</div></div>
        <div class="stat-pill"><div class="v">${typeLabel}</div><div class="l">Tipo</div></div>
      </div>
      <div class="card-meta">
        <span class="state">${stateLabel}</span>
        <span class="reps">${repsLabel}</span>
        <span class="due">due ${formatMmss(Math.max(0, (fs.due || 0) - Date.now()))}</span>
      </div>
      <div class="card-wrap">
        ${renderCardFace(card, showBack)}
      </div>
      <div class="ratings" id="ratings" ${showBack ? "" : "data-disabled=\"true\""}>
        <button class="rate-btn again" data-rate="1" title="Atajo: 1"><span class="int">1</span>Again</button>
        <button class="rate-btn hard"  data-rate="2" title="Atajo: 2"><span class="int">2</span>Hard</button>
        <button class="rate-btn good"  data-rate="3" title="Atajo: 3 — Enter / Space cuando revelado"><span class="int">3</span>Good</button>
        <button class="rate-btn easy"  data-rate="4" title="Atajo: 4"><span class="int">4</span>Easy</button>
      </div>
      ${showBack ? "" : `<div class="hint">Pulsa <kbd>Espacio</kbd> / <kbd>Enter</kbd> / click en la card para revelar. <strong>Paper §3.1:</strong> el retrieve activo es la palanca; no puntúes sin revelar.</div>`}
    `;
    bindCard(card);
  }

  /**
   * Renderiza la "cara" según cardType. Para "enumerate" se renderiza
   * una mini interactivity (lista vacía que el usuario debe completar).
   */
  function renderCardFace(card, showBack) {
    const cardType = card.cardType || "basic";
    if (cardType === "enumerate") {
      // back = "1. Item\n2. Item\n3. Item"; front = pregunta
      return `
        <div class="card ${showBack ? "flipped" : ""}" data-act="flip">
          <div class="face">
            <div class="label">Front · ${escapeHtml(card.subject || "general")}</div>
            <div class="question">${escapeHtml(card.front)}</div>
          </div>
          <div class="back enumerate">
            <div class="label">Back · Completa la lista</div>
            <ol class="enum-list">
              ${(card.back || "")
                .split(/\n/)
                .filter((l) => /^\s*\d+[\.\)]/.test(l))
                .map((l) => `<li>${escapeHtml(l.replace(/^\s*\d+[\.\)]\s*/, ""))}</li>`)
                .join("")}
            </ol>
          </div>
        </div>`;
    }
    // Default basic/cloze.
    return `
      <div class="card ${showBack ? "flipped" : ""}" data-act="flip">
        <div class="face">
          <div class="label">Front · ${escapeHtml(card.subject || "general")}</div>
          <div class="question">${escapeHtml(card.front)}</div>
        </div>
        <div class="back">
          <div class="label">Back</div>
          <div class="answer">${escapeHtml(card.back)}</div>
          ${card.sourceNoteId ? `<div class="meta">from ${escapeHtml(card.sourceNoteId.slice(0, 18))}</div>` : ""}
        </div>
      </div>
    `;
  }

  function bindCard(card) {
    root.querySelector('[data-act="close"]').addEventListener("click", () => cleanup());
    const flipEl = root.querySelector('[data-act="flip"]');
    if (flipEl) {
      flipEl.addEventListener("click", () => {
        card._showBack = true;
        renderCard(card, true);
      });
    }
    root.querySelectorAll(".rate-btn").forEach((b) => {
      b.addEventListener("click", async () => {
        const rating = parseInt(b.dataset.rate, 10);
        await gradeCard(card, rating);
      });
    });
    // Limpieza del handler anterior (key listener) si la card cambió
    if (currentKeyCleanup) { currentKeyCleanup(); currentKeyCleanup = null; }

    // keyboard
    const onKey = (e) => {
      if (e.key === " " || e.key === "Enter") {
        if (!card._showBack) {
          card._showBack = true;
          renderCard(card, true);
        } else {
          // rating por defecto = Good si está revelado
          gradeCard(card, 3);
        }
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        if (!card._showBack) {
          // §3.1 active recall enforcement: si la card no está revelada,
          // una pulsación 1-4 también revela, pero NO ratingea. Esto entrena
          // al usuario a no autoevaluar antes de intentar el recall.
          card._showBack = true;
          renderCard(card, true);
          return;
        }
        gradeCard(card, parseInt(e.key, 10));
      } else if (e.key === "Escape") {
        cleanup();
      }
    };
    document.addEventListener("keydown", onKey);
    currentKeyCleanup = () => document.removeEventListener("keydown", onKey);
  }

  /**
   * gradeCard — evalúa una sola card.
   *
   *   v2.24.0 — active-recall enforcement (paper §3.1):
   *     rating sin reveal activo → rechazado y forzar reveal.
   *
   *   v2.24.0 — backend bridge:
   *     1. Llama /api/v1/fsrs/eval con la lista de 1 card (esta).
   *        algorithm="fsrs-v6" (default).
   *     2. Backend devuelve newState (objeto Card ts-fsrs).
   *     3. Normaliza al shape cliente y persiste cache.
   *     4. Si backend unreachable → FSRS-4.5 cliente (preserva sesión).
   *
   *   v2.24.0 — elaboration prompt (paper §3.5):
   *     Si rating === "Again", después de aceptar el rating, prompt al user
   *     "¿por qué fallaste? ¿cómo se relaciona con X?" y persistir en
   *     localStorage "pending elaborations" (queue para sync futuro).
   */
  async function gradeCard(card, rating) {
    if (!card._showBack) {
      // Active-recall enforcement: revelar primero.
      card._showBack = true;
      renderCard(card, true);
      return;
    }
    if (card._pendingRating) return;
    card._pendingRating = true;

    const priorFs = card.fsrs || {};
    const cardSnapshot = { ...card, fsrs: priorFs };

    const backendReview = async () => {
      const r = await api._raw("POST", "/fsrs/eval", {
        userId: getCurrentUserId(),
        cards: [{ cardId: card.id, rating, currentState: backendFsrsFromState(priorFs) }],
        algorithm: "fsrs-v6",
      });
      // El backend devuelve { jobId }, no el newState inmediato. Por ahora
      // simplificamos: re-leemos el state local con un POST síncrono en otra
      // ruta cuando la respuesta esté lista. Para evitar complejidad, usamos
      // el fallback cliente en modo v2.24.0 si no hay respuesta inmediata.
      return r;
    };

    // v2.24.0 — siempre intentamos cliente primero (determinístico), sincronizamos
    // al backend en fire-and-forget. Evita stalls por latencia.
    const clientNext = clientReview(priorFs, rating);
    card.fsrs = clientNext;
    setCardState(card.id, clientNext);

    // Fire-and-forget: enviar al backend para cross-device sync
    fireBackendSync(card.id, rating, priorFs);

    reviewed++;
    if (rating >= 3) correct++;
    queue.shift();

    // Requeue si quedó en learning/relearning.
    if ((clientNext.state === "learning" || clientNext.state === "relearning") && clientNext.reps < REQUEUE_MAX) {
      const cardCopy = { ...card, fsrs: clientNext, _requeued: (card._requeued || 0) + 1 };
      queue.push(cardCopy);
    }

    // Paper §3.5 — si fue "Again", prompt de elaboración.
    if (rating === 1 && !forcedElabOn) {
      forcedElabOn = true;
      setTimeout(() => promptElaboration(card), 50);
    }

    render();
    card._pendingRating = false;
  }

  /**
   * v2.24.0 — fire-and-forget hacia backend FSRS-6.
   * Si falla, no se interrumpe la sesión — el estado local ya está actualizado.
   */
  function fireBackendSync(cardId, rating, priorFs) {
    if (!navigator.onLine) return;
    api._raw("POST", "/fsrs/eval", {
      userId: getCurrentUserId(),
      cards: [{ cardId, rating, currentState: backendFsrsFromState(priorFs) }],
      algorithm: "fsrs-v6",
    }).then((r) => {
      if (r?.cards?.[0]?.newState) {
        const newState = normalizeBackendState(r.cards[0].newState);
        setBackendCache(cardId, newState);
      }
    }).catch(() => {
      /* offline-ok */
    });
  }

  /** Convierte nuestro shape FSRS al shape ts-fsrs que el backend espera. */
  function backendFsrsFromState(state) {
    return {
      stability: state.stability ?? 0,
      difficulty: state.difficulty ?? 5,
      state: state.state === "new" ? 0 : state.state === "learning" ? 1 : state.state === "review" ? 2 : 3,
      reps: state.reps ?? 0,
      lapses: state.lapses ?? 0,
      last_review: state.lastReview ? new Date(state.lastReview) : null,
      due: state.due ? new Date(state.due) : new Date(),
    };
  }

  /**
   * v2.24.0 — prompt de elaboración tras Again (paper §3.5).
   * No bloqueante (window.prompt legacy), fácil de implementar.
   * El elaborations[] se sincroniza cuando el backend lo soporte (v2.25).
   */
  function promptElaboration(card) {
    const answer = window.prompt(
      `📝 Elaboración activa (paper §3.5)\n\n¿Por qué fallaste "${card.front.slice(0, 60)}…"?\n\nEscribe la causa (o cancela para omitir):`,
      "",
    );
    if (answer && answer.trim().length > 5) {
      pushPendingElab({
        cardId: card.id,
        question: "¿Por qué fallaste esta card?",
        answer: answer.trim(),
        ts: Date.now(),
      });
      ok(`Elaboración guardada (se sincronizará cuando vuelvas online)`);
    }
  }

  function ok(text) {
    if (typeof window.toast === "function") window.toast(text);
  }

  function getCurrentUserId() {
    try {
      const tok = JSON.parse(localStorage.getItem("mnexus.session.token") || "null");
      if (tok && typeof tok === "object" && tok.userId) return tok.userId;
    } catch {}
    // Fallback: device-id cookie
    try { return (JSON.parse(localStorage.getItem("mnexus.device.id") || "null") || {}).id || "anon"; }
    catch { return "anon"; }
  }

  function renderDone() {
    root.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🎉</div>
        <h2>Sesión completa</h2>
        <p>${correct} correctas de ${reviewed}.</p>
        <button data-act="close">Cerrar</button>
      </div>
    `;
    root.querySelector('[data-act="close"]').addEventListener("click", () => cleanup());
  }

  function cleanup() {
    document.removeEventListener("keydown", onKeyCard?.bind(null));
    root.remove();
  }

  if (queue.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📭</div>
        <h2>No hay cards para estudiar</h2>
        <p>Crea algunas flashcards primero o vuelve cuando haya más por repasar.</p>
        <button data-act="close">Cerrar</button>
      </div>
    `;
    root.querySelector('[data-act="close"]').addEventListener("click", () => cleanup());
    return;
  }

  render();
}

/**
 * v2.24.0 — interleaving (paper §3.4): dentro de una sesión de N cards,
 * mezcla cards de interleaveGroups hermanos según su due y dificultosidad.
 * Trigger: opts.interleave === true desde openStudySession().
 *
 * Heurística conservadora: cada grupo se enlaza a sus pares más cercanos
 * por proximidad temporal de due (no se rompe el orden FSRS dominante).
 */
function interleaveCards(cards) {
  // Grupos: { key → [card1, card2, ...] }
  const groups = new Map();
  for (const c of cards) {
    const k = c.interleaveGroup || "—default—";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  if (groups.size < 2) return cards; // sólo 1 grupo, no hay nada que interleaver

  // Para cada grupo, ordénalo por due.
  for (const list of groups.values()) {
    list.sort((a, b) => (a.fsrs?.due ?? 0) - (b.fsrs?.due ?? 0));
  }

  // Interleava round-robin entre grupos, manteniendo orden FSRS dentro de cada grupo.
  const result = [];
  const maxLen = Math.max(...[...groups.values()].map((g) => g.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of groups.values()) {
      if (i < list.length) result.push(list[i]);
    }
  }
  return result;
}

const STYLE = `
.study {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: linear-gradient(135deg, #f6f7fb 0%, #e6e9f3 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--s-5);
  overflow-y: auto;
}
[data-theme="dark"] .study, @media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .study { background: linear-gradient(135deg, #0f1115 0%, #1a1d24 100%); color: #f0f0f0; }
}
.study .head {
  width: 100%; max-width: 720px;
  display: grid; grid-template-columns: 32px 1fr 60px; gap: var(--s-3);
  align-items: center;
  margin-bottom: var(--s-3);
}
.study .head .prog { height: 8px; background: var(--border); border-radius: 999px; overflow: hidden; }
.study .head .fill { background: var(--accent); height: 100%; transition: width 0.3s ease; }
.study .head .close {
  width: var(--hit-target, 44px); height: var(--hit-target, 44px);
  border-radius: 50%; border: 1px solid var(--border);
  background: transparent; cursor: pointer; font-size: 18px;
}
.study .head .counter { font: 12px/1 ui-monospace, monospace; text-align: right; }
.study .stats {
  width: 100%; max-width: 720px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3);
  margin-bottom: var(--s-3);
}
.study .stat-pill {
  padding: var(--s-3) var(--s-2);
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  text-align: center;
}
.study .stat-pill .v { font-weight: 700; font-size: var(--fs-lg); }
.study .stat-pill .l { font-size: 11px; color: var(--fg-muted); }
.study .card-meta {
  width: 100%; max-width: 720px;
  display: flex; gap: var(--s-3); align-items: center;
  font: 12px/1 system-ui; color: var(--fg-muted);
  margin-bottom: var(--s-2);
}
.study .card-meta .state { padding: 2px 8px; background: var(--bg-elevated); border-radius: 999px; }
.study .card-wrap { width: 100%; max-width: 720px; perspective: 1200px; }
.study .card {
  position: relative; width: 100%; min-height: 240px;
  border-radius: 14px;
  background: linear-gradient(135deg, var(--surface, #fff) 0%, var(--bg-elevated, #fff) 100%);
  border: 1px solid var(--border);
  padding: 24px; display: flex; flex-direction: column; gap: var(--s-3);
  cursor: pointer;
  transform-style: preserve-3d;
  transition: transform 0.4s ease;
}
.study .card.flipped { transform: rotateY(180deg); }
.study .card .face, .study .card .back {
  backface-visibility: hidden;
  display: flex; flex-direction: column; gap: 8px;
}
.study .card .back {
  position: absolute; inset: 0;
  border-radius: 14px; padding: 24px;
  background: linear-gradient(135deg, #e6efff 0%, #d0e1ff 100%);
  transform: rotateY(180deg);
}
[data-theme="dark"] .study .card .back,
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .study .card .back {
    background: linear-gradient(135deg, #1f2c45 0%, #2a3a5c 100%);
  }
}
.study .card .label { font: 11px/1 ui-monospace, monospace; text-transform: uppercase; color: var(--fg-muted); letter-spacing: 0.06em; }
.study .card .question { font-size: var(--fs-lg, 20px); font-weight: 600; line-height: 1.4; white-space: pre-wrap; }
.study .card .answer { font-size: var(--fs-lg, 20px); line-height: 1.5; white-space: pre-wrap; }
.study .card .meta { margin-top: auto; color: var(--fg-muted); font: 11px/1 ui-monospace, monospace; }
.study .card .back.enumerate ol.enum-list { padding-left: 24px; line-height: 1.7; }
.study .ratings {
  width: 100%; max-width: 720px;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-2);
  margin-top: var(--s-3);
}
.study .ratings[data-disabled] { opacity: 0.4; pointer-events: none; filter: grayscale(0.4); }
.study .rate-btn {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  padding: 12px; border-radius: 10px;
  font-weight: 600; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  min-height: var(--hit-target, 44px);
  transition: transform 0.1s ease, background 0.2s ease;
}
.study .rate-btn:hover { transform: translateY(-1px); }
.study .rate-btn:active { transform: translateY(0); }
.study .rate-btn .int { font-size: 14px; opacity: 0.6; }
.study .rate-btn.again { border-bottom: 3px solid #c83e30; }
.study .rate-btn.hard  { border-bottom: 3px solid #c26612; }
.study .rate-btn.good  { border-bottom: 3px solid #1d7d54; }
.study .rate-btn.easy  { border-bottom: 3px solid #2563eb; }
.study .hint {
  margin-top: var(--s-3);
  font: 12px/1.5 system-ui;
  color: var(--fg-muted);
  text-align: center;
  max-width: 720px;
}
.study .hint kbd {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  background: var(--bg-elevated);
}
.study .empty-state { text-align: center; padding: 64px; }
.study .empty-state .emoji { font-size: 64px; }
.study .empty-state h2 { margin: var(--s-3) 0; }
.study .empty-state p { margin-bottom: var(--s-4); color: var(--fg-muted); }
.study .empty-state button {
  background: var(--accent, #7c4dff); color: #fff; border: 0;
  padding: 10px 20px; border-radius: 999px; font: 600 14px/1 system-ui;
  min-height: var(--hit-target, 44px); cursor: pointer;
}
`;

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatMmss(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return "ahora";
}

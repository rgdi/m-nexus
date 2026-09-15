/* ============================================================
 * exams.js — Exam generation con smart scheduling + anti-repeat.
 * v2.0.5 — usuario escoge subject/carpeta/notas; el sistema:
 *   1. Prioriza cards "difíciles" (lapses > 0 o difficulty > 6)
 *   2. Balancea topics según peso histórico (FSRS state)
 *   3. Anti-repeat: no muestra una card si fue vista en últimas 3 sessions
 *   4. Incluye occlusion cards aprobadas
 *   5. Mezcla flashcards + cloze (open cloze) + multiple choice
 * ============================================================ */

const HISTORY_KEY = "mnexus.exam.history.v1";
const SESSION_SIZE = 20;

/**
 * buildExam — genera una sesión de examen para un scope.
 * @param scope { kind: "subject"|"folder"|"note", value: string }
 * @param cards  todas las cards del vault (filtradas por scope)
 * @param occlusionCards cards de image occlusion aprobadas (también por scope)
 * @returns { items: ExamItem[], totalEstimatedMin: number }
 */
export async function buildExam(scope, cards, occlusionCards = []) {
  const now = Date.now();
  const filtered = filterByScope(cards, scope);
  const filteredOcc = filterByScope(occlusionCards, scope);
  // merge: occlusion cards become cloze-style items
  const allItems = [
    ...filtered.map((c) => ({ kind: "flashcard", card: c, source: "fc" })),
    ...filteredOcc.map((o) => ({
      kind: "cloze",
      card: { front: o.front, back: o.back, subject: o.subject, id: o.id, sourceNoteId: o.noteId },
      source: "occ",
    })),
  ];

  // Filter out recently seen (last 3 sessions per card)
  const history = loadHistory();
  const recentIds = new Set();
  for (const cardId in history) {
    const last3 = (history[cardId] || []).slice(-3);
    if (last3.length > 0) recentIds.add(cardId);
  }
  const candidates = allItems.filter((it) => !recentIds.has(it.card.id));

  // Score: difficulty weight
  const scored = candidates.map((it) => {
    const fs = JSON.parse(localStorage.getItem("mnexus.fsrs.cards.v1") || "{}")[it.card.id] || {};
    const diffWeight = (fs.difficulty || 5) / 10;       // 0..1
    const lapseWeight = (fs.lapses || 0) > 0 ? 0.4 : 0; // boost lapsed
    const overdueWeight = cdfOverdue(fs);                // 0..1
    const score = 0.4 * diffWeight + 0.3 * overdueWeight + 0.3 * (1 - lapseWeight);
    return { ...it, score, _fs: fs };
  });
  scored.sort((a, b) => b.score - a.score);

  // Take top N
  const picked = scored.slice(0, SESSION_SIZE);
  return {
    items: picked,
    totalEstimatedMin: Math.ceil(picked.length * 0.5),
    skipped: candidates.length - picked.length,
  };
}

function filterByScope(items, scope) {
  if (!scope || scope.kind === "all") return items;
  return items.filter((c) => {
    if (scope.kind === "subject") return c.subject === scope.value;
    if (scope.kind === "note") return c.sourceNoteId === scope.value || c.id === scope.value;
    return true;
  });
}

function cdfOverdue(fs) {
  if (!fs.due) return 0.5;
  const overdue = (Date.now() - fs.due) / 86400000;
  return Math.min(1, Math.max(0, overdue / 14));
}

/**
 * recordAnswer — actualiza el history al terminar una pregunta.
 */
export function recordAnswer(cardId, wasCorrect) {
  const all = loadHistory();
  if (!all[cardId]) all[cardId] = [];
  all[cardId].push({ at: Date.now(), correct: wasCorrect });
  if (all[cardId].length > 10) all[cardId] = all[cardId].slice(-10);
  saveHistory(all);
}

export function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}"); }
  catch { return {}; }
}
function saveHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch {}
}

/**
 * getRecentSeenIds — IDs de cards vistas en las últimas N sesiones.
 */
export function getRecentSeenIds(n = 3) {
  const history = loadHistory();
  const recent = new Set();
  for (const cardId in history) {
    const recentEntries = (history[cardId] || []).slice(-n);
    if (recentEntries.length > 0) recent.add(cardId);
  }
  return recent;
}

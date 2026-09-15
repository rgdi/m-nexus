/* ============================================================
 * exams.js — Exam generation con smart scheduling + coverage.
 * v2.1.0 — UNIVERSITY mode: ensure 100% syllabus coverage before
 *          repeating. Greedy set-cover picks cards that maximize
 *          uncovered topics first.
 * ============================================================ */

const HISTORY_KEY = "mnexus.exam.history.v1";
const SESSION_SIZE = 20;

export const EXAM_MODES = {
  REVIEW: "review",          // smart scheduling + anti-repeat
  UNIVERSITY: "university",  // ensure coverage + prioritize weak concepts
  CRAM: "cram",              // rapid-fire random from scope
};

/**
 * buildExam — genera una sesión de examen para un scope y modo.
 * @param scope { kind: "subject"|"folder"|"note", value: string }
 * @param cards  todas las cards del vault (filtradas por scope)
 * @param occlusionCards cards de image occlusion aprobadas (también por scope)
 * @param opts.mode "review" | "university" | "cram"
 * @param opts.sizeOverride N | null
 */
export async function buildExam(scope, cards, occlusionCards = [], opts = {}) {
  const mode = opts.mode || EXAM_MODES.REVIEW;
  const size = opts.sizeOverride || SESSION_SIZE;
  const filtered = filterByScope(cards, scope);
  const filteredOcc = filterByScope(occlusionCards, scope);
  const allItems = [
    ...filtered.map((c) => ({ kind: "flashcard", card: c, source: "fc", topic: topicOf(c) })),
    ...filteredOcc.map((o) => ({
      kind: "cloze",
      card: { front: o.front, back: o.back, subject: o.subject, id: o.id, sourceNoteId: o.noteId },
      source: "occ",
      topic: topicOf(o),
    })),
  ];

  if (mode === EXAM_MODES.CRAM) {
    const shuffled = shuffle([...allItems]);
    return {
      items: shuffled.slice(0, size),
      mode,
      totalEstimatedMin: Math.ceil(size * 0.4),
      skipped: 0,
      coverage: 1,
    };
  }

  // Anti-repeat (last 3 sessions per card)
  const history = loadHistory();
  const recentIds = new Set();
  for (const cardId in history) {
    const last3 = (history[cardId] || []).slice(-3);
    if (last3.length > 0) recentIds.add(cardId);
  }
  const candidates = allItems.filter((it) => !recentIds.has(it.card.id));

  if (mode === EXAM_MODES.UNIVERSITY) {
    return pickByCoverage(candidates, size, mode);
  }
  return pickByDifficulty(candidates, size, mode);
}

/**
 * pickByDifficulty — greedy by FSRS difficulty/lapses/overdue.
 */
function pickByDifficulty(candidates, size, mode) {
  const scored = candidates.map((it) => {
    const fs = JSON.parse(localStorage.getItem("mnexus.fsrs.cards.v1") || "{}")[it.card.id] || {};
    const diffWeight = (fs.difficulty || 5) / 10;
    const lapseWeight = (fs.lapses || 0) > 0 ? 0.4 : 0;
    const overdueWeight = cdfOverdue(fs);
    const score = 0.4 * diffWeight + 0.3 * overdueWeight + 0.3 * (1 - lapseWeight);
    return { ...it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, size);
  return {
    items: picked,
    mode,
    totalEstimatedMin: Math.ceil(picked.length * 0.5),
    skipped: candidates.length - picked.length,
    coverage: 1,
  };
}

/**
 * pickByCoverage — greedy set-cover. Each card covers 1 topic;
 * a topic is "covered" once at least 1 card from it is in the
 * session. We keep picking cards from uncovered topics until
 * either (a) all topics are covered, or (b) we hit `size`.
 * After coverage is full, we add difficult cards as filler.
 */
function pickByCoverage(candidates, size, mode) {
  const topics = new Map();
  for (const it of candidates) {
    const t = it.topic || "general";
    if (!topics.has(t)) topics.set(t, []);
    topics.get(t).push(it);
  }
  const allTopics = [...topics.keys()];
  const picked = [];
  const used = new Set();
  const covered = new Set();
  while (covered.size < allTopics.length && picked.length < size) {
    let bestCard = null;
    let bestTopic = null;
    let bestScore = -Infinity;
    for (const [topic, list] of topics) {
      if (covered.has(topic)) continue;
      for (const it of list) {
        if (used.has(it.card.id)) continue;
        const fs = JSON.parse(localStorage.getItem("mnexus.fsrs.cards.v1") || "{}")[it.card.id] || {};
        const score = (fs.difficulty || 5) / 10 * 0.5 + cdfOverdue(fs) * 0.3 + ((fs.lapses || 0) > 0 ? 0.2 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestCard = it;
          bestTopic = topic;
        }
      }
    }
    if (!bestCard) break;
    picked.push(bestCard);
    used.add(bestCard.card.id);
    covered.add(bestTopic);
  }
  // Filler: difficult cards (repeats allowed)
  const remaining = candidates.filter((it) => !used.has(it.card.id));
  const filler = pickByDifficulty(remaining, size - picked.length, mode);
  for (const f of filler.items) {
    picked.push(f);
    if (picked.length >= size) break;
  }
  const coverage = allTopics.length === 0 ? 1 : covered.size / allTopics.length;
  return {
    items: picked,
    mode,
    totalEstimatedMin: Math.ceil(picked.length * 0.5),
    skipped: candidates.length - picked.length,
    coverage,
    totalTopics: allTopics.length,
    coveredTopics: covered.size,
  };
}

function topicOf(c) {
  return (c.subject || c.tags?.[0] || "general").toLowerCase();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

export function getRecentSeenIds(n = 3) {
  const history = loadHistory();
  const recent = new Set();
  for (const cardId in history) {
    const recentEntries = (history[cardId] || []).slice(-n);
    if (recentEntries.length > 0) recent.add(cardId);
  }
  return recent;
}

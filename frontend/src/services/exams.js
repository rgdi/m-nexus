/* ============================================================
 * exams.js — Study sessions con cobertura + scheduling.
 * v2.1.0 — STUDY mode: study ALL topics until you've reviewed
 *          each at least once. Returns a roadmap of topics
 *          sorted weakest-first, marking which you've covered.
 * v2.1.1 — EXAM mode: focused quiz across the syllabus.
 * ============================================================ */

const HISTORY_KEY = "mnexus.exam.history.v1";
const COVERAGE_KEY = "mnexus.exam.coverage.v1";
const SESSION_SIZE = 20;

export const STUDY_MODES = {
  STUDY: "study",       // recorrer TODOS los topics, weakest first, hasta 100%
  REVIEW: "review",     // smart scheduling + anti-repeat (dificiles primero)
  EXAM: "exam",         // quiz balanceado (mezcla), igual cobertura
  CRAM: "cram",         // rapid-fire random
};

/**
 * Inspect the syllabus: returns metadata per topic.
 * Topic = subject (or tag fallback). Each topic has a cardCount +
 * a coverage% = (cards seen at least once in last 30 days) / total.
 */
export function inspectSyllabus(cards, occlusionCards = []) {
  const all = [...cards, ...occlusionCards];
  const topics = new Map();
  for (const c of all) {
    const t = (c.subject || c.tags?.[0] || "general").toLowerCase();
    if (!topics.has(t)) topics.set(t, { name: t, total: 0, seen: 0, cards: [] });
    const tt = topics.get(t);
    tt.total += 1;
    tt.cards.push(c);
  }
  // coverage: count cards seen in last 30 days per topic
  const history = loadHistory();
  const cutoff = Date.now() - 30 * 86400 * 1000;
  for (const tt of topics.values()) {
    for (const c of tt.cards) {
      const last = (history[c.id] || []).slice(-1)[0];
      if (last && last.at >= cutoff) tt.seen += 1;
    }
  }
  return [...topics.values()].map((tt) => ({
    name: tt.name,
    total: tt.total,
    seen: tt.seen,
    coverage: tt.total === 0 ? 1 : tt.seen / tt.total,
    cardIds: tt.cards.map((c) => c.id),
  }));
}

/**
 * buildSession — devuelve la siguiente tanda de cards para un
 * modo y scope. Cada modo prioriza diferente.
 * @returns { items, mode, syllabus?: SyllabusInfo, target: string, totalTopics, coveredTopics }
 */
export async function buildSession(scope, cards, occlusionCards = [], opts = {}) {
  const mode = opts.mode || STUDY_MODES.REVIEW;
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

  if (mode === STUDY_MODES.CRAM) {
    return {
      items: shuffle([...allItems]).slice(0, size),
      mode,
      totalTopics: new Set(allItems.map((it) => it.topic)).size,
      coveredTopics: new Set(allItems.map((it) => it.topic)).size,
      target: "cram",
    };
  }

  if (mode === STUDY_MODES.STUDY) {
    // v2.1.0 study: muestra topics empezando por LOS NO CUBIERTOS
    // y avanza solo cuando estén dominados. Si un topic tiene
    // coverage<1, sigue poniéndolo hasta llegar a 100%.
    return buildStudySession(allItems, size);
  }

  if (mode === STUDY_MODES.EXAM) {
    // Equivalente a STUDY pero entrega todos los topics a la vez
    // (cobertura debe estar 100% antes de iniciar).
    return buildStudySession(allItems, size, { allowPartial: true });
  }

  return pickByDifficulty(allItems, size);
}

/**
 * buildStudySession — STUDENT-FIRST. Iteración:
 * 1. compute per-topic coverage from history
 * 2. queue = uncovered topics (coverage<1) sorted weakest-first
 * 3. fill with one card per uncovered topic (greedy)
 * 4. if items < size, add difficult repeats as filler
 * 5. return syllabus info so the UI can show progress + ETA
 */
function buildStudySession(allItems, size, opts = {}) {
  const coverageByTopic = computeCoverage(allItems);
  const allTopics = [...new Set(allItems.map((it) => it.topic))];
  if (allTopics.length === 0) {
    return { items: [], mode: STUDY_MODES.STUDY, totalTopics: 0, coveredTopics: 0, target: "empty" };
  }

  const topics = allTopics.map((t) => ({
    name: t,
    coverage: coverageByTopic[t] || 0,
    cards: allItems.filter((it) => it.topic === t),
  }));
  // Sort: 100% covered at the END (después), 0% covered at front
  topics.sort((a, b) => a.coverage - b.coverage);

  const picked = [];
  const used = new Set();
  let round = 0;
  // Greedy: each topic must contribute at least one card while covered<1.
  while (picked.length < size) {
    let advanced = false;
    for (const t of topics) {
      if (picked.length >= size) break;
      if (!opts.allowPartial && t.coverage >= 1) continue;
      const unseen = t.cards.find((c) => !used.has(c.card.id));
      if (!unseen) continue;
      picked.push(unseen);
      used.add(unseen.card.id);
      advanced = true;
    }
    if (!advanced) break;
    round += 1;
    // Safety: don't loop forever
    if (round > size * 2) break;
  }
  // filler: difficult cards (already covered) to push for repetition
  if (picked.length < size) {
    const remaining = allItems.filter((it) => !used.has(it.card.id));
    const filler = pickByDifficulty(remaining, size - picked.length);
    for (const f of filler.items) {
      picked.push(f);
      if (picked.length >= size) break;
    }
  }

  const coveredTopics = topics.filter((t) => t.coverage >= 1).length;
  return {
    items: picked,
    mode: STUDY_MODES.STUDY,
    syllabus: topics,
    totalTopics: topics.length,
    coveredTopics,
    target: opts.allowPartial ? "exam" : "study",
  };
}

function pickByDifficulty(candidates, size) {
  const scored = candidates.map((it) => {
    const fs = JSON.parse(localStorage.getItem("mnexus.fsrs.cards.v1") || "{}")[it.card.id] || {};
    const diffWeight = (fs.difficulty || 5) / 10;
    const lapseWeight = (fs.lapses || 0) > 0 ? 0.4 : 0;
    const overdueWeight = cdfOverdue(fs);
    const score = 0.4 * diffWeight + 0.3 * overdueWeight + 0.3 * (1 - lapseWeight);
    return { ...it, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return { items: scored.slice(0, size) };
}

/** coverage per topic = unique cards seen in last 30 days / total */
function computeCoverage(items) {
  const history = loadHistory();
  const cutoff = Date.now() - 30 * 86400 * 1000;
  const byTopic = new Map();
  const seenIdsByTopic = new Map();
  for (const it of items) {
    if (!byTopic.has(it.topic)) {
      byTopic.set(it.topic, 0);
      seenIdsByTopic.set(it.topic, new Set());
    }
    byTopic.set(it.topic, byTopic.get(it.topic) + 1);
    const last = (history[it.card.id] || []).slice(-1)[0];
    if (last && last.at >= cutoff) {
      seenIdsByTopic.get(it.topic).add(it.card.id);
    }
  }
  const out = {};
  for (const [t, total] of byTopic) {
    out[t] = total === 0 ? 0 : seenIdsByTopic.get(t).size / total;
  }
  return out;
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

/** progress snapshot for the syllabus — 0..1 across ALL topics. */
export function syllabusProgress(cards, occlusionCards = []) {
  const filtered = filterByScope(cards, { kind: "all" });
  const allItems = [
    ...filtered.map((c) => ({ kind: "flashcard", card: c, topic: topicOf(c) })),
    ...occlusionCards.map((o) => ({ kind: "cloze", card: o, topic: topicOf(o) })),
  ];
  const cov = computeCoverage(allItems);
  const topics = Object.keys(cov);
  if (topics.length === 0) return 1;
  const sum = topics.reduce((s, t) => s + cov[t], 0);
  return sum / topics.length;
}

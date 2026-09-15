/* ============================================================
 * syllabus.js — University syllabus tracker.
 *
 * El objetivo REAL no es "generar un examen que cubra todo el
 * temario" sino **saber el 100% del temario ANTES del día del
 * examen real**. El sistema debe:
 *
 *   1. Definir un syllabus: lista de topics por subject (manual
 *      o auto-extraído de las notas).
 *   2. Track mastery por topic (0..1) basado en FSRS de las cards
 *      que cubren ese topic + última review + # reps.
 *   3. Plan de estudio hasta deadline:
 *      - "Tienes 14 días, 47 topics, ritmo actual → cubrirás 32
 *        antes del examen. NECESITAS acelerar."
 *      - Recomienda cadence (cards/día) para llegar al 100%.
 *   4. Detección de gaps: topics no estudiados / mastery < 0.7 /
 *      sin review en > 14 días.
 *
 * Storage keys:
 *   mnexus.syllabus.v1              → { subjectId: { name, topics:[{id,name,mastery,lastReview,reps,due}], examDate } }
 *   mnexus.syllabus.progress.v1     → { subjectId: { studiedTopics, totalTopics, lastSessionTs } }
 * ============================================================ */

const KEY = "mnexus.syllabus.v1";
const PROG_KEY = "mnexus.syllabus.progress.v1";
const REC_KEY = "mnexus.syllabus.recommendations.v1";

function readJSON(k, d = null) {
  try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); }
  catch { return d; }
}
function writeJSON(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

/* ---------- 1. CRUD syllabus ---------- */

export function listSubjects() {
  return Object.entries(readJSON(KEY, {})).map(([id, s]) => ({ id, ...s }));
}

export function getSyllabus(subjectId) {
  const all = readJSON(KEY, {});
  return all[subjectId] || null;
}

export function setSyllabus(subjectId, syllabus) {
  const all = readJSON(KEY, {});
  all[subjectId] = syllabus;
  writeJSON(KEY, all);
}

export function deleteSyllabus(subjectId) {
  const all = readJSON(KEY, {});
  delete all[subjectId];
  writeJSON(KEY, all);
}

/**
 * Add a topic to a subject syllabus.
 */
export function addTopic(subjectId, topicName) {
  const all = readJSON(KEY, {});
  if (!all[subjectId]) all[subjectId] = { name: subjectId, topics: [], examDate: null };
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  all[subjectId].topics.push({
    id, name: topicName, mastery: 0, reps: 0, lastReview: 0, due: Date.now(),
  });
  writeJSON(KEY, all);
  return id;
}

export function removeTopic(subjectId, topicId) {
  const all = readJSON(KEY, {});
  if (all[subjectId]) {
    all[subjectId].topics = (all[subjectId].topics || []).filter((t) => t.id !== topicId);
    writeJSON(KEY, all);
  }
}

/**
 * Set exam date for a subject.
 */
export function setExamDate(subjectId, isoDate) {
  const all = readJSON(KEY, {});
  if (!all[subjectId]) all[subjectId] = { name: subjectId, topics: [] };
  all[subjectId].examDate = isoDate;
  writeJSON(KEY, all);
}

/**
 * Auto-extract topics from notes: for each subject, scan note bodies
 * for `[[wikilinks]]`, headings, and #tags. Returns suggested topics.
 */
export function suggestTopicsFromNotes(notes, subjectId) {
  const subject = (subjectId || "").toLowerCase();
  const set = new Set();
  for (const n of notes || []) {
    if (subject && (n.subject || "").toLowerCase() !== subject) continue;
    const body = n.body || "";
    // wikilinks [[X]]
    const wikis = body.match(/\[\[([^\]\n]+)\]\]/g) || [];
    wikis.forEach((w) => set.add(w.replace(/\[\[|\]\]/g, "").trim()));
    // headings (# ... or ## ...)
    const heads = body.match(/^#{1,3}\s+(.+)$/gm) || [];
    heads.forEach((h) => set.add(h.replace(/^#+\s*/, "").trim()));
    // tags #tag (not headers)
    const tagMatches = body.match(/(?:^|\s)#([\p{L}0-9_\-]+)/gu) || [];
    tagMatches.forEach((t) => set.add("#" + t.slice(1)));
  }
  return [...set].filter((s) => s && s.length < 80);
}

/**
 * Bulk-add suggested topics.
 */
export function importSuggestedTopics(subjectId, topicNames) {
  const all = readJSON(KEY, {});
  if (!all[subjectId]) all[subjectId] = { name: subjectId, topics: [] };
  const existing = new Set((all[subjectId].topics || []).map((t) => t.name.toLowerCase()));
  for (const name of topicNames) {
    if (!name || existing.has(name.toLowerCase())) continue;
    all[subjectId].topics.push({
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name, mastery: 0, reps: 0, lastReview: 0, due: Date.now(),
    });
    existing.add(name.toLowerCase());
  }
  writeJSON(KEY, all);
}

/* ---------- 2. Mastery tracking ---------- */

/**
 * Update mastery of a topic based on FSRS outcomes.
 * mastery = sigmoid of (reps * 0.6 + (1 - lapses) * 0.4 - daysSinceReview * 0.05)
 * bounded to 0..1.
 */
export function recordTopicReview(subjectId, topicId, fsrsState) {
  const all = readJSON(KEY, {});
  const topic = all[subjectId]?.topics?.find((t) => t.id === topicId);
  if (!topic) return;
  topic.reps = (topic.reps || 0) + 1;
  topic.lastReview = Date.now();
  const s = fsrsState || { stability: 1, difficulty: 5, lapses: 0 };
  // Convert stability to "memory retention" using FSRS R curve
  const daysSince = 0;
  const retention = Math.exp(-daysSince / Math.max(0.1, s.stability || 1));
  const lapse = s.lapses || 0;
  topic.mastery = Math.max(0, Math.min(1,
    0.5 * Math.min(1, topic.reps / 5) +
    0.3 * retention -
    0.2 * Math.min(1, lapse / 3)
  ));
  // Next due in 1 day (will be re-computed by FSRS scheduler)
  topic.due = Date.now() + 86400000;
  writeJSON(KEY, all);
}

/**
 * Aggregate subject mastery: % of topics with mastery >= 0.8 (mastered).
 */
export function subjectCoverage(subjectId) {
  const syl = getSyllabus(subjectId);
  if (!syl) return { totalTopics: 0, mastered: 0, partial: 0, untouched: 0, coverage: 0 };
  const topics = syl.topics || [];
  const mastered = topics.filter((t) => (t.mastery || 0) >= 0.8).length;
  const partial = topics.filter((t) => (t.mastery || 0) >= 0.4 && (t.mastery || 0) < 0.8).length;
  const untouched = topics.filter((t) => (t.mastery || 0) < 0.4).length;
  return {
    totalTopics: topics.length,
    mastered,
    partial,
    untouched,
    coverage: topics.length === 0 ? 0 : mastered / topics.length,
  };
}

/**
 * Cross-subject overview.
 */
export function overview() {
  const all = listSubjects();
  return all.map((s) => {
    const cov = subjectCoverage(s.id);
    return {
      id: s.id,
      name: s.name,
      examDate: s.examDate,
      ...cov,
    };
  });
}

/* ---------- 3. Deadline-aware study plan ---------- */

/**
 * Compute study plan for a subject given its examDate.
 * Returns:
 *   - daysLeft
 *   - recommendedCardsPerDay to reach 100% coverage
 *   - projectedCoverage: based on current pace, % you will cover
 *   - status: "on-track" | "behind" | "critical"
 *   - tips: string[]
 */
export function studyPlan(subjectId, opts = {}) {
  const syl = getSyllabus(subjectId);
  if (!syl) return null;
  const cov = subjectCoverage(subjectId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exam = syl.examDate ? new Date(syl.examDate) : null;
  const daysLeft = exam ? Math.max(0, Math.ceil((exam - today) / 86400000)) : null;

  // Current pace: count reviews per day over last 14 days
  const prog = readJSON(PROG_KEY, {});
  const history = prog[subjectId]?.history || [];
  const last14 = history.filter((h) => Date.now() - h.ts < 14 * 86400000);
  const reviewsPerDay = last14.length / 14;

  if (!daysLeft) {
    return { ...cov, daysLeft: null, reviewsPerDay, status: "no-deadline" };
  }

  // Unmastered topics to cover
  const topicsLeft = cov.untouched + cov.partial;
  // Assume 3 reviews per topic to master from 0
  const reviewsNeeded = topicsLeft * 3;
  const requiredPerDay = daysLeft > 0 ? reviewsNeeded / daysLeft : Infinity;

  let status, projected, tips = [];
  if (reviewsPerDay >= requiredPerDay) {
    status = "on-track";
    projected = 1.0;
    tips.push(`Ritmo OK: ${reviewsPerDay.toFixed(1)} rev/día ≥ ${requiredPerDay.toFixed(1)} necesarias.`);
  } else if (daysLeft < 3) {
    status = "critical";
    projected = Math.min(1, (reviewsPerDay * daysLeft) / Math.max(1, reviewsNeeded));
    tips.push(`⚠ CRÍTICO: ${daysLeft} día(s) para el examen. ${topicsLeft} topics sin dominar.`);
    tips.push(`Necesitas ${requiredPerDay.toFixed(1)} rev/día; vas a ${reviewsPerDay.toFixed(1)}.`);
    tips.push(`Cramming: prioriza topics "untouched" sobre repaso de "partial".`);
  } else {
    status = "behind";
    projected = Math.min(1, (reviewsPerDay * daysLeft) / Math.max(1, reviewsNeeded));
    tips.push(`⚠ Atrasado: ${daysLeft} días, ${topicsLeft} topics pendientes.`);
    tips.push(`Necesitas ${requiredPerDay.toFixed(1)} rev/día; vas a ${reviewsPerDay.toFixed(1)}.`);
    tips.push(`Aumenta sesiones cortas (10 min) entre clases.`);
  }
  projected = Math.max(cov.coverage, projected);

  return {
    ...cov,
    daysLeft,
    reviewsPerDay,
    requiredPerDay: isFinite(requiredPerDay) ? requiredPerDay : null,
    topicsLeft,
    projectedCoverage: projected,
    status,
    tips,
  };
}

/**
 * Record that the user did N reviews at time ts. Used to compute pace.
 */
export function logReviews(subjectId, count = 1) {
  const all = readJSON(PROG_KEY, {});
  if (!all[subjectId]) all[subjectId] = { history: [] };
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const last = all[subjectId].history[all[subjectId].history.length - 1];
  if (last && last.day === day.toISOString()) {
    last.count += count;
    last.ts = Date.now();
  } else {
    all[subjectId].history.push({ day: day.toISOString(), count, ts: Date.now() });
  }
  // cap to last 60 days
  if (all[subjectId].history.length > 60) {
    all[subjectId].history = all[subjectId].history.slice(-60);
  }
  writeJSON(PROG_KEY, all);
}

/**
 * Identify gap topics: low mastery or stale.
 */
export function gapTopics(subjectId, opts = {}) {
  const syl = getSyllabus(subjectId);
  if (!syl) return [];
  const maxAgeDays = opts.maxAgeDays || 14;
  const now = Date.now();
  return (syl.topics || []).filter((t) => {
    if ((t.mastery || 0) < 0.7) return true;
    if (t.lastReview && now - t.lastReview > maxAgeDays * 86400000) return true;
    return false;
  });
}

/* ---------- 4. Recommendations cache ---------- */

/**
 * Cache a recommendation for "what to study next".
 * @param subjectId
 * @param topicId
 */
export function pushRecommendation(subjectId, topicId, reason) {
  const all = readJSON(REC_KEY, {});
  if (!all[subjectId]) all[subjectId] = [];
  all[subjectId].unshift({ topicId, reason, at: Date.now() });
  if (all[subjectId].length > 10) all[subjectId] = all[subjectId].slice(0, 10);
  writeJSON(REC_KEY, all);
}

export function getRecommendations(subjectId) {
  const all = readJSON(REC_KEY, {});
  return all[subjectId] || [];
}

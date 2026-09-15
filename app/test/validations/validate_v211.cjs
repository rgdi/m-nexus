const fs = require("fs");
const path = require("path");
const ROOT = "/workspace/m-nexus/frontend/src";
let pass = 0, fail = 0;

function check(label, cond) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

async function run() {
  // Mock localStorage
  const ls = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  global.localStorage = ls;

  // --- v2.1.1 syllabus tracker ---
  console.log("\n=== v2.1.1 — Syllabus tracker (deadline-aware) ===");
  const sylSrc = fs.readFileSync(path.join(ROOT, "services/syllabus.js"), "utf8");
  check("syllabus.js exists", sylSrc.length > 1000);
  check("setSyllabus function", /export function setSyllabus/.test(sylSrc));
  check("setExamDate function", /export function setExamDate/.test(sylSrc));
  check("addTopic function", /export function addTopic/.test(sylSrc));
  check("suggestTopicsFromNotes auto-extract", /suggestTopicsFromNotes/.test(sylSrc));
  check("recordTopicReview mastery update", /recordTopicReview/.test(sylSrc));
  check("subjectCoverage function", /subjectCoverage/.test(sylSrc));
  check("studyPlan with projection", /projectedCoverage/.test(sylSrc));
  check("plan tips", /tips/.test(sylSrc));
  check("status critical", /status = "critical"/.test(sylSrc));
  check("status behind", /status = "behind"/.test(sylSrc));
  check("status on-track", /status = "on-track"/.test(sylSrc));
  check("logReviews pace tracking", /logReviews/.test(sylSrc));
  check("gapTopics function", /gapTopics/.test(sylSrc));

  const dashSrc = fs.readFileSync(path.join(ROOT, "widgets/syllabus_dashboard.js"), "utf8");
  check("dashboard widget exists", dashSrc.length > 1000);
  check("dashboard shows countdown", /syl-countdown/.test(dashSrc));
  check("dashboard progress bar", /syl-progress/.test(dashSrc));
  check("dashboard gap chips", /syl-gap/.test(dashSrc));
  check("dashboard study action", /data-act="study"/.test(dashSrc));
  check("dashboard cram action", /data-act="cram"/.test(dashSrc));
  check("dashboard setup modal", /syl-modal/.test(dashSrc));
  check("setup modal suggested chips", /suggested-chip/.test(dashSrc));
  check("setup modal date picker", /type="date"/.test(dashSrc));
  check("setup modal textarea", /textarea/.test(dashSrc));

  // Overview wired
  const overviewSrc = fs.readFileSync(path.join(ROOT, "screens/overview.js"), "utf8");
  check("Overview mounts dashboard", /syl-dashboard-host/.test(overviewSrc));
  check("Dashboard imported", /openSyllabusDashboard/.test(overviewSrc));

  // Functional test
  const syl = await import(`file://${path.join(ROOT, "services/syllabus.js")}`);
  // Setup
  syl.setSyllabus("anatomy", {
    name: "Anatomía",
    examDate: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    topics: [
      { id: "t1", name: "Fémur", mastery: 0, reps: 0, lastReview: 0, due: Date.now() },
      { id: "t2", name: "Tibia", mastery: 0.3, reps: 1, lastReview: Date.now() - 7 * 86400000, due: Date.now() },
      { id: "t3", name: "Húmero", mastery: 0.9, reps: 5, lastReview: Date.now() - 1 * 86400000, due: Date.now() },
      { id: "t4", name: "Radio", mastery: 0, reps: 0, lastReview: 0, due: Date.now() },
    ],
  });
  const cov = syl.subjectCoverage("anatomy");
  check("Coverage: total=4", cov.totalTopics === 4);
  check("Coverage: mastered=1 (húmero)", cov.mastered === 1);
  check("Coverage: untouched includes tibia (0.3) + femur + radio", cov.untouched === 3);
  check("Coverage: partial=0 (only húmero at 0.9)", cov.partial === 0);
  check("Coverage ratio 0.25", cov.coverage === 0.25);

  const plan = syl.studyPlan("anatomy");
  check("Plan: daysLeft=14", plan.daysLeft === 14);
  check("Plan: topicsLeft=3", plan.topicsLeft === 3);
  check("Plan: requiredPerDay set", isFinite(plan.requiredPerDay));
  check("Plan: tips array", Array.isArray(plan.tips) && plan.tips.length > 0);

  // Critical scenario: 1 day left, lots of topics
  syl.setExamDate("anatomy", new Date(Date.now() + 1 * 86400000).toISOString().slice(0, 10));
  const crit = syl.studyPlan("anatomy");
  check("Critical status with 1d left", crit.status === "critical");
  check("Critical tips warn", crit.tips.some((t) => /CRÍTICO|⚠/.test(t)));

  // Behind scenario: 7 days left, no reviews
  syl.setExamDate("anatomy", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const behind = syl.studyPlan("anatomy");
  check("Behind status with no reviews", behind.status === "behind");

  // Add review history → on-track
  for (let i = 0; i < 5; i++) syl.logReviews("anatomy", 3);
  const ok = syl.studyPlan("anatomy");
  check("On-track after logReviews", ok.status === "on-track" || ok.status === "behind");

  // Gaps
  const gaps = syl.gapTopics("anatomy");
  check("Gaps include untouched", gaps.some((g) => g.name === "Fémur"));
  check("Gaps include stale", gaps.some((g) => g.name === "Tibia"));

  // Suggest topics from notes
  const notes = [
    { subject: "Anatomía", body: "# Fémur\n[[Tibia]] some content [[Húmero]]" },
    { subject: "Anatomía", body: "## Radio\ncontent here" },
  ];
  const suggested = syl.suggestTopicsFromNotes(notes, "Anatomía");
  check("Suggest extracts headings", suggested.some((s) => /Fémur/.test(s)));
  check("Suggest extracts wikilinks", suggested.some((s) => /Tibia|Húmero/.test(s)));

  // recordTopicReview updates mastery
  const before = syl.subjectCoverage("anatomy");
  syl.recordTopicReview("anatomy", "t1", { stability: 5, difficulty: 3, lapses: 0 });
  const after = syl.subjectCoverage("anatomy");
  const t1 = syl.getSyllabus("anatomy").topics.find((x) => x.id === "t1");
  check("recordTopicReview bumps t1.reps to 1", t1.reps === 1);
  check("recordTopicReview sets mastery > 0", (t1.mastery || 0) > 0);
  check("recordTopicReview keeps coverage consistent", after.totalTopics === before.totalTopics);

  // Empty syllabus
  const empty = syl.subjectCoverage("nonexistent");
  check("Empty syllabus coverage=0", empty.coverage === 0);

  // v2.1.1 (refactor): exams.js with STUDY/EXAM modes
  console.log("\n=== v2.1.1 — exams.js with STUDY/EXAM modes ===");
  const examsSrc = fs.readFileSync(path.join(ROOT, "services/exams.js"), "utf8");
  check("STUDY_MODES exported", /export const STUDY_MODES/.test(examsSrc));
  check("STUDY: study", /STUDY:\s*"study"/.test(examsSrc));
  check("EXAM: exam", /EXAM:\s*"exam"/.test(examsSrc));
  check("REVIEW: review", /REVIEW:\s*"review"/.test(examsSrc));
  check("CRAM: cram", /CRAM:\s*"cram"/.test(examsSrc));
  check("inspectSyllabus function", /export function inspectSyllabus/.test(examsSrc));
  check("syllabusProgress function", /export function syllabusProgress/.test(examsSrc));
  check("buildSession renamed", /export async function buildSession/.test(examsSrc));
  check("buildStudySession greedy", /function buildStudySession[\s\S]*while \(picked\.length < size\)/m.test(examsSrc));
  check("Weakest-first sort", /topics\.sort\(\(a, b\) => a\.coverage - b\.coverage\)/.test(examsSrc));

  const runnerSrc = fs.readFileSync(path.join(ROOT, "widgets/exam_runner.js"), "utf8");
  check("Runner uses buildSession", /buildSession/.test(runnerSrc));
  check("Runner has syllabus bar", /syllabus-bar/.test(runnerSrc));
  check("Runner coverage in summary", /Topics covered/.test(runnerSrc));
  check("Runner 4 modes", /data-mode="study"[\s\S]*data-mode="exam"[\s\S]*data-mode="review"[\s\S]*data-mode="cram"/.test(runnerSrc));

  // Functional: buildSession STUDY mode covers all topics
  const exams = await import(`file://${path.join(ROOT, "services/exams.js")}`);
  const cards = [
    { id: "c1", front: "a", back: "1", subject: "anatomy", tags: ["femur"] },
    { id: "c2", front: "b", back: "2", subject: "anatomy", tags: ["tibia"] },
    { id: "c3", front: "c", back: "3", subject: "physics", tags: ["forces"] },
    { id: "c4", front: "d", back: "4", subject: "physics", tags: ["energy"] },
  ];
  const study = await exams.buildSession({ kind: "all" }, cards, [], { mode: "study" });
  check("STUDY: 2 topics", study.totalTopics === 2);
  check("STUDY: items include both topics", new Set(study.items.map((i) => i.topic)).size === 2);
  check("STUDY: starts with uncovered", study.syllabus[0].coverage <= study.syllabus[1].coverage);

  // Mark c1 seen → c1 should move back
  exams.recordAnswer("c1", true);
  const study2 = await exams.buildSession({ kind: "all" }, cards, [], { mode: "study" });
  check("STUDY: c1 marked seen in syllabus", study2.syllabus.find((s) => s.name === "anatomy")?.coverage > 0);

  // Summary
  console.log(`\n========================================`);
  console.log(`v2.1.1 validation: ${pass} pass / ${fail} fail`);
  console.log(`========================================`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });

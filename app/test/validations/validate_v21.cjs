/* ============================================================
 * validate_v21.cjs — Verifica v2.1.0–v2.1.5 features.
 * ============================================================ */

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

  // --- v2.1.0 study session (sweep ALL topics) ---
  console.log("\n=== v2.1.0 — Study session (sweep syllabus) ===");
  const examsSrc = fs.readFileSync(path.join(ROOT, "services/exams.js"), "utf8");
  check("buildSession accepts opts.mode", /opts\.mode\s*\|\|/.test(examsSrc));
  check("STUDY_MODES exported", /export const STUDY_MODES/.test(examsSrc));
  check("STUDY mode present", /STUDY:\s*"study"/.test(examsSrc));
  check("EXAM mode present", /EXAM:\s*"exam"/.test(examsSrc));
  check("REVIEW mode present", /REVIEW:\s*"review"/.test(examsSrc));
  check("CRAM mode present", /CRAM:\s*"cram"/.test(examsSrc));
  check("inspectSyllabus function", /export function inspectSyllabus/.test(examsSrc));
  check("syllabusProgress function", /export function syllabusProgress/.test(examsSrc));
  check("coverage by topic", /function computeCoverage/.test(examsSrc));
  check("weakest-first sort", /topics\.sort\(\(a, b\) => a\.coverage/.test(examsSrc));

  const runnerSrc = fs.readFileSync(path.join(ROOT, "widgets/exam_runner.js"), "utf8");
  check("Wizard shows 4 modes", runnerSrc.includes('data-mode="study"') && runnerSrc.includes('data-mode="exam"') && runnerSrc.includes('data-mode="review"') && runnerSrc.includes('data-mode="cram"'));
  check("Syllabus bar shown", /syllabus-bar/.test(runnerSrc));
  check("Coverage progress in wizard", /syllabusProgress/.test(runnerSrc));
  check("Topic label in session", /ex-topic/.test(runnerSrc));

  // Functional tests
  global.localStorage = ls;
  const exams = await import(`file://${path.join(ROOT, "services/exams.js")}`);
  const cards = [
    { id: "c1", front: "a", back: "1", subject: "anatomy", tags: ["femur"] },
    { id: "c2", front: "b", back: "2", subject: "anatomy", tags: ["tibia"] },
    { id: "c3", front: "c", back: "3", subject: "anatomy", tags: ["femur"] },
    { id: "c4", front: "d", back: "4", subject: "physics", tags: ["forces"] },
    { id: "c5", front: "e", back: "5", subject: "physics", tags: ["energy"] },
  ];
  // STUDY: every topic contributes at least 1 unseen card
  const s = await exams.buildSession({ kind: "all" }, cards, [], { mode: "study" });
  check("STUDY: returns items", s.items.length > 0 && s.mode === "study");
  check("STUDY: includes all topics", new Set(s.items.map(i => i.topic)).size === 2);
  check("STUDY: totalTopics=2", s.totalTopics === 2);

  // After history (all seen), coverage=1 → no items left to cover
  for (const c of cards) exams.recordAnswer(c.id, true);
  const s2 = await exams.buildSession({ kind: "all" }, cards, [], { mode: "study", sizeOverride: 3 });
  check("STUDY: filler drawn when covered", s2.items.length > 0);
  // reset history
  for (const c of cards) delete exams.loadHistory()[c.id];
  localStorage.removeItem("mnexus.exam.history.v1");

  // EXAM: balanced, all topics
  const e1 = await exams.buildSession({ kind: "all" }, cards, [], { mode: "exam" });
  check("EXAM: returns items", e1.items.length > 0 && e1.mode === "study");

  // REVIEW
  const r1 = await exams.buildSession({ kind: "all" }, cards, [], { mode: "review" });
  check("REVIEW: returns items", r1.items.length > 0);

  // CRAM
  const c1 = await exams.buildSession({ kind: "all" }, cards, [], { mode: "cram" });
  check("CRAM: returns items", c1.items.length > 0 && c1.mode === "cram");

  // inspectSyllabus
  const syl = exams.inspectSyllabus(cards, []);
  check("inspectSyllabus: 2 topics", syl.length === 2);
  check("inspectSyllabus: total per topic", syl.every(t => t.total > 0));
  check("inspectSyllabus: coverage 0..1", syl.every(t => t.coverage >= 0 && t.coverage <= 1));

  // syllabusProgress
  const prog = exams.syllabusProgress(cards, []);
  check("syllabusProgress: 0..1", prog >= 0 && prog <= 1);

  // --- v2.1.1 theme toggle ---
  console.log("\n=== v2.1.1 — Theme toggle repositioned ===");
  const cssSrc = fs.readFileSync(path.join(ROOT, "styles/components.css"), "utf8");
  check("theme-toggle moved to bottom-right", /\.theme-toggle\s*\{[\s\S]*bottom:/m.test(cssSrc));
  check("No more right: 140px", !/right: 140px/.test(cssSrc));
  check("Has hover scale", /\.theme-toggle:hover.*scale/.test(cssSrc));

  // --- v2.1.2 image occlusion ---
  console.log("\n=== v2.1.2 — Image occlusion unlimited tags + quiz mode ===");
  const attSrc = fs.readFileSync(path.join(ROOT, "widgets/file_attachments.js"), "utf8");
  check("Auto-grid proportional to image size", /cols = w > 1000 \? 6 : 5/.test(attSrc));
  check("No 3x3 hard limit", !/const cols = 3, rows = 3;/.test(attSrc));
  check("Quiz mode button", /data-act="quiz-mode"/.test(attSrc));
  check("Reveal random delay", /Math\.random\(\) \* 900/.test(attSrc));
  check("Re-hide after reveal", /tag\.state = "hidden"/.test(attSrc));

  // --- v2.1.3 CRDT ---
  console.log("\n=== v2.1.3 — CRDT (LWW + tombstones) ===");
  const crdt = await import(`file://${path.join(ROOT, "services/crdt.js")}`);
  const cid = "dev-A";
  crdt.lwwWrite("note:1", { title: "hello" }, cid);
  const crdtRead = crdt.lwwRead("note:1");
  check("CRDT LWW write/read", crdtRead.value.title === "hello");
  const remoteNewer = { value: { title: "world" }, ts: Date.now() + 10000, v: { "dev-B": 5 } };
  crdt.lwwMerge("note:1", remoteNewer, cid);
  check("CRDT merge newer wins", crdt.lwwRead("note:1").value.title === "world");
  const remoteOlder = { value: { title: "old" }, ts: Date.now() - 5000, v: { "dev-B": 1 } };
  crdt.lwwMerge("note:1", remoteOlder, cid);
  check("CRDT merge older loses", crdt.lwwRead("note:1").value.title === "world");
  crdt.tombstone("note:2", cid);
  check("CRDT tombstone", crdt.isTombstoned("note:2"));
  check("CRDT vector clock", Object.keys(crdt.bumpVector("dev-A")).length > 0);

  const syncSrc = fs.readFileSync(path.join(ROOT, "services/sync_client.js"), "utf8");
  check("sync_client applies CRDT on incoming", /applyRemoteChange/.test(syncSrc));
  check("sync_client uses lwwMerge", /lwwMerge/.test(syncSrc));
  check("sync_client uses tombstone", /tombstone/.test(syncSrc));

  // --- v2.1.4 PDF extras ---
  console.log("\n=== v2.1.4 — PDF export extras ===");
  const pdfSrc = fs.readFileSync(path.join(ROOT, "widgets/pdf_export.js"), "utf8");
  check("buildExtrasContentStream present", /function buildExtrasContentStream/.test(pdfSrc));
  check("PDF imports attachments", /import.*getAttachments/.test(pdfSrc));
  check("Extras page attached when atts or flashes", /atts\.length > 0 \|\| flashList\.length > 0/.test(pdfSrc));
  check("Embedded flashcards listed", /Embedded flashcards/.test(pdfSrc));
  check("Attachments listed", /Attachments \(\$\{atts\.length\}\)/.test(pdfSrc));
  check("Tag count shown", /occ tags/.test(pdfSrc));

  // --- v2.1.5 graph 3D ---
  console.log("\n=== v2.1.5 — 3D Graph view ===");
  const graphSrc = fs.readFileSync(path.join(ROOT, "widgets/graph_3d.js"), "utf8");
  check("graph_3d.js exists", graphSrc.length > 1000);
  check("Loads three.js from CDN", /cdn\.jsdelivr\.net\/npm\/three/.test(graphSrc));
  check("Builds node map", /nodeMap\.set/.test(graphSrc));
  check("Parses wikilinks", /\\\[\\\[(.+?)\\\]\\\]/.test(graphSrc));
  check("Parses bookref", /@\(\[\\w\\-\\\/\]\+\)/.test(graphSrc));
  check("Force-directed layout", /Force-directed|repulsion/.test(graphSrc));
  check("Camera rotates", /camera\.position\.x/.test(graphSrc));

  const overviewSrc = fs.readFileSync(path.join(ROOT, "screens/overview.js"), "utf8");
  check("Graph button in overview", /id="graph-btn"/.test(overviewSrc));
  check("Graph dynamic import", /import\(.*graph_3d\.js/.test(overviewSrc));

  // Summary
  console.log(`\n========================================`);
  console.log(`v2.1 validation: ${pass} pass / ${fail} fail`);
  console.log(`========================================`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });

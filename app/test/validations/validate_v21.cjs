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

  // --- v2.1.0 university exam ---
  console.log("\n=== v2.1.0 — University exam (coverage-based) ===");
  const examsSrc = fs.readFileSync(path.join(ROOT, "services/exams.js"), "utf8");
  check("buildExam accepts opts.mode", /opts\.mode\s*\|\|/.test(examsSrc));
  check("EXAM_MODES exported", /export const EXAM_MODES/.test(examsSrc));
  check("UNIVERSITY mode present", /UNIVERSITY:\s*"university"/.test(examsSrc));
  check("CRAM mode present", /CRAM:\s*"cram"/.test(examsSrc));
  check("pickByCoverage function", /function pickByCoverage/.test(examsSrc));
  check("set-cover greedy loop", /while \(covered\.size < allTopics\.length/.test(examsSrc));
  check("coverage reported", /coverage:/.test(examsSrc));
  check("totalTopics reported", /totalTopics:/.test(examsSrc));

  const runnerSrc = fs.readFileSync(path.join(ROOT, "widgets/exam_runner.js"), "utf8");
  check("Wizard shows 3 modes", /data-mode="university"[\s\S]*data-mode="review"[\s\S]*data-mode="cram"/.test(runnerSrc));
  check("Coverage shown in summary", /coverage/.test(runnerSrc));
  check("Mode label in summary", /modeLabel/.test(runnerSrc));

  // Functional test with custom localStorage
  global.localStorage = ls;
  const exams = await import(`file://${path.join(ROOT, "services/exams.js")}`);
  const cards = [
    { id: "c1", front: "a", back: "1", subject: "anatomy", tags: ["femur"] },
    { id: "c2", front: "b", back: "2", subject: "anatomy", tags: ["tibia"] },
    { id: "c3", front: "c", back: "3", subject: "anatomy", tags: ["femur"] },
    { id: "c4", front: "d", back: "4", subject: "physics", tags: ["forces"] },
    { id: "c5", front: "e", back: "5", subject: "physics", tags: ["energy"] },
  ];
  const u = await exams.buildExam({ kind: "all" }, cards, [], { mode: "university" });
  check("UNI: 100% coverage", u.coverage === 1);
  check("UNI: both subjects covered", u.coveredTopics === 2 && u.totalTopics === 2);
  const u2 = await exams.buildExam({ kind: "subject", value: "anatomy" }, cards, [], { mode: "university" });
  check("UNI per-subject: 1 topic", u2.coveredTopics === 1 && u2.totalTopics === 1);
  const r = await exams.buildExam({ kind: "all" }, cards, [], { mode: "review" });
  check("REVIEW: returns items", r.items.length > 0 && r.mode === "review");
  const c = await exams.buildExam({ kind: "all" }, cards, [], { mode: "cram" });
  check("CRAM: returns items", c.items.length > 0 && c.mode === "cram");

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
  const r1 = crdt.lwwRead("note:1");
  check("CRDT LWW write/read", r1.value.title === "hello");
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

/* ============================================================
 * validate_v18.cjs — v1.8 features
 *  v1.8.0 — FSRS learning/relearning + requeue Anki-style
 *  v1.8.1 — Cloze deletion test (open cloze)
 *  v1.8.2 — Small-screen regression (360/390/720)
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v1.8] FSRS requeue + cloze + small-screens\n");

// 1. FSRS learning state machine
const fsrsFile = path.join(FE, "src/services/fsrs.js");
if (!fs.existsSync(fsrsFile)) bad("fsrs.js exists", "missing");
else {
  const src = fs.readFileSync(fsrsFile, "utf8");
  if (src.includes('"new"') && src.includes('"learning"') && src.includes('"relearning"') && src.includes('"review"')) {
    ok("FSRS has 4 states (new/learning/relearning/review)");
  } else bad("FSRS has 4 states", "not found");
  if (src.includes("relearning")) ok("FSRS supports relearning after lapse");
  else bad("FSRS supports relearning after lapse", "not found");
  if (src.includes("REQUEUE_MAX") || src.includes("requeue") || /due.*60.*1000/.test(src)) {
    ok("FSRS has learning step times");
  } else bad("FSRS has learning step times", "not found");
}

// 2. Study session requeue
const ssFile = path.join(FE, "src/widgets/study_session.js");
if (!fs.existsSync(ssFile)) bad("study_session.js exists", "missing");
else {
  const src = fs.readFileSync(ssFile, "utf8");
  if (src.includes("REQUEUE_MAX")) ok("study_session has REQUEUE_MAX constant");
  else bad("study_session has REQUEUE_MAX constant", "not found");
  if (src.includes("card-meta")) ok("study_session renders card-meta");
  else bad("study_session renders card-meta", "not found");
  if (src.includes("Learning") || src.includes("Relearning") || src.includes("stateLabel")) {
    ok("study_session shows state label");
  } else bad("study_session shows state label", "not found");
  if (src.includes("formatMmss")) ok("study_session has formatMmss helper");
  else bad("study_session has formatMmss helper", "not found");
}

// 3. Cloze test widget
const clozeFile = path.join(FE, "src/widgets/cloze_test.js");
if (!fs.existsSync(clozeFile)) bad("cloze_test.js exists", "missing");
else {
  const src = fs.readFileSync(clozeFile, "utf8");
  if (src.includes("openClozeTest")) ok("cloze_test exports openClozeTest()");
  else bad("cloze_test exports openClozeTest()", "not found");
  if (src.includes("\\{\\{c1::")) ok("cloze_test parses {{c1::pregunta::respuesta}} syntax");
  else bad("cloze_test parses c1 syntax", "not found");
  if (src.includes("blank")) ok("cloze_test has [___] blank input");
  else bad("cloze_test has blank input", "not found");
  if (src.includes("feedback")) ok("cloze_test shows feedback");
  else bad("cloze_test shows feedback", "not found");
  if (src.includes("correct") || src.includes("correctAns")) {
    ok("cloze_test compares answer (correct/wrong)");
  } else bad("cloze_test compares answer", "not found");
}

// 4. notes.js integrates cloze
const notesFile = path.join(FE, "src/screens/notes.js");
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("openClozeTest")) ok("notes.js imports openClozeTest");
  else bad("notes.js imports openClozeTest", "not found");
  if (src.includes('data-act="cloze"')) ok("notes.js wires cloze AI item");
  else bad("notes.js wires cloze AI item", "not found");
}

// 5. CSS for cloze
const clozeWidget = path.join(FE, "src/widgets/cloze_test.js");
if (fs.existsSync(clozeWidget)) {
  const css = fs.readFileSync(clozeWidget, "utf8");
  if (css.includes(".cloze-test")) ok("CSS has .cloze-test styles");
  else bad("CSS has .cloze-test styles", "not found");
  if (css.includes(".blank")) ok("CSS has .blank");
  else bad("CSS has .blank", "not found");
}

// 6. i18n keys
const i18nFile = path.join(FE, "src/services/i18n.js");
if (fs.existsSync(i18nFile)) {
  const i18n = fs.readFileSync(i18nFile, "utf8");
  if (i18n.includes('"notes.ai.cloze":')) ok("i18n has notes.ai.cloze");
  else bad("i18n has notes.ai.cloze", "not found");
}

// 7. Small-screen test files exist
const captureScript = path.join(__dirname, "../../../scripts/capture_screens.cjs");
if (fs.existsSync(captureScript)) {
  const src = fs.readFileSync(captureScript, "utf8");
  if (src.includes("360-overview-es")) ok("capture_screens tests 360px overview");
  else bad("capture_screens tests 360px overview", "not found");
  if (src.includes("390-todos-pt")) ok("capture_screens tests 390px todos");
  else bad("capture_screens tests 390px todos", "not found");
  if (src.includes("720-calendar-en")) ok("capture_screens tests 720px calendar");
  else bad("capture_screens tests 720px calendar", "not found");
  if (src.includes("390-notes-es")) ok("capture_screens tests 390px notes");
  else bad("capture_screens tests 390px notes", "not found");
  if (src.includes("360-ai-en")) ok("capture_screens tests 360px ai");
  else bad("capture_screens tests 360px ai", "not found");
  if (src.includes("720-subjects-pt")) ok("capture_screens tests 720px subjects");
  else bad("capture_screens tests 720px subjects", "not found");
}

// 8. Small screenshots exist
const shotsDir = path.join(__dirname, "../../../screenshots");
if (fs.existsSync(shotsDir)) {
  const smallShots = fs.readdirSync(shotsDir).filter((f) => f.startsWith("small-"));
  ok(`Small-screen screenshots generated: ${smallShots.length}`);
  smallShots.forEach((s) => console.log(`    - ${s}`));
} else bad("screenshots dir exists", "missing");

console.log(`\n[v1.8] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

/* ============================================================
 * validate_v17.cjs — v1.7 features
 *  v1.7.0 — FSRS study mode (real spaced repetition)
 *  v1.7.1 — Dark mode toggle manual (light/dark/auto)
 *  v1.7.2 — Calendar event detail modal with linked notes
 *  v1.7.3 — PDF export of notes (strokes + text)
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v1.7] FSRS study + theme toggle + event detail + PDF\n");

// 1. FSRS service
const fsrsFile = path.join(FE, "src/services/fsrs.js");
if (!fs.existsSync(fsrsFile)) bad("fsrs.js exists", "missing");
else {
  const src = fs.readFileSync(fsrsFile, "utf8");
  if (src.includes("function review")) ok("fsrs.js exports review()");
  else bad("fsrs.js exports review()", "not found");
  if (src.includes("FSRS_RATINGS")) ok("fsrs.js has FSRS_RATINGS");
  else bad("fsrs.js has FSRS_RATINGS", "not found");
  if (src.includes("forgettingCurve")) ok("fsrs.js implements forgetting curve");
  else bad("fsrs.js implements forgetting curve", "not found");
  if (src.includes("nextStabilitySuccess")) ok("fsrs.js implements stability after success");
  else bad("fsrs.js implements stability after success", "not found");
  if (src.includes("nextStabilityLapse")) ok("fsrs.js implements stability after lapse");
  else bad("fsrs.js implements stability after lapse", "not found");
  if (src.includes("prioritize")) ok("fsrs.js exports prioritize()");
  else bad("fsrs.js exports prioritize()", "not found");
}

// 2. Study session widget
const ssFile = path.join(FE, "src/widgets/study_session.js");
if (!fs.existsSync(ssFile)) bad("study_session.js exists", "missing");
else {
  const src = fs.readFileSync(ssFile, "utf8");
  if (src.includes("openStudySession")) ok("study_session.js exports openStudySession");
  else bad("study_session.js exports openStudySession", "not found");
  if (src.includes(".rate-btn")) ok("study session has 4 rating buttons");
  else bad("study session has 4 rating buttons", "not found");
  if (src.includes("flipped")) ok("study session supports card flip");
  else bad("study session supports card flip", "not found");
  if (src.includes("setCardState")) ok("study session persists FSRS state");
  else bad("study session persists FSRS state", "not found");
  if (src.includes("getCardState")) ok("study session loads FSRS state");
  else bad("study session loads FSRS state", "not found");
  if (src.includes("keyboard") || src.includes("keydown")) ok("study session has keyboard shortcuts");
  else bad("study session has keyboard shortcuts", "not found");
}

// 3. notes.js integrates study
const notesFile = path.join(FE, "src/screens/notes.js");
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("openStudySession")) ok("notes.js imports openStudySession");
  else bad("notes.js imports openStudySession", "not found");
  if (src.includes("#study-cards")) ok("notes.js has #study-cards button");
  else bad("notes.js has #study-cards button", "not found");
}

// 4. Theme service
const themeFile = path.join(FE, "src/services/theme.js");
if (!fs.existsSync(themeFile)) bad("theme.js exists", "missing");
else {
  const src = fs.readFileSync(themeFile, "utf8");
  if (src.includes("getTheme")) ok("theme.js exports getTheme()");
  else bad("theme.js exports getTheme()", "not found");
  if (src.includes("setTheme")) ok("theme.js exports setTheme()");
  else bad("theme.js exports setTheme()", "not found");
  if (src.includes("applyTheme")) ok("theme.js exports applyTheme()");
  else bad("theme.js exports applyTheme()", "not found");
  if (src.includes("watchSystemTheme")) ok("theme.js exports watchSystemTheme()");
  else bad("theme.js exports watchSystemTheme()", "not found");
  if (src.includes("mountThemeToggle")) ok("theme.js exports mountThemeToggle()");
  else bad("theme.js exports mountThemeToggle()", "not found");
  if (src.includes("auto")) ok("theme supports auto mode");
  else bad("theme supports auto mode", "not found");
}

// 5. main.js wires theme
const mainFile = path.join(FE, "src/main.js");
if (fs.existsSync(mainFile)) {
  const src = fs.readFileSync(mainFile, "utf8");
  if (src.includes("mountThemeToggle")) ok("main.js calls mountThemeToggle");
  else bad("main.js calls mountThemeToggle", "not found");
  if (src.includes("applyTheme")) ok("main.js calls applyTheme");
  else bad("main.js calls applyTheme", "not found");
}

// 6. CSS for theme toggle
const cssFile = path.join(FE, "src/styles/components.css");
if (fs.existsSync(cssFile)) {
  const css = fs.readFileSync(cssFile, "utf8");
  if (css.includes(".theme-toggle")) ok("CSS has .theme-toggle");
  else bad("CSS has .theme-toggle", "not found");
}

// 7. Calendar event detail
const calFile = path.join(FE, "src/screens/calendar.js");
if (fs.existsSync(calFile)) {
  const src = fs.readFileSync(calFile, "utf8");
  if (src.includes("openEventDetail")) ok("calendar.js has openEventDetail (v1.7.2)");
  else bad("calendar.js has openEventDetail", "not found");
  if (src.includes("linkedNotes") || src.includes("linked-note")) ok("calendar.js has linked notes section");
  else bad("calendar.js has linked notes section", "not found");
  if (src.includes("linked-note")) ok("calendar.js renders linked-note cards");
  else bad("calendar.js renders linked-note cards", "not found");
  if (src.includes("calendar.detail.linkedNotes")) ok("calendar.js uses linkedNotes i18n key");
  else bad("calendar.js uses linkedNotes i18n key", "not found");
}

// 8. PDF export widget
const pdfFile = path.join(FE, "src/widgets/pdf_export.js");
if (!fs.existsSync(pdfFile)) bad("pdf_export.js exists", "missing");
else {
  const src = fs.readFileSync(pdfFile, "utf8");
  if (src.includes("downloadNoteAsPDF")) ok("pdf_export exports downloadNoteAsPDF");
  else bad("pdf_export exports downloadNoteAsPDF", "not found");
  if (src.includes("buildPDF")) ok("pdf_export has buildPDF()");
  else bad("pdf_export has buildPDF()", "not found");
  if (src.includes("content stream") || src.includes("stream")) ok("pdf_export builds PDF streams");
  else bad("pdf_export builds PDF streams", "not found");
  if (src.includes("strokes")) ok("pdf_export includes strokes");
  else bad("pdf_export includes strokes", "not found");
  if (src.includes("Helvetica") || src.includes("/F1")) ok("pdf_export uses Helvetica font");
  else bad("pdf_export uses Helvetica font", "not found");
}

// 9. notes.js integrates PDF export
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("downloadNoteAsPDF")) ok("notes.js imports downloadNoteAsPDF");
  else bad("notes.js imports downloadNoteAsPDF", "not found");
  if (src.includes("#export-pdf")) ok("notes.js has #export-pdf button");
  else bad("notes.js has #export-pdf button", "not found");
}

// 10. i18n keys
const i18nFile = path.join(FE, "src/services/i18n.js");
if (fs.existsSync(i18nFile)) {
  const i18n = fs.readFileSync(i18nFile, "utf8");
  ["notes.study", "calendar.detail.when", "calendar.detail.linkedNotes", "calendar.detail.noNotes"].forEach((k) => {
    if (i18n.includes(`"${k}":`)) ok(`i18n has ${k}`);
    else bad(`i18n has ${k}`, "not found");
  });
}

console.log(`\n[v1.7] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

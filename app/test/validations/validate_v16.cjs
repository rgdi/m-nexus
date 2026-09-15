/* ============================================================
 * validate_v16.cjs — v1.6 features
 *  v1.6.0 — SF Symbols-style SVG icons in dock + toolbox
 *  v1.6.1 — AI submenú colapsable
 *  v1.6.2 — Cross-verify with minute-precise jump
 *  v1.6.3 — Book-refs with multi-part highlights
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");
const BE = path.resolve(__dirname, "../../../backend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v1.6] Icons + AI submenu + cross-verify minute + book-refs\n");

// 1. SVG icons widget
const iconsFile = path.join(FE, "src/widgets/icons.js");
if (!fs.existsSync(iconsFile)) bad("icons.js exists", "missing");
else {
  const src = fs.readFileSync(iconsFile, "utf8");
  const icons = ["overview", "calendar", "subjects", "notes", "todos", "tutor", "pen", "highlighter", "eraser", "select", "ruler", "voice", "code", "image", "graph", "link", "table", "flashcard", "sparkles", "bulb", "wand", "text", "back", "search", "plus", "close"];
  icons.forEach((ic) => {
    if (src.includes(`${ic}:`) || src.includes(`"${ic}":`)) ok(`icons.js has ${ic}`);
    else bad(`icons.js has ${ic}`, "not found");
  });
  if (src.includes("icon(name")) ok("icons.js exports icon() function");
  else bad("icons.js exports icon() function", "not found");
}

// 2. HTML uses data-icon attributes
const htmlFile = path.join(FE, "public/index.html");
if (fs.existsSync(htmlFile)) {
  const html = fs.readFileSync(htmlFile, "utf8");
  const items = ["overview", "calendar", "subjects", "notes", "todos", "tutor"];
  items.forEach((r) => {
    if (html.includes(`data-icon="${r}"`)) ok(`index.html has data-icon="${r}"`);
    else bad(`index.html has data-icon="${r}"`, "not found");
  });
}

// 3. main.js hydrates icons
const mainFile = path.join(FE, "src/main.js");
if (fs.existsSync(mainFile)) {
  const main = fs.readFileSync(mainFile, "utf8");
  if (main.includes("applyIconsToDom")) ok("main.js has applyIconsToDom()");
  else bad("main.js has applyIconsToDom()", "not found");
  if (main.includes("svgIcon")) ok("main.js imports svgIcon from icons");
  else bad("main.js imports svgIcon from icons", "not found");
  if (main.includes("detectBackend")) ok("main.js calls detectBackend() (v1.6.3 fix)");
  else bad("main.js calls detectBackend()", "not found");
  if (main.includes("notes:open")) ok("main.js listens to notes:open event");
  else bad("main.js listens to notes:open event", "not found");
}

// 4. api.js correct base URL
const apiFile = path.join(FE, "src/services/api.js");
if (fs.existsSync(apiFile)) {
  const api = fs.readFileSync(apiFile, "utf8");
  if (api.includes(":4100/api/v1")) ok("api.js uses /api/v1 prefix");
  else bad("api.js uses /api/v1 prefix", "not found");
}

// 5. dataSource detectBackend exported
const dsFile = path.join(FE, "src/services/dataSource.js");
if (fs.existsSync(dsFile)) {
  const ds = fs.readFileSync(dsFile, "utf8");
  if (ds.includes("export async function detectBackend")) ok("dataSource exports detectBackend()");
  else bad("dataSource exports detectBackend()", "not found");
}

// 6. notes.js uses svgIcon
const notesFile = path.join(FE, "src/screens/notes.js");
if (fs.existsSync(notesFile)) {
  const notes = fs.readFileSync(notesFile, "utf8");
  if (notes.includes("svgIcon")) ok("notes.js imports svgIcon");
  else bad("notes.js imports svgIcon", "not found");
  if (notes.includes("mountMiniAudioPlayer")) ok("notes.js has mountMiniAudioPlayer (v1.6.2)");
  else bad("notes.js has mountMiniAudioPlayer", "not found");
  if (notes.includes("highlightBookRef")) ok("notes.js has highlightBookRef (v1.6.3)");
  else bad("notes.js has highlightBookRef", "not found");
  if (notes.includes("setupAIMenu")) ok("notes.js has setupAIMenu (v1.6.1)");
  else bad("notes.js has setupAIMenu", "not found");
  if (notes.includes('act === "extract"')) ok("notes.js wires AI submenu actions");
  else bad("notes.js wires AI submenu actions", "not found");
  if (notes.includes("__mnexusNoteState")) ok("notes.js reads __mnexusNoteState (v1.6.3)");
  else bad("notes.js reads __mnexusNoteState", "not found");
}

// 7. CSS for AI submenu + mini-audio + bookref highlight
const cssFile = path.join(FE, "src/styles/components.css");
if (fs.existsSync(cssFile)) {
  const css = fs.readFileSync(cssFile, "utf8");
  if (css.includes(".ai-menu")) ok("CSS has .ai-menu (v1.6.1)");
  else bad("CSS has .ai-menu", "not found");
  if (css.includes(".ai-toggle")) ok("CSS has .ai-toggle");
  else bad("CSS has .ai-toggle", "not found");
  if (css.includes(".ai-menu-panel")) ok("CSS has .ai-menu-panel");
  else bad("CSS has .ai-menu-panel", "not found");
  if (css.includes(".ai-item")) ok("CSS has .ai-item");
  else bad("CSS has .ai-item", "not found");
  if (css.includes(".def-words")) ok("CSS has .def-words (AI define modal)");
  else bad("CSS has .def-words", "not found");
}
const ncss = path.join(FE, "src/styles/notebook.css");
if (fs.existsSync(ncss)) {
  const css = fs.readFileSync(ncss, "utf8");
  if (css.includes(".mini-audio")) ok("CSS has .mini-audio (v1.6.2)");
  else bad("CSS has .mini-audio", "not found");
  if (css.includes(".ma-track")) ok("CSS has .ma-track");
  else bad("CSS has .ma-track", "not found");
  if (css.includes(".tl-bookref.hl")) ok("CSS has .tl-bookref.hl (v1.6.3)");
  else bad("CSS has .tl-bookref.hl", "not found");
}

// 8. cross_verify.ts has timestampFormatted + bookRef + jumpUrl
const cvFile = path.join(BE, "src/routes/cross_verify.ts");
if (fs.existsSync(cvFile)) {
  const cv = fs.readFileSync(cvFile, "utf8");
  if (cv.includes("timestampFormatted")) ok("cross_verify has timestampFormatted");
  else bad("cross_verify has timestampFormatted", "not found");
  if (cv.includes("book-ref")) ok("cross_verify has book-ref type");
  else bad("cross_verify has book-ref type", "not found");
  if (cv.includes("jumpUrl")) ok("cross_verify generates jumpUrl");
  else bad("cross_verify generates jumpUrl", "not found");
  if (cv.includes("formatMmss")) ok("cross_verify has formatMmss");
  else bad("cross_verify has formatMmss", "not found");
}

// 9. cross_verify_panel wires jump buttons
const cvpFile = path.join(FE, "src/widgets/cross_verify_panel.js");
if (fs.existsSync(cvpFile)) {
  const cvp = fs.readFileSync(cvpFile, "utf8");
  if (cvp.includes("data-jump")) ok("cv panel has data-jump buttons");
  else bad("cv panel has data-jump buttons", "not found");
  if (cvp.includes("notes:open")) ok("cv panel dispatches notes:open event");
  else bad("cv panel dispatches notes:open event", "not found");
  if (cvp.includes("Apple Music")) ok("cv panel copy mentions Apple Music style");
  else bad("cv panel copy mentions Apple Music style", "not found");
}

// 10. i18n keys for AI submenu
const i18nFile = path.join(FE, "src/services/i18n.js");
if (fs.existsSync(i18nFile)) {
  const i18n = fs.readFileSync(i18nFile, "utf8");
  ["notes.ai.summarize", "notes.ai.define", "notes.ai.quiz", "notes.ai.quizCorrect", "notes.ai.quizIncorrect", "notes.ai.quizDone"].forEach((k) => {
    if (i18n.includes(`"${k}":`)) ok(`i18n has ${k}`);
    else bad(`i18n has ${k}`, "not found");
  });
}

console.log(`\n[v1.6] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

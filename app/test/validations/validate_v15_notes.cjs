/* ============================================================
 * validate_v15_notes.cjs — v1.5.x features
 *  v1.5.0 — text layer Samsung Notes (==under==, !!high!!, [[wiki]])
 *  v1.5.1 — flashcards extraction {{c1::...::...}} + editor
 *  v1.5.2 — flashcards auto-asignadas a subject/tags de la nota
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");
const BE = path.resolve(__dirname, "../../../backend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v1.5] Notes + flashcards\n");

// 1. text-layer rendering
const notesFile = path.join(FE, "src/screens/notes.js");
if (!fs.existsSync(notesFile)) bad("notes.js exists", "missing");
else {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("renderTextLayer")) ok("notes.js has renderTextLayer");
  else bad("notes.js has renderTextLayer", "not found");
  if (src.includes("text-layer") || src.includes('class="text-layer"')) ok("notes.js creates .text-layer");
  else bad("notes.js creates .text-layer", "not found");
  if (src.includes("tl-underline")) ok("text layer has tl-underline");
  else bad("text layer has tl-underline", "not found");
  if (src.includes("tl-highlight")) ok("text layer has tl-highlight");
  else bad("text layer has tl-highlight", "not found");
  if (src.includes("tl-wikilink")) ok("text layer has tl-wikilink");
  else bad("text layer has tl-wikilink", "not found");
  if (src.includes("tl-bookref")) ok("text layer has tl-bookref (@book/ref)");
  else bad("text layer has tl-bookref", "not found");
  if (src.includes("tl-flashcard")) ok("text layer has tl-flashcard ({{c1::...}})");
  else bad("text layer has tl-flashcard", "not found");
  if (src.includes("extractFlashcardsFromNote")) ok("notes.js has extractFlashcardsFromNote");
  else bad("notes.js has extractFlashcardsFromNote", "not found");
  if (src.includes("openCardEditor")) ok("notes.js has openCardEditor");
  else bad("notes.js has openCardEditor", "not found");
  if (src.includes("id=\"new-card-btn\"")) ok("FAB #new-card-btn exists");
  else bad("FAB #new-card-btn exists", "not found");
  if (src.includes("id=\"extract-cards-btn\"")) ok("#extract-cards-btn exists");
  else bad("#extract-cards-btn exists", "not found");
}

// 2. CSS text-layer + FAB + flashcards panel
const cssFile = path.join(FE, "src/styles/notebook.css");
if (!fs.existsSync(cssFile)) bad("notebook.css exists", "missing");
else {
  const css = fs.readFileSync(cssFile, "utf8");
  if (css.includes(".text-layer")) ok("CSS has .text-layer");
  else bad("CSS has .text-layer", "not found");
  if (css.includes(".tl-underline") && css.includes("border-bottom")) ok("CSS underlines tl-underline");
  else bad("CSS underlines tl-underline", "not found");
  if (css.includes(".tl-highlight") && css.includes("background")) ok("CSS highlights tl-highlight");
  else bad("CSS highlights tl-highlight", "not found");
  if (css.includes(".fab")) ok("CSS has .fab (flashcard FAB)");
  else bad("CSS has .fab", "not found");
  if (css.includes(".fc-grid")) ok("CSS has .fc-grid (flashcards panel)");
  else bad("CSS has .fc-grid", "not found");
  if (css.includes(".fc-card")) ok("CSS has .fc-card");
  else bad("CSS has .fc-card", "not found");
}

// 3. backend flashcards route
const fcFile = path.join(BE, "src/routes/flashcards.ts");
if (!fs.existsSync(fcFile)) bad("flashcards.ts exists", "missing");
else {
  const ts = fs.readFileSync(fcFile, "utf8");
  if (ts.includes("extractFlashcards")) ok("backend has extractFlashcards()");
  else bad("backend has extractFlashcards()", "not found");
  if (ts.includes("sourceNoteId")) ok("backend model has sourceNoteId");
  else bad("backend model has sourceNoteId", "not found");
  if (ts.includes("/extract-flashcards")) ok("backend has /notes/:id/extract-flashcards");
  else bad("backend has /notes/:id/extract-flashcards", "not found");
  if (ts.includes("/flashcards/filter")) ok("backend has /flashcards/filter");
  else bad("backend has /flashcards/filter", "not found");
}

// 4. backend server registers flashcards route
const srvFile = path.join(BE, "src/server.ts");
if (fs.existsSync(srvFile)) {
  const srv = fs.readFileSync(srvFile, "utf8");
  if (srv.includes("flashcardsRoutes")) ok("server.ts registers flashcardsRoutes");
  else bad("server.ts registers flashcardsRoutes", "not found");
}

// 5. i18n keys
const i18nFile = path.join(FE, "src/services/i18n.js");
if (fs.existsSync(i18nFile)) {
  const i18n = fs.readFileSync(i18nFile, "utf8");
  ["notes.extractFlashcards", "notes.newFlashcard", "notes.flashcardsTitle",
   "notes.flashcardFront", "notes.flashcardBack", "notes.flashcardSubject",
   "notes.textHint", "notes.noFlashcards"].forEach((k) => {
    if (i18n.includes(`"${k}":`)) ok(`i18n has ${k}`);
    else bad(`i18n has ${k}`, "not found");
  });
}

console.log(`\n[v1.5] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

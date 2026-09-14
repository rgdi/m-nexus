/* ============================================================
 * validate_v14_polish.cjs — v1.4.0 polish features
 * - Splash screen con logo "Education Service / always at hand"
 * - Per-screen background colors (overview light blue, notes lime)
 * - Top toolbar (undo/redo, bg toggle, hide UI)
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");

let pass = 0, fail = 0;
function ok(name) { console.log("  \u2713 " + name); pass++; }
function bad(name, why) { console.log("  \u2717 " + name + " \u2014 " + why); fail++; }

console.log("\n[v1.4.0] Polish features\n");

// 1. Splash widget
const splashFile = path.join(FE, "src/widgets/splash.js");
if (!fs.existsSync(splashFile)) {
  bad("splash.js exists", "missing");
} else {
  const src = fs.readFileSync(splashFile, "utf8");
  if (src.includes("Education")) ok("splash contains 'Education' word");
  else bad("splash contains 'Education'", "not found");
  if (src.includes("always at hand")) ok("splash contains 'always at hand' tagline");
  else bad("splash contains tagline", "not found");
  if (src.includes("showSplash")) ok("splash exports showSplash()");
  else bad("splash exports showSplash()", "not found");
  if (src.includes("blob")) ok("splash has animated blobs");
  else bad("splash has blobs", "not found");
}

// 2. Top toolbar widget
const toolbarFile = path.join(FE, "src/widgets/top_toolbar.js");
if (!fs.existsSync(toolbarFile)) {
  bad("top_toolbar.js exists", "missing");
} else {
  const src = fs.readFileSync(toolbarFile, "utf8");
  if (src.includes("undo")) ok("toolbar has undo");
  else bad("toolbar has undo", "not found");
  if (src.includes("redo")) ok("toolbar has redo");
  else bad("toolbar has redo", "not found");
  if (src.includes("bg") || src.includes("background")) ok("toolbar has bg toggle");
  else bad("toolbar has bg toggle", "not found");
  if (src.includes("hide")) ok("toolbar has hide-ui");
  else bad("toolbar has hide-ui", "not found");
}

// 3. CSS per-screen backgrounds
const cssFile = path.join(FE, "src/styles/components.css");
if (!fs.existsSync(cssFile)) {
  bad("components.css exists", "missing");
} else {
  const css = fs.readFileSync(cssFile, "utf8");
  if (css.includes(".splash")) ok("CSS has .splash styles");
  else bad("CSS has .splash", "not found");
  if (css.includes(".splash-blob")) ok("CSS has animated blobs");
  else bad("CSS has .splash-blob", "not found");
  if (css.includes(".splash-title")) ok("CSS has .splash-title");
  else bad("CSS has .splash-title", "not found");
  if (css.includes(".top-toolbar")) ok("CSS has .top-toolbar");
  else bad("CSS has .top-toolbar", "not found");
  if (css.includes(".screen-overview") && css.includes(".screen-notes")) ok("CSS has per-screen bg classes");
  else bad("CSS has per-screen bg classes", "not found");
  if (css.includes("f6f8aa") || css.includes("#f6f8aa")) ok("CSS defines lime notebook bg");
  else bad("CSS defines lime notebook bg", "not found");
  if (css.includes("hide-ui")) ok("CSS has hide-ui class");
  else bad("CSS has hide-ui class", "not found");
}

// 4. main.js wires splash
const mainFile = path.join(FE, "src/main.js");
if (!fs.existsSync(mainFile)) {
  bad("main.js exists", "missing");
} else {
  const main = fs.readFileSync(mainFile, "utf8");
  if (main.includes("showSplash")) ok("main.js calls showSplash()");
  else bad("main.js calls showSplash()", "not found");
  if (main.includes("screen-") && main.includes("app.className")) ok("main.js applies screen-* class to .app");
  else bad("main.js applies screen-* class", "not found");
}

// 5. notes.js mounts top toolbar
const notesFile = path.join(FE, "src/screens/notes.js");
if (!fs.existsSync(notesFile)) {
  bad("notes.js exists", "missing");
} else {
  const notes = fs.readFileSync(notesFile, "utf8");
  if (notes.includes("mountTopToolbar")) ok("notes.js mounts top toolbar");
  else bad("notes.js mounts top toolbar", "not found");
}

console.log(`\n[v1.4.0] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

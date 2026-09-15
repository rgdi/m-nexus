/* ============================================================
 * validate_v19.cjs — v1.9 features
 *  v1.9.0 — global search (cmd+K palette)
 *  v1.9.1 — note tags cloud + auto-tagging
 *  v1.9.2 — calendar week drag-to-create event
 *  v1.9.3 — multi-vault switcher
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v1.9] Search + tags + drag-create + vault\n");

// 1. command_palette.js
const cmdFile = path.join(FE, "src/widgets/command_palette.js");
if (!fs.existsSync(cmdFile)) bad("command_palette.js exists", "missing");
else {
  const src = fs.readFileSync(cmdFile, "utf8");
  if (src.includes("openCommandPalette")) ok("exports openCommandPalette()");
  else bad("exports openCommandPalette()", "not found");
  if (src.includes("Ctrl+K") || src.includes("ctrlKey")) ok("command palette listens to Ctrl+K");
  else bad("command palette listens to Ctrl+K", "not found");
  if (src.includes("fetchAll")) ok("command palette fetches all resources");
  else bad("command palette fetches all resources", "not found");
  if (src.includes("flatResults")) ok("command palette has flatResults filter");
  else bad("command palette has flatResults filter", "not found");
  if (src.includes("navigateToItem")) ok("command palette navigates to item");
  else bad("command palette navigates to item", "not found");
  if (src.includes("notes:open")) ok("command palette dispatches notes:open");
  else bad("command palette dispatches notes:open", "not found");
}

// 2. tags_cloud.js
const tagsFile = path.join(FE, "src/widgets/tags_cloud.js");
if (!fs.existsSync(tagsFile)) bad("tags_cloud.js exists", "missing");
else {
  const src = fs.readFileSync(tagsFile, "utf8");
  if (src.includes("extractTags")) ok("tags_cloud exports extractTags()");
  else bad("tags_cloud exports extractTags()", "not found");
  if (src.includes("renderTagsCloud")) ok("tags_cloud exports renderTagsCloud()");
  else bad("tags_cloud exports renderTagsCloud()", "not found");
  if (src.includes("injectTagsInline")) ok("tags_cloud exports injectTagsInline()");
  else bad("tags_cloud exports injectTagsInline()", "not found");
  if (src.includes("getActiveTag")) ok("tags_cloud exports getActiveTag()");
  else bad("tags_cloud exports getActiveTag()", "not found");
  if (src.includes("#")) ok("tags_cloud parses #tag regex");
  else bad("tags_cloud parses #tag regex", "not found");
}

// 3. vault.js
const vaultFile = path.join(FE, "src/services/vault.js");
if (!fs.existsSync(vaultFile)) bad("vault.js exists", "missing");
else {
  const src = fs.readFileSync(vaultFile, "utf8");
  if (src.includes("getCurrentVault")) ok("vault exports getCurrentVault()");
  else bad("vault exports getCurrentVault()", "not found");
  if (src.includes("setCurrentVault")) ok("vault exports setCurrentVault()");
  else bad("vault exports setCurrentVault()", "not found");
  if (src.includes("mountVaultSwitcher")) ok("vault exports mountVaultSwitcher()");
  else bad("vault exports mountVaultSwitcher()", "not found");
  if (src.includes("default") && src.includes("school") && src.includes("personal") && src.includes("work")) {
    ok("vault has 4 default vaults");
  } else bad("vault has 4 default vaults", "not found");
}

// 4. main.js wires them
const mainFile = path.join(FE, "src/main.js");
if (fs.existsSync(mainFile)) {
  const src = fs.readFileSync(mainFile, "utf8");
  if (src.includes("mountCommandPalette")) ok("main.js calls mountCommandPalette");
  else bad("main.js calls mountCommandPalette", "not found");
  if (src.includes("mountVaultSwitcher")) ok("main.js calls mountVaultSwitcher");
  else bad("main.js calls mountVaultSwitcher", "not found");
  if (src.includes("setupCmdTrigger")) ok("main.js has setupCmdTrigger");
  else bad("main.js has setupCmdTrigger", "not found");
}

// 5. notes.js uses tags
const notesFile = path.join(FE, "src/screens/notes.js");
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("extractTags")) ok("notes.js imports extractTags");
  else bad("notes.js imports extractTags", "not found");
  if (src.includes("renderTagsCloud")) ok("notes.js uses renderTagsCloud");
  else bad("notes.js uses renderTagsCloud", "not found");
  if (src.includes("activeTag")) ok("notes.js filters by activeTag");
  else bad("notes.js filters by activeTag", "not found");
}

// 6. calendar.js drag-to-create
const calFile = path.join(FE, "src/screens/calendar.js");
if (fs.existsSync(calFile)) {
  const src = fs.readFileSync(calFile, "utf8");
  if (src.includes("attachDragCreate")) ok("calendar.js has attachDragCreate");
  else bad("calendar.js has attachDragCreate", "not found");
  if (src.includes("cal-drag-preview")) ok("calendar.js has drag preview class");
  else bad("calendar.js has drag preview class", "not found");
  if (src.includes("openEventModalPre")) ok("calendar.js has openEventModalPre");
  else bad("calendar.js has openEventModalPre", "not found");
  if (src.includes("pointerdown") && src.includes("pointermove") && src.includes("pointerup")) {
    ok("calendar.js uses pointer events for drag");
  } else bad("calendar.js uses pointer events for drag", "not found");
}

// 7. CSS styles
const cssFile = path.join(FE, "src/styles/components.css");
if (fs.existsSync(cssFile)) {
  const css = fs.readFileSync(cssFile, "utf8");
  if (css.includes(".cmd-trigger")) ok("CSS has .cmd-trigger");
  else bad("CSS has .cmd-trigger", "not found");
  if (css.includes(".tag-pill")) ok("CSS has .tag-pill");
  else bad("CSS has .tag-pill", "not found");
  if (css.includes(".tl-tag")) ok("CSS has .tl-tag (inline)");
  else bad("CSS has .tl-tag (inline)", "not found");
  if (css.includes(".vault-switcher")) ok("CSS has .vault-switcher");
  else bad("CSS has .vault-switcher", "not found");
  if (css.includes(".vault-menu")) ok("CSS has .vault-menu");
  else bad("CSS has .vault-menu", "not found");
}
// v1.9.0: cmd-palette styles are in the widget itself
const cmdWidget = path.join(FE, "src/widgets/command_palette.js");
if (fs.existsSync(cmdWidget)) {
  const src = fs.readFileSync(cmdWidget, "utf8");
  if (src.includes(".cmd-palette")) ok("command_palette widget has .cmd-palette styles");
  else bad("command_palette widget has .cmd-palette styles", "not found");
}
const calCss = path.join(FE, "src/styles/calendar.css");
if (fs.existsSync(calCss)) {
  const css = fs.readFileSync(calCss, "utf8");
  if (css.includes(".cal-drag-preview")) ok("calendar.css has .cal-drag-preview");
  else bad("calendar.css has .cal-drag-preview", "not found");
  if (css.includes(".cal-drag-hint")) ok("calendar.css has .cal-drag-hint");
  else bad("calendar.css has .cal-drag-hint", "not found");
}

// 8. i18n keys
const i18nFile = path.join(FE, "src/services/i18n.js");
if (fs.existsSync(i18nFile)) {
  const i18n = fs.readFileSync(i18nFile, "utf8");
  if (i18n.includes('"notes.noNotesWithTag":')) ok("i18n has notes.noNotesWithTag");
  else bad("i18n has notes.noNotesWithTag", "not found");
  if (i18n.includes('"notes.tryOtherTag":')) ok("i18n has notes.tryOtherTag");
  else bad("i18n has notes.tryOtherTag", "not found");
}

console.log(`\n[v1.9] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

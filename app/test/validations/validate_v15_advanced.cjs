/* ============================================================
 * validate_v15_advanced.cjs — v1.5.3 (3D), v1.5.4 (audio),
 *  v1.5.5 (wikilinks), v1.5.6 (cross-verify)
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");
const BE = path.resolve(__dirname, "../../../backend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v1.5 advanced] 3D viewer + audio + cross-verify\n");

// 1. 3D viewer widget
const threeFile = path.join(FE, "src/widgets/three_d_viewer.js");
if (!fs.existsSync(threeFile)) bad("three_d_viewer.js exists", "missing");
else {
  const src = fs.readFileSync(threeFile, "utf8");
  if (src.includes("WebGLRenderer")) ok("3D viewer uses WebGLRenderer");
  else bad("3D viewer uses WebGLRenderer", "not found");
  if (src.includes("PerspectiveCamera")) ok("3D viewer has PerspectiveCamera");
  else bad("3D viewer has PerspectiveCamera", "not found");
  if (src.includes("localToWorld") && src.includes("project")) ok("3D viewer uses screen-space projection");
  else bad("3D viewer uses screen-space projection", "not found");
  if (src.includes("three-d-hotspot")) ok("3D viewer has hotspot class");
  else bad("3D viewer has hotspot class", "not found");
  if (src.includes("callout")) ok("3D viewer has callouts (lines+labels)");
  else bad("3D viewer has callouts", "not found");
  if (src.includes("three.min.js") || src.includes("three@")) ok("3D viewer loads three.js from CDN");
  else bad("3D viewer loads three.js from CDN", "not found");
}

// 2. notes.js integrates 3D
const notesFile = path.join(FE, "src/screens/notes.js");
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("open3DInPage")) ok("notes.js has open3DInPage");
  else bad("notes.js has open3DInPage", "not found");
  if (src.includes('act === "graph"')) ok("notes.js triggers 3D on graph button");
  else bad("notes.js triggers 3D on graph button", "not found");
}

// 3. audio recorder widget
const audioFile = path.join(FE, "src/widgets/audio_recorder.js");
if (!fs.existsSync(audioFile)) bad("audio_recorder.js exists", "missing");
else {
  const src = fs.readFileSync(audioFile, "utf8");
  if (src.includes("MediaRecorder")) ok("audio recorder uses MediaRecorder API");
  else bad("audio recorder uses MediaRecorder API", "not found");
  if (src.includes("guessCurrentSubject")) ok("audio recorder guesses current subject from calendar");
  else bad("audio recorder guesses current subject", "not found");
  if (src.includes("/api/v1/recordings")) ok("audio recorder POSTs to backend");
  else bad("audio recorder POSTs to backend", "not found");
  if (src.includes("transcript")) ok("audio recorder has transcript stub");
  else bad("audio recorder has transcript stub", "not found");
}

// 4. notes.js integrates audio
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("openAudioRecorder")) ok("notes.js imports openAudioRecorder");
  else bad("notes.js imports openAudioRecorder", "not found");
  if (src.includes('act === "voice"')) ok("notes.js triggers recorder on voice button");
  else bad("notes.js triggers recorder on voice button", "not found");
}

// 5. backend recordings route
const recFile = path.join(BE, "src/routes/recordings.ts");
if (!fs.existsSync(recFile)) bad("recordings.ts exists", "missing");
else {
  const src = fs.readFileSync(recFile, "utf8");
  if (src.includes("MediaRecorder") || src.includes("recording")) ok("recordings.ts handles recordings");
  else bad("recordings.ts handles recordings", "not found");
  if (src.includes("/recordings/filter")) ok("recordings.ts has /filter");
  else bad("recordings.ts has /filter", "not found");
}

// 6. backend cross-verify
const cvFile = path.join(BE, "src/routes/cross_verify.ts");
if (!fs.existsSync(cvFile)) bad("cross_verify.ts exists", "missing");
else {
  const src = fs.readFileSync(cvFile, "utf8");
  if (src.includes("crossVerify")) ok("cross_verify has crossVerify()");
  else bad("cross_verify has crossVerify()", "not found");
  if (src.includes("missing-notes")) ok("cross_verify detects missing-notes");
  else bad("cross_verify detects missing-notes", "not found");
  if (src.includes("incomplete")) ok("cross_verify detects incomplete notes");
  else bad("cross_verify detects incomplete notes", "not found");
  if (src.includes("coveragePct")) ok("cross_verify computes coverage %");
  else bad("cross_verify computes coverage %", "not found");
  if (src.includes("/cross-verify")) ok("cross_verify has /cross-verify route");
  else bad("cross_verify has /cross-verify route", "not found");
}

// 7. server registers all new routes
const srvFile = path.join(BE, "src/server.ts");
if (fs.existsSync(srvFile)) {
  const srv = fs.readFileSync(srvFile, "utf8");
  ["recordingsRoutes", "crossVerifyRoutes"].forEach((r) => {
    if (srv.includes(r)) ok(`server.ts registers ${r}`);
    else bad(`server.ts registers ${r}`, "not found");
  });
}

// 8. frontend wikilinks click handler
if (fs.existsSync(notesFile)) {
  const src = fs.readFileSync(notesFile, "utf8");
  if (src.includes("tl-wikilink") && src.includes("addEventListener")) ok("notes.js wires wikilink clicks");
  else bad("notes.js wires wikilink clicks", "not found");
}

// 9. frontend cross-verify panel
const cvPanel = path.join(FE, "src/widgets/cross_verify_panel.js");
if (!fs.existsSync(cvPanel)) bad("cross_verify_panel.js exists", "missing");
else {
  const src = fs.readFileSync(cvPanel, "utf8");
  if (src.includes("coveragePct")) ok("cross-verify panel shows coverage %");
  else bad("cross-verify panel shows coverage %", "not found");
  if (src.includes("missing-notes") || src.includes("gaps")) ok("cross-verify panel lists gaps");
  else bad("cross-verify panel lists gaps", "not found");
}

// 10. overview has cv-btn
const ovFile = path.join(FE, "src/screens/overview.js");
if (fs.existsSync(ovFile)) {
  const src = fs.readFileSync(ovFile, "utf8");
  if (src.includes("cv-btn") && src.includes("openCrossVerifyPanel")) ok("overview.js has cross-verify button");
  else bad("overview.js has cross-verify button", "not found");
}

console.log(`\n[v1.5 advanced] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

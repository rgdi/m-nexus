/* ============================================================
 * validate_v20.cjs — v2.0 features
 * ============================================================ */

const fs = require("fs");
const path = require("path");
const FE = path.resolve(__dirname, "../../../frontend");
const BE = path.resolve(__dirname, "../../../backend");

let pass = 0, fail = 0;
function ok(n) { console.log("  \u2713 " + n); pass++; }
function bad(n, w) { console.log("  \u2717 " + n + " \u2014 " + w); fail++; }

console.log("\n[v2.0] WebView build + attachments + AI tutor + exams + sync\n");

// 1. WebView build script
const buildScript = path.join(__dirname, "../../../scripts/build_webview.sh");
if (fs.existsSync(buildScript)) {
  const src = fs.readFileSync(buildScript, "utf8");
  if (src.includes("webview-bundle")) ok("build_webview.sh outputs webview-bundle");
  else bad("build_webview.sh outputs webview-bundle", "not found");
  if (src.includes("capacitor") && src.includes("cordova")) ok("build_webview.sh supports capacitor+cordova");
  else bad("build_webview.sh supports capacitor+cordova", "not found");
  if (src.includes("BUILD_INFO.json")) ok("build_webview.sh generates BUILD_INFO.json");
  else bad("build_webview.sh generates BUILD_INFO.json", "not found");
}

// 2. File attachments
const attFile = path.join(FE, "src/widgets/file_attachments.js");
if (fs.existsSync(attFile)) {
  const src = fs.readFileSync(attFile, "utf8");
  if (src.includes("addAttachment")) ok("file_attachments exports addAttachment()");
  else bad("file_attachments exports addAttachment()", "not found");
  if (src.includes("openAttachmentViewer")) ok("file_attachments exports openAttachmentViewer()");
  else bad("file_attachments exports openAttachmentViewer()", "not found");
  if (src.includes("buildOcclusionTool")) ok("file_attachments has image occlusion tool");
  else bad("file_attachments has image occlusion tool", "not found");
  if (src.includes("Auto-generate")) ok("file_attachments auto-generates 3x3 grid");
  else bad("file_attachments auto-generates 3x3 grid", "not found");
  if (src.includes("approved")) ok("file_attachments has approved/unapproved state");
  else bad("file_attachments has approved/unapproved state", "not found");
  if (src.includes(".glb") || src.includes("gltf")) ok("file_attachments supports .glb 3D models");
  else bad("file_attachments supports .glb 3D models", "not found");
}

// 3. AI tutor
const tutorFile = path.join(FE, "src/widgets/ai_tutor.js");
if (fs.existsSync(tutorFile)) {
  const src = fs.readFileSync(tutorFile, "utf8");
  if (src.includes("openAITutor")) ok("ai_tutor exports openAITutor()");
  else bad("ai_tutor exports openAITutor()", "not found");
  if (src.includes("mountAITutor")) ok("ai_tutor exports mountAITutor()");
  else bad("ai_tutor exports mountAITutor()", "not found");
  if (src.includes("setAIContext")) ok("ai_tutor has setAIContext() (lesson-aware)");
  else bad("ai_tutor has setAIContext() (lesson-aware)", "not found");
  if (src.includes("localAnswer")) ok("ai_tutor has local stub for offline");
  else bad("ai_tutor has local stub for offline", "not found");
  if (src.includes("Generate 3 flashcards") || src.includes("flashcards")) ok("ai_tutor generates flashcards inline");
  else bad("ai_tutor generates flashcards inline", "not found");
  if (src.includes("Quiz") || src.includes("quiz")) ok("ai_tutor can quiz");
  else bad("ai_tutor can quiz", "not found");
}

// 4. Flashcard slash command
const slashFile = path.join(FE, "src/widgets/flashcard_slash.js");
if (fs.existsSync(slashFile)) {
  const src = fs.readFileSync(slashFile, "utf8");
  if (src.includes("mountFlashcardSlash")) ok("flashcard_slash exports mountFlashcardSlash()");
  else bad("flashcard_slash exports mountFlashcardSlash()", "not found");
  if (src.includes("/flashcards")) ok("flashcard_slash triggers on /flashcards");
  else bad("flashcard_slash triggers on /flashcards", "not found");
  if (src.includes("pending")) ok("flashcard_slash has pending queue (unapproved)");
  else bad("flashcard_slash has pending queue (unapproved)", "not found");
  if (src.includes("Commit all")) ok("flashcard_slash has commit-all action");
  else bad("flashcard_slash has commit-all action", "not found");
}

// 5. Exams service
const examSvc = path.join(FE, "src/services/exams.js");
if (fs.existsSync(examSvc)) {
  const src = fs.readFileSync(examSvc, "utf8");
  if (src.includes("buildExam")) ok("exams exports buildExam()");
  else bad("exams exports buildExam()", "not found");
  if (src.includes("subject") && src.includes("folder") && src.includes("note")) {
    ok("exams supports subject/folder/note scopes");
  } else bad("exams supports subject/folder/note scopes", "not found");
  if (src.includes("getRecentSeenIds") || src.includes("recentIds")) ok("exams has anti-repeat (recent seen)");
  else bad("exams has anti-repeat (recent seen)", "not found");
  if (src.includes("cdfOverdue") || src.includes("diffWeight") || src.includes("lapseWeight")) {
    ok("exams has smart scheduling (difficulty/overdue/lapses)");
  } else bad("exams has smart scheduling", "not found");
  if (src.includes("recordAnswer")) ok("exams records answers for history");
  else bad("exams records answers for history", "not found");
}

// 6. Exam runner widget
const examWidget = path.join(FE, "src/widgets/exam_runner.js");
if (fs.existsSync(examWidget)) {
  const src = fs.readFileSync(examWidget, "utf8");
  if (src.includes("openExamWizard")) ok("exam_runner exports openExamWizard()");
  else bad("exam_runner exports openExamWizard()", "not found");
  if (src.includes("subject") && src.includes("note")) ok("exam_runner has scope selector");
  else bad("exam_runner has scope selector", "not found");
  if (src.includes("score")) ok("exam_runner shows score at end");
  else bad("exam_runner shows score at end", "not found");
}

// 7. Sync client (v2.0.6)
const syncClient = path.join(FE, "src/services/sync_client.js");
if (fs.existsSync(syncClient)) {
  const src = fs.readFileSync(syncClient, "utf8");
  if (src.includes("connectSync")) ok("sync_client exports connectSync()");
  else bad("sync_client exports connectSync()", "not found");
  if (src.includes("publishChange")) ok("sync_client exports publishChange()");
  else bad("sync_client exports publishChange()", "not found");
  if (src.includes("onSync") || src.includes("listeners")) ok("sync_client has listener registry");
  else bad("sync_client has listener registry", "not found");
  if (src.includes("WebSocket")) ok("sync_client uses WebSocket");
  else bad("sync_client uses WebSocket", "not found");
  if (src.includes("reconnect")) ok("sync_client auto-reconnects");
  else bad("sync_client auto-reconnects", "not found");
}

// 8. Backend sync_v2
const syncBe = path.join(BE, "src/routes/sync_v2.ts");
if (fs.existsSync(syncBe)) {
  const src = fs.readFileSync(syncBe, "utf8");
  if (src.includes("websocket")) ok("backend sync_v2 has WebSocket route");
  else bad("backend sync_v2 has WebSocket route", "not found");
  if (src.includes("/sync/publish")) ok("backend sync_v2 has /sync/publish REST");
  else bad("backend sync_v2 has /sync/publish REST", "not found");
  if (src.includes("/sync/history")) ok("backend sync_v2 has /sync/history");
  else bad("backend sync_v2 has /sync/history", "not found");
  if (src.includes("broadcast")) ok("backend sync_v2 broadcasts to all clients");
  else bad("backend sync_v2 broadcasts to all clients", "not found");
}

// 9. main.js wires v2.0
const mainFile = path.join(FE, "src/main.js");
if (fs.existsSync(mainFile)) {
  const src = fs.readFileSync(mainFile, "utf8");
  if (src.includes("mountAITutor")) ok("main.js mounts AI tutor");
  else bad("main.js mounts AI tutor", "not found");
  if (src.includes("connectSync")) ok("main.js calls connectSync");
  else bad("main.js calls connectSync", "not found");
}

// 10. overview.js wires exam
const ovFile = path.join(FE, "src/screens/overview.js");
if (fs.existsSync(ovFile)) {
  const src = fs.readFileSync(ovFile, "utf8");
  if (src.includes("openExamWizard")) ok("overview.js opens exam wizard");
  else bad("overview.js opens exam wizard", "not found");
  if (src.includes("#exam-btn")) ok("overview.js has exam-btn");
  else bad("overview.js has exam-btn", "not found");
}

console.log(`\n[v2.0] ${pass}/${pass + fail} passed\n`);
process.exit(fail === 0 ? 0 : 1);

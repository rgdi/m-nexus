import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

// Rutas que NO se incluyen en el bundle del plugin
// (estas clases viven en el backend; aquí solo se usan en tests)
const EXCLUDED_FROM_BUNDLE = [
  // AI
  "ai/vaultEvaluator",
  "ai/contentProposals",
  "ai/studyOrchestrator",
  // Study
  "study/knowledgeLayers",
  "study/adaptiveQuiz",
  // FSRS
  "fsrs/scheduler",
  "fsrs/loadBalancer",
  "fsrs/knowledgeBoost",
  "fsrs/evaluationBoost",
  // Exams
  "exams/scheduler",
  "exams/scopeResolver",
  "exams/fsrsIntegration",
  "exams/boost",
  "exams/weeklyReview",
  "exams/studyGoals",
  "exams/scheduleMatcher",
  "exams/persistence",
  "exams/safeFlush",
  "exams/monitorV2",
  "exams/persistentAdherence",
  "exams/persistentStreak",
  "exams/notificationsV2",
  "exams/pushBridge",
  "exams/examManager",
  "exams/clockUtils",
  // RAG
  "rag/embeddings",
  "rag/indexer",
  "rag/vectorStore",
  "rag/retriever",
  "rag/chat",
  "rag/chunker",
  // LLM
  "llm/manager",
  "llm/ollama",
  "llm/openrouter",
  "llm/provider",
  "llm/remoteProvider",
  // Calendar
  "calendar/sync",
  "calendar/googleAuth",
  "calendar/googleCalendar",
  "calendar/ics",
  // Coverage
  "coverage/auditor",
  // Handwritten
  "handwritten/ocr",
  "handwritten/remoteOcr",
  // HTR
  "htr/manager",
  "htr/renderedOcr",
  // Flashcards
  "flashcards/generator",
  "flashcards/queue",
  "flashcards/templates",
  "flashcards/autoTypes",
  "flashcards/builtinTemplates",
  "flashcards/imageOcclusion",
  "flashcards/parser",
  // Audio
  "audio/whisperInstaller",
  // Sync
  "sync/manager",
];

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
  // Marcar como external las rutas excluidas
  // (no se bundlean, se cargan en runtime si se necesitan)
  plugins: [
    {
      name: "exclude-legacy",
      setup(build) {
        build.onResolve({ filter: new RegExp(`(${EXCLUDED_FROM_BUNDLE.join("|")})`) }, (args) => {
          // Mantenerlas external
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}

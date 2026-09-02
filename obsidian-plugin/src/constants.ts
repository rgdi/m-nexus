import { MNexusSettings } from "./types";

export const PLUGIN_ID = "m-nexus";
export const PLUGIN_NAME = "M-NEXUS";

export const VIEW_TYPE_DASHBOARD = "m-nexus-dashboard";
export const VIEW_TYPE_INBOX = "m-nexus-inbox";
export const VIEW_TYPE_TEMPLATES = "m-nexus-templates";
export const VIEW_TYPE_CALENDAR = "m-nexus-calendar";
export const VIEW_TYPE_DRAWING = "m-nexus-drawing";
export const VIEW_TYPE_CHAT = "m-nexus-chat";

export const DEFAULT_INBOX = "_M-NEXUS/Inbox";
export const DEFAULT_FLASHCARDS_DRAFT = "_M-NEXUS/Flashcards/Drafts";
export const DEFAULT_FLASHCARDS_APPROVED = "_M-NEXUS/Flashcards/Approved";
export const DEFAULT_TRANSCRIPTIONS = "_M-NEXUS/Transcripciones";
export const DEFAULT_HANDWRITTEN = "_M-NEXUS/Manuscritos";
export const DEFAULT_DRAWINGS = "_M-NEXUS/Dibujos";
export const DEFAULT_TEMPLATES = "_M-NEXUS/Templates";

/** Frases que el profesor suele usar para remarcar importancia. */
export const EMPHASIS_PATTERNS: RegExp[] = [
  /esto es (?:fundamental|clave|importante|crítico|importante para el examen)/i,
  /van a tomar (?:esto|en el examen)/i,
  /(?:esto|esto va) (?:siempre|sale|sale siempre)/i,
  /insisto en/i,
  /no lo (?:olviden|olvidéis)/i,
  /importantísimo/i,
  /es (?:lo más|básico|clave)/i,
];

export const FLASHCARD_TEMPLATES = {
  cloze: "**{{subject}}** — ¿Qué significa: {{{{cloze: {clozeText}}}}}?",
  qa: "**Pregunta:** {front}\n\n**Respuesta:** {back}",
};

/** URL por defecto de OpenRouter. */
export const OPENROUTER_DEFAULT_BASE = "https://openrouter.ai/api/v1";

/** URL por defecto de Ollama (para el futuro). */
export const OLLAMA_DEFAULT_BASE = "http://localhost:11434";

/** Modelos populares de OpenRouter para que el usuario elija. */
export const OPENROUTER_POPULAR_MODELS = [
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", costTier: "medium" as const, contextWindow: 200000, supportsJson: true },
  { id: "anthropic/claude-3-haiku", name: "Claude 3 Haiku (rápido)", costTier: "low" as const, contextWindow: 200000, supportsJson: true },
  { id: "openai/gpt-4o-mini", name: "GPT-4o mini (rápido)", costTier: "low" as const, contextWindow: 128000, supportsJson: true },
  { id: "openai/gpt-4o", name: "GPT-4o", costTier: "high" as const, contextWindow: 128000, supportsJson: true },
  { id: "google/gemini-pro-1.5", name: "Gemini Pro 1.5", costTier: "medium" as const, contextWindow: 1000000, supportsJson: true },
  { id: "meta-llama/llama-3.1-70b-instruct", name: "Llama 3.1 70B (gratis)", costTier: "free" as const, contextWindow: 128000, supportsJson: true },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1 8B (gratis, rápido)", costTier: "free" as const, contextWindow: 128000, supportsJson: true },
  { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B (gratis)", costTier: "free" as const, contextWindow: 32000, supportsJson: true },
  { id: "mistralai/mistral-large", name: "Mistral Large", costTier: "medium" as const, contextWindow: 128000, supportsJson: true },
];

/** Palabras clave por defecto que identifican exámenes en el calendario. */
export const DEFAULT_EXAM_KEYWORDS = [
  "examen",
  "evaluación",
  "evaluacion",
  "parcial",
  "final",
  "exámen",
  "test",
  "quiz",
  "control",
  "prueba",
  "midterm",
  "exam",
];

export const DEFAULT_SETTINGS: MNexusSettings = {
  inboxFolder: DEFAULT_INBOX,
  flashcardsDraftFolder: DEFAULT_FLASHCARDS_DRAFT,
  flashcardsApprovedFolder: DEFAULT_FLASHCARDS_APPROVED,
  transcriptionsFolder: DEFAULT_TRANSCRIPTIONS,
  handwrittenFolder: DEFAULT_HANDWRITTEN,
  drawingsFolder: DEFAULT_DRAWINGS,
  templatesFolder: DEFAULT_TEMPLATES,
  transcriptionBackend: "local-script",
  whisperScriptPath: "",
  whisperModel: "medium",
  whisperLanguage: "es",
  whisperAutoInstall: true,
  whisperPythonPath: "",
  ocrBackend: "tesseract",
  ocrScriptPath: "",
  llmProvider: "openrouter",
  llmModel: "anthropic/claude-3-haiku",
  openrouterApiKey: "",
  openrouterBaseUrl: OPENROUTER_DEFAULT_BASE,
  ollamaBaseUrl: OLLAMA_DEFAULT_BASE,
  llmTemperature: 0.3,
  llmMaxTokens: 2000,
  fsrsRequestRetention: 0.9,
  fsrsMaxIntervalDays: 365,
  dailyReviewCap: 120,
  softCap: 60,
  softCapMinutes: 60,
  enableCoverageAudit: true,
  coverageThreshold: 70,
  enableSocraticPrompts: true,
  enableLlmAudit: false,
  enableCalendarSync: false,
  calendarIcsUrls: [],
  calendarKeywords: DEFAULT_EXAM_KEYWORDS,
  calendarAutoSyncIntervalHours: 24,
  enableGoogleCalendar: false,
  googleClientId: "",
  googleClientSecret: "",
  syncBackend: "disabled",
  webdavUrl: "",
  webdavUsername: "",
  webdavPassword: "",
  webdavBasePath: "/m-nexus/",
  autoSyncOnChange: false,
  enableRag: true,
  ragMinScore: 0.55,
  ragTopK: 5,
  ragAutoIndex: false,
  htrBackend: "rendered-ocr",
  htrScriptPath: "",
  htrAutoRecognize: false,
  htrLanguage: "spa",
  myscriptAppKey: "",
  myscriptAppSecret: "",
  hasSeenOnboarding: false,
  showStatusBar: true,
  drawingMode: "svg-canvas",
  drawingDefaultSize: { width: 800, height: 400 },
  showDashboardOnStartup: false,
  showRibbonIcons: true,
  // v0.5
  photosFolder: "_M-NEXUS/Photos",
  // v0.6 — Servidor central + backup automático
  serverUrl: "",
  serverAutoConnect: false,
  conflictStrategy: "newer-wins" as const,
  backupEnabled: true,
  backupIntervalHours: 24,
  backupMaxLocal: 10,
  backupUploadToServer: false,
  backupUploadToWebdav: false,
  backupEmergencyOnError: true,
  // v0.7
  analyticsDailyCap: 20,
  clinicalVignetteStyle: "usmle" as const,
  pdfDiffAutoOnUpload: true,
  // v0.8 — Thin client
  backendUrl: "",
  forceRemote: true, // por defecto: TODO al servidor
  backendToken: "",
  whisperBackend: "remote" as const,
  embeddingsBackend: "remote" as const,
  llmBackend: "remote" as const,
  // v0.9 — Taxonomía de nivel académico
  userLevel: "1_MED" as const,
  levelAware: true,
  levelPromotionStability: 60, // días
  levelPromotionMinRatio: 0.7, // 70% de tarjetas estables
  // v0.17 — Notificaciones y monitor
  notificationsEnabled: true,
  notificationAdherenceThreshold: 0.5,
  notificationExamApproachingDays: "7,3,1",
  notificationMaxPerDay: 5,
  notificationAlertStreakAtRisk: true,
  monitorEnabled: true,
  monitorIntervalHours: 4,
  // v0.19 — Thresholds configurables
  clockSkewThresholdMs: 7_200_000, // 2 horas
  safeFlushMaxRetries: 3,
  safeFlushInitialDelayMs: 1000,
  safeFlushBackoffFactor: 2,
  safeFlushBackoffFactorX100: 200, // = 2.0 * 100 para precisión entera
  deepFocusStopsMonitor: true,
  // v0.19 — Study goals
  dailyGoalCards: 30,
  weeklyGoalCards: 200,
  streakGoalDays: 7,
  accuracyGoalRate: 0.8,
  accuracyGoalRateX100: 80,
};

// Tipos centrales de M-NEXUS.
// Define el modelo de datos compartido por todos los módulos.
// Añadido en v0.2: LLMProvider, FlashcardTemplate, CalendarEvent, DrawingShape.

export type PriorityLevel = "High" | "Medium" | "Low";

/**
 * Nivel académico del alumno o de la nota.
 * Determina la complejidad de los prompts al LLM (RAG, viñetas, socrático)
 * y la profundidad del razonamiento clínico esperado.
 *
 * 1_MED: Bioquímica, histología, anatomía pura (citología, tejidos, órganos).
 * 2_MED: Fisiología, microbiología, inmunología, farmacología básica.
 * 3_MED: Patología, semiología, fisiopatología, diagnóstico diferencial inicial.
 * 4_MED: Medicina interna, especialidades, diagnósticos complejos.
 * 5_MED: Prácticas clínicas, casos completos, manejo del paciente.
 * 6_MED_MIR: Estilo USMLE / MIR (preguntas de examen avanzado).
 */
export type AcademicLevel =
  | "1_MED"
  | "2_MED"
  | "3_MED"
  | "4_MED"
  | "5_MED"
  | "6_MED_MIR"
  | "custom";

export interface AcademicLevelInfo {
  id: AcademicLevel;
  label: string;
  year: number; // 1..6
  /** Descripción para mostrar al usuario. */
  description: string;
  /** Bloque de prompt para el LLM (se inyecta en systemPrompt). */
  prompt: string;
  /** Tipos de pregunta prioritarios en este nivel. */
  preferredQuestionTypes: string[];
  /** Vocabulario esperado (molecular, histológico, clínico, etc.). */
  vocabulary: string[];
  /** Etiquetas para clasificar tarjetas. */
  tags: string[];
}

export type CardStatus = "draft" | "approved" | "rejected";

export type CardType = "basic" | "cloze" | "reversed" | "list" | "image-occlusion" | "freeform";

export type TranscriptionBackend = "local-script" | "whisper-cpp" | "openai-api" | "disabled";

export type OcrBackend = "tesseract" | "local-llm" | "cloud" | "disabled";

export type LLMProviderId = "openrouter" | "ollama" | "openai-compatible" | "disabled" | "remote";

export type DrawingMode = "excalidraw" | "svg-canvas" | "obsidian-canvas";

export type Rating = 1 | 2 | 3 | 4;

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  language?: string;
}

/** Esquema del frontmatter M-NEXUS. */
export interface MNexusFrontmatter {
  title: string;
  subject?: string;
  /** Nivel académico de la nota (1_MED, 2_MED, ..., 6_MED_MIR, custom). */
  level?: AcademicLevel;
  author_verified?: boolean;
  exam_date?: string;
  priority_level?: PriorityLevel;
  prof_audio_ref?: string;
  pending_flashcard_review?: number;
  fsrs_stability?: number;
  fsrs_difficulty?: number;
  next_due_date?: string;
  has_handwritten_notes?: boolean;
  handwritten_source?: string;
  coverage_score?: number;
  emphasis_blocks?: string[];
  last_audit?: string;
  // Nuevos
  template_id?: string;            // template de flashcards usado
  drawing_refs?: string[];         // paths a archivos de dibujo
  calendar_event_id?: string;      // id del evento iCal que asignó el examen
  exam_source?: "manual" | "calendar" | "inferred";
  illustration_keywords?: string[]; // para que el LLM sepa qué ilustrar
}

export interface FlashcardDraft {
  id: string;
  notePath: string;
  templateId: string;              // qué template la generó
  cardType: CardType;
  front: string;
  back: string;
  tags: string[];
  sourceBlock?: string;
  createdAt: string;
  status: CardStatus;
  fsrs?: FsrsState;
  /** Datos extra según el tipo (image occlusion tiene svgRef, cloze tiene maskRanges, etc.). */
  extra?: Record<string, unknown>;
}

export interface FsrsState {
  stability: number;
  difficulty: number;
  dueDate: string;
  reps: number;
  lapses: number;
  lastReview?: string;
  lastRating?: Rating;
}

export interface AudioRecord {
  id: string;
  filePath: string;
  fileName: string;
  createdAt: string;
  recordedAt?: number; // v0.28: timestamp ms para filtros por rango
  subject?: string;    // v0.28: subject del audio para filtros
  state: "inbox" | "linked" | "transcribing" | "error";
  targetNotePath?: string;
  transcriptPath?: string;
  durationSec?: number;
  errorMessage?: string;
}

export interface CoverageGap {
  id: string;
  notePath: string;
  topic: string;
  evidence: string;
  source: "transcript" | "pdf" | "manual";
  severity: "critical" | "minor";
  resolved: boolean;
}

export interface SubjectSummary {
  subject: string;
  totalNotes: number;
  dueToday: number;
  overdue: number;
  pendingApprovals: number;
  examDate?: string;
  priority: PriorityLevel;
  averageCoverage: number;
}

export interface DailyLoad {
  date: string;
  cards: number;
  estimatedMinutes: number;
  overflow: boolean;
}

// ─── LLM ─────────────────────────────────────────────────────────────────

/** Mensaje simple para el LLM (lo que se envía al provider). */
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Mensaje de chat persistido (lo que se guarda en sesiones RAG). */
export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  sources?: RAGSearchResult[];
  createdAt: string;
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  stop?: string[];
  systemPrompt?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProviderId;
  contextWindow?: number;
  supportsJson?: boolean;
  costTier?: "free" | "low" | "medium" | "high";
}

export interface LLMStatus {
  provider: LLMProviderId;
  configured: boolean;
  model?: string;
  error?: string;
  ollamaAvailable?: boolean;
  openrouterAvailable?: boolean;
}

// ─── Templates ───────────────────────────────────────────────────────────

export interface FlashcardTemplate {
  id: string;
  name: string;
  subject: string;          // "anatomy", "pharmaco", "physiology", "patho", "general", etc.
  description: string;
  cardType: CardType;
  /** Prompt del sistema que se envía al LLM. */
  systemPrompt: string;
  /** Prompt del usuario. Soporta placeholders: {{noteTitle}}, {{noteContent}}, {{subject}}. */
  userPrompt: string;
  /** Regex para extraer tarjetas del JSON devuelto por el LLM. Fallback si el LLM no responde JSON limpio. */
  parserStrategy: "json" | "markdown" | "regex";
  parserConfig?: {
    /** Patrón regex (modo regex). Grupos: 1=front, 2=back, 3+=tags. */
    pattern?: string;
    /** JSON Schema esperado (modo json) — usado para validar/instruir al LLM. */
    jsonExample?: string;
  };
  /** Si el LLM no está disponible, fallback heurístico local. */
  localFallback: "definitions" | "lists" | "headings" | "none";
  /** Etiquetas automáticas que se aplican a las tarjetas generadas. */
  autoTags: string[];
  examples: { front: string; back: string }[];
  builtin: boolean; // true = no se puede borrar, false = creado por el usuario
}

// ─── Calendar ────────────────────────────────────────────────────────────

export interface CalendarEvent {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end?: Date;
  location?: string;
  raw: Record<string, string>;
}

export interface ExamMatch {
  event: CalendarEvent;
  /** Materia inferida del summary o descripción. */
  subject: string;
  /** Fecha ISO del examen (helper para no leer event.start cada vez). */
  date: string;
  /** Ruta de la nota a la que se asignó. */
  notePath?: string;
  confidence: "high" | "medium" | "low";
}

// ─── Drawing ─────────────────────────────────────────────────────────────

export interface DrawingShape {
  id: string;
  type: "path" | "rect" | "circle" | "text" | "arrow";
  points: number[]; // [x, y, x, y, ...]
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  text?: string;
  createdAt: string;
}

export interface DrawingDocument {
  id: string;
  notePath: string;
  /** Bloque de la nota donde se ancla. */
  anchor?: string;
  shapes: DrawingShape[];
  createdAt: string;
  updatedAt: string;
}

// ─── Settings ────────────────────────────────────────────────────────────

export interface MNexusSettings {
  // Rutas
  inboxFolder: string;
  flashcardsDraftFolder: string;
  flashcardsApprovedFolder: string;
  transcriptionsFolder: string;
  handwrittenFolder: string;
  drawingsFolder: string;
  templatesFolder: string;
  // Transcripción
  transcriptionBackend: TranscriptionBackend;
  whisperScriptPath: string;
  whisperModel: string;
  whisperLanguage: string;
  whisperAutoInstall: boolean;
  whisperPythonPath: string;
  // OCR
  ocrScriptPath: string;
  // LLM
  llmProvider: LLMProviderId;
  llmModel: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  ollamaBaseUrl: string;
  llmTemperature: number;
  llmMaxTokens: number;
  // FSRS
  fsrsRequestRetention: number;
  fsrsMaxIntervalDays: number;
  dailyReviewCap: number;
  softCap: number;
  softCapMinutes: number;
  // Auditoría
  enableCoverageAudit: boolean;
  coverageThreshold: number;
  enableSocraticPrompts: boolean;
  enableLlmAudit: boolean; // usar LLM para auditoría más profunda
  // Calendar
  enableCalendarSync: boolean;
  calendarIcsUrls: string[]; // múltiples calendarios soportados
  calendarIcsUrlsRaw?: string; // textarea source
  calendarLocalFile?: string;
  calendarKeywords: string[]; // ["examen", "evaluación", "parcial", "final"]
  calendarKeywordsRaw?: string; // textarea source
  calendarAutoSyncIntervalHours: number;
  // Google Calendar (OAuth)
  enableGoogleCalendar: boolean;
  googleClientId: string;
  googleClientSecret: string;
  googleAuthState?: GoogleAuthState;
  // WebDAV sync
  syncBackend: SyncBackend;
  webdavUrl: string;
  webdavUsername: string;
  webdavPassword: string;
  webdavBasePath: string;
  autoSyncOnChange: boolean;
  // RAG
  enableRag: boolean;
  ragMinScore: number;
  ragTopK: number;
  ragAutoIndex: boolean; // re-indexar al detectar cambios
  // HTR (Handwriting-to-text)
  htrBackend: HTRBackend;
  htrScriptPath: string;
  htrAutoRecognize: boolean; // al cerrar el dibujo, ofrecer reconocer
  htrLanguage: string;
  myscriptAppKey: string;
  myscriptAppSecret: string;
  // UX
  hasSeenOnboarding: boolean;
  showStatusBar: boolean;
  // Drawing
  drawingMode: DrawingMode;
  drawingDefaultSize: { width: number; height: number };
  // UI
  showDashboardOnStartup: boolean;
  showRibbonIcons: boolean;
  // v0.5
  photosFolder: string;
  // v0.6 — Servidor central + backup automático
  serverUrl: string;
  serverAutoConnect: boolean;
  conflictStrategy: "local-wins" | "server-wins" | "newer-wins" | "manual";
  backupEnabled: boolean;
  backupIntervalHours: number;
  backupMaxLocal: number;
  backupUploadToServer: boolean;
  backupUploadToWebdav: boolean;
  backupEmergencyOnError: boolean;
  // v0.7 — Analytics, Clinical, PDF
  analyticsDailyCap: number;
  clinicalVignetteStyle: "usmle" | "mir" | "osce" | "case-presentation";
  pdfDiffAutoOnUpload: boolean;
  // v0.8 — Thin client: delega TODO el procesamiento pesado al servidor
  /** URL del backend central (sin slash final). Si vacío, el plugin trabaja en modo degradado. */
  backendUrl: string;
  /** Si true, IGNORA los providers locales y obliga a usar el backend. */
  forceRemote: boolean;
  /** Token de autenticación del backend (asignado al registrar el dispositivo). */
  backendToken: string;
  /** Backend preferido para Whisper: 'remote' (servidor) o 'local' (Whisper.cpp). */
  whisperBackend: "remote" | "local";
  /** Backend preferido para OCR: 'remote' o 'local' (Tesseract). */
  ocrBackend: string;
  /** Backend preferido para embeddings: 'remote' o 'local' (Transformers.js). */
  embeddingsBackend: "remote" | "local";
  /** Backend preferido para LLM: 'remote' (Ollama/OpenRouter remoto) o 'local' (Ollama local). */
  llmBackend: "remote" | "local";
  // v0.9 — Taxonomía de nivel académico
  /** Nivel académico actual del alumno. Inyecta restricciones en RAG, viñetas, socrático. */
  userLevel: AcademicLevel;
  /** Si true, inyecta automáticamente el nivel en los prompts. */
  levelAware: boolean;
  /** Estabilidad FSRS mínima para sugerir promoción al siguiente nivel. */
  levelPromotionStability: number;
  /** Porcentaje mínimo de tarjetas estables para sugerir promoción. */
  levelPromotionMinRatio: number;
  // v0.17 — Notificaciones y modo focus
  /** Si false, no se emiten notificaciones. */
  notificationsEnabled: boolean;
  /** Adherencia < este valor dispara "adherence-drop". */
  notificationAdherenceThreshold: number;
  /** Días antes del examen que disparan notificación. Coma-separado. */
  notificationExamApproachingDays: string;
  /** Máximo de notificaciones por día. */
  notificationMaxPerDay: number;
  /** Si true, alerta cuando la racha está en riesgo. */
  notificationAlertStreakAtRisk: boolean;
  /** Si true, el monitor en background está activo. */
  monitorEnabled: boolean;
  /** Cada cuántas horas se ejecuta el monitor. */
  monitorIntervalHours: number;
  // v0.19 — Thresholds configurables + Study goals + Deep focus
  /** Umbral (en ms) para detectar clock skew. Default 2h = 7200000. */
  clockSkewThresholdMs: number;
  /** Reintentos de saveData en onunload. Default 3. */
  safeFlushMaxRetries: number;
  /** Delay inicial (ms) entre reintentos. Default 1000. */
  safeFlushInitialDelayMs: number;
  /** Factor de backoff entre reintentos (en escala × 100). Default 200. */
  safeFlushBackoffFactorX100: number;
  safeFlushBackoffFactor: number;
  /** Si true, el modo deep focus detiene el monitor completamente. */
  deepFocusStopsMonitor: boolean;
  /** Goal diario de cards repasadas. Default 30. */
  dailyGoalCards: number;
  /** Goal semanal de cards repasadas. Default 200. */
  weeklyGoalCards: number;
  /** Goal de racha (días consecutivos). Default 7. */
  streakGoalDays: number;
  /** Goal de accuracy mínima (0..1). Default 0.8. */
  accuracyGoalRate: number;
  /** v0.19: goal de accuracy en escala 0..100 (para slider). */
  accuracyGoalRateX100: number;
}

export interface ReviewItem {
  card: FlashcardDraft;
  noteTitle: string;
  subject?: string;
  priority: PriorityLevel;
}

export interface InstallProgress {
  step: string;
  progress: number; // 0-1
  message: string;
  done: boolean;
  error?: string;
}

// ─── RAG ────────────────────────────────────────────────────────────────

export interface RAGChunk {
  id: string;
  notePath: string;
  noteTitle: string;
  section?: string;
  chunkIndex: number;
  text: string;
  embedding: number[]; // vector
  createdAt: string;
  hash: string; // hash del texto para invalidación
}

export interface RAGSearchResult {
  chunk: RAGChunk;
  score: number; // 0-1, mayor = más relevante
}

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  sources?: RAGSearchResult[];
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ─── Google Calendar ────────────────────────────────────────────────────

export interface GoogleAuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  scope: string;
  email?: string;
}

// ─── Sync ───────────────────────────────────────────────────────────────

export type SyncBackend = "webdav" | "google-drive" | "dropbox" | "disabled";

export type HTRBackend = "rendered-ocr" | "myscript" | "local-ml" | "disabled";

export interface HTRResult {
  text: string;
  confidence: number; // 0-1
  language: string;
  lines: string[];
  durationMs: number;
}

export interface SyncFileEntry {
  path: string;
  size: number;
  mtime: number; // epoch ms
  etag?: string;
  remoteHash?: string;
  localHash?: string;
  status: "synced" | "local-newer" | "remote-newer" | "conflict" | "local-only" | "remote-only";
}

export interface SyncStatus {
  backend: SyncBackend;
  connected: boolean;
  lastSync?: number;
  pendingUploads: number;
  pendingDownloads: number;
  conflicts: number;
  error?: string;
}

export interface SyncBackendConfig {
  backend: SyncBackend;
  webdav?: {
    url: string;
    username: string;
    password: string;
    basePath: string; // ej: "/m-nexus/"
  };
  googleDrive?: {
    refreshToken: string;
    folderId: string;
  };
}

// ─── Drawing v2: presión ───────────────────────────────────────────────

export interface PressurePoint {
  x: number;
  y: number;
  pressure: number; // 0-1
  tiltX?: number;
  tiltY?: number;
  t?: number; // timestamp ms
}

export interface PressureStroke {
  id: string;
  points: PressurePoint[];
  stroke: string;
  strokeWidth: number;
  createdAt: string;
}

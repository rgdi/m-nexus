// API que la UI consume. Desacopla vistas de la implementación del plugin.

import { App, TFile } from "obsidian";
import { CoverageGap, ExamMatch, FlashcardDraft, FlashcardTemplate, Rating, RAGSearchResult, SyncStatus } from "./types";

export interface DashboardData {
  dueToday: number;
  pendingApprovals: number;
  inboxAudio: number;
  criticalGaps: number;
  upcomingExams: { subject: string; date: string; priority: "High" | "Medium" | "Low" }[];
  llmStatus: { provider: string; configured: boolean; model?: string; error?: string };
  whisperInstalled: boolean;
  calendarEnabled: boolean;
  googleCalendarAuthorized: boolean;
  ragChunks: number;
  syncStatus?: SyncStatus;
  socraticPrompt?: string;
}

export interface InboxAudioItem {
  id: string;
  fileName: string;
  filePath: string;
  createdAt: string;
  targetNotePath?: string;
}

export interface PluginLike {
  app: App;
  getDashboardData(): Promise<DashboardData>;
  getInboxAudio(): InboxAudioItem[];
  listInboxTranscripts(): Promise<TFile[]>;
  promptForNote(): Promise<string | null>;
  linkAudioToNote(audioId: string, notePath: string): Promise<void>;
  approveCard(card: FlashcardDraft): Promise<void>;
  rejectCard(cardId: string): Promise<void>;
  applyFsrsReview(card: FlashcardDraft, rating: Rating): Promise<FlashcardDraft | null>;
  getDueCards(): Promise<FlashcardDraft[]>;
  appendGapToNote(gap: CoverageGap): Promise<void>;
  openWhisperInstaller(): void;
  checkWhisperInstalled(): Promise<{ installed: boolean }>;
  openCalendarModal(): void;
  runCalendarSync(): Promise<void>;
  previewCalendarSync(): Promise<ExamMatch[]>;
  openDrawingPane(): Promise<void>;
  openTemplateList(): void;
  listTemplates(): FlashcardTemplate[];
  getTemplate(id: string): FlashcardTemplate;
  // v0.3
  indexVault(): Promise<{ indexed: number; skipped: number }>;
  openChatView(): void;
  openQuickChat(): void;
  openScheduleModal(): Promise<void>;
  authorizeGoogleCalendar(): Promise<void>;
  runGoogleCalendarSync(): Promise<{ events: number; matched: number }>;
  runWebDavSync(): Promise<{ downloaded: number; uploaded: number; conflicts: number }>;
  testWebDavConnection(): Promise<boolean>;
  quickSearch(query: string, topK?: number): Promise<RAGSearchResult[]>;
  // v0.4
  openOnboardingWizard(): void;
}

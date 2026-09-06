// v0.28: Servicio de evaluación del vault.
// Encapsula la heurística que antes vivía en el plugin (vaultEvaluator.ts).
// Recibe los snapshots ya extraídos y devuelve VaultEvaluation.

import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
export interface NoteSnapshotInput {
  path: string;
  basename: string;
  content: string;
  size: number;
  wordCount: number;
  tags: string[];
  links: string[];
  hasAudio: boolean;
  hasPdf: boolean;
  hasFlashcards: boolean;
  topic?: string | null;
}

export interface SubjectInfo {
  name: string;
  noteCount: number;
  wordCount: number;
  flashcards: number;
}

export interface GapInfo {
  topic: string;
  reason: string;
  severity: number;
  suggestion: string;
}

export interface VaultEvaluationResult {
  totalNotes: number;
  totalWords: number;
  totalFlashcards: number;
  totalAudio: number;
  totalPdf: number;
  averageQuality: number;
  untagged: NoteSnapshotInput[];
  orphaned: NoteSnapshotInput[];
  shortNotes: NoteSnapshotInput[];
  notesWithoutFlashcards: NoteSnapshotInput[];
  topics: Array<{ name: string; count: number; notes: string[] }>;
  subjects: SubjectInfo[];
  gaps: GapInfo[];
}

/** Evalúa un conjunto de notas y devuelve el resultado estructurado. */
export function evaluateVault(snapshots: NoteSnapshotInput[]): VaultEvaluationResult {
  const totalWords = snapshots.reduce((s, n) => s + (n.wordCount || 0), 0);
  const totalFlashcards = snapshots.reduce(
    (s, n) => s + ((n.content.match(/##\s*Card\s/g) ?? []).length),
    0,
  );
  const totalAudio = snapshots.filter((n) => n.hasAudio).length;
  const totalPdf = snapshots.filter((n) => n.hasPdf).length;

  const untagged: NoteSnapshotInput[] = [];
  const orphaned: NoteSnapshotInput[] = [];
  const shortNotes: NoteSnapshotInput[] = [];
  const notesWithoutFlashcards: NoteSnapshotInput[] = [];
  const topicsMap = new Map<string, { count: number; notes: string[] }>();
  const subjectsMap = new Map<string, SubjectInfo>();
  const gaps: GapInfo[] = [];

  for (const note of snapshots) {
    const words = note.content.split(/\s+/).filter((w) => w.length > 0).length;
    note.wordCount = words;

    if (note.tags.length === 0) untagged.push(note);
    if (note.links.length === 0) orphaned.push(note);
    if (words < 100) shortNotes.push(note);
    if (!note.hasFlashcards && words > 50) notesWithoutFlashcards.push(note);

    // Topic
    const topic = note.topic ?? note.tags[0] ?? "general";
    const t = topicsMap.get(topic) ?? { count: 0, notes: [] };
    t.count++;
    t.notes.push(note.path);
    topicsMap.set(topic, t);

    // Subject
    const subjectKey = note.path.split("/")[0] ?? "general";
    const s = subjectsMap.get(subjectKey) ?? { name: subjectKey, noteCount: 0, wordCount: 0, flashcards: 0 };
    s.noteCount++;
    s.wordCount += words;
    s.flashcards += (note.content.match(/##\s*Card\s/g) ?? []).length;
    subjectsMap.set(subjectKey, s);
  }

  // Generar gaps: topics sin flashcards o muy cortos
  for (const [topic, info] of topicsMap.entries()) {
    if (info.notes.length === 0) continue;
    const firstNote = snapshots.find((n) => n.path === info.notes[0]);
    if (!firstNote) continue;
    const hasCards = (firstNote.content.match(/##\s*Card\s/g) ?? []).length > 0;
    if (!hasCards) {
      gaps.push({
        topic,
        reason: "sin-flashcards",
        severity: 0.7,
        suggestion: `Crear flashcards de ${topic}`,
      });
    }
    if (info.notes.length === 1 && firstNote.wordCount < 100) {
      gaps.push({
        topic,
        reason: "contenido-insuficiente",
        severity: 0.5,
        suggestion: `Ampliar contenido de ${topic}`,
      });
    }
  }

  // Quality promedio: relación entre flashcards y palabras
  const averageQuality = totalWords > 0 ? Math.min(1, totalFlashcards * 100 / totalWords) : 0;

  return {
    totalNotes: snapshots.length,
    totalWords,
    totalFlashcards,
    totalAudio,
    totalPdf,
    averageQuality,
    untagged,
    orphaned,
    shortNotes,
    notesWithoutFlashcards,
    topics: Array.from(topicsMap.entries()).map(([name, info]) => ({ name, ...info })),
    subjects: Array.from(subjectsMap.values()),
    gaps,
  };
}

// v0.28: Generador de propuestas (estudios, flashcards, tags, links, gaps).
// Encapsula las heurísticas que antes vivían en el plugin (studyOrchestrator.ts).
// Recibe la evaluación del vault y los snapshots, devuelve proposals estructurados.

import type { VaultEvaluationResult, NoteSnapshotInput } from "./vaultEval.js";
import { genProposalId, type Proposal } from "./proposalsTypes.js";

function generateFlashcardsFromContent(content: string, topic: string | null): Array<{ front: string; back: string }> {
  const cards: Array<{ front: string; back: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line.startsWith("## ") || line.startsWith("# ")) {
      const header = line.replace(/^#+\s*/, "");
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const next = lines[j].trim();
        if (next.startsWith("- ") || next.startsWith("* ")) {
          cards.push({
            front: `¿Qué es/son ${header}?`,
            back: next.slice(2).trim(),
          });
          break;
        }
      }
    }
    if (cards.length >= 5) break;
  }
  if (cards.length === 0 && topic) {
    cards.push({ front: `¿Qué sabes sobre ${topic}?`, back: "Revisa la nota y extrae los puntos clave." });
  }
  return cards;
}

function suggestTags(note: NoteSnapshotInput): string[] {
  // Extrae tags candidatos de las primeras secciones de la nota
  const candidates = new Set<string>();
  // Tags desde el topic
  if (note.topic) candidates.add(note.topic);
  // Tags desde la primera línea H1
  const h1 = note.content.match(/^#\s+(.+)$/m);
  if (h1) {
    const w = h1[1].toLowerCase().split(/\s+/)[0];
    if (w && w.length > 3) candidates.add(w);
  }
  // Tags desde los H2
  const h2s = [...note.content.matchAll(/^##\s+(.+)$/gm)];
  for (const m of h2s.slice(0, 3)) {
    const w = m[1].toLowerCase().split(/\s+/)[0];
    if (w && w.length > 3) candidates.add(w);
  }
  // Filtrar los que ya están
  return Array.from(candidates).filter((t) => !note.tags.includes(t)).slice(0, 5);
}

function extractKeyPoints(content: string, n: number): string[] {
  const lines = content.split("\n");
  const points: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      points.push(trimmed.slice(2));
    }
    if (points.length >= n) break;
  }
  return points;
}

function generateSummaryFromContent(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const firstParagraph = lines.find((l) => !l.startsWith("#") && l.length > 50);
  return firstParagraph ?? lines.slice(0, 3).join(" ").slice(0, 500);
}

function findRelatedNotes(
  note: NoteSnapshotInput,
  all: NoteSnapshotInput[],
  limit = 2,
): Array<{ path: string; similarity: number }> {
  const tokenize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/\W+/)
      .filter((t) => t.length > 3);
  const a = new Set(tokenize(note.content));
  const related: Array<{ path: string; similarity: number }> = [];
  for (const other of all) {
    if (other.path === note.path) continue;
    const b = new Set(tokenize(other.content));
    const inter = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    if (union.size === 0) continue;
    const similarity = inter.size / union.size;
    if (similarity > 0.05) {
      related.push({ path: other.path, similarity });
    }
  }
  related.sort((a, b) => b.similarity - a.similarity);
  return related.slice(0, limit);
}

export interface GenerateProposalsInput {
  evaluation: VaultEvaluationResult;
  snapshots: NoteSnapshotInput[];
  config: {
    autoGenerateTypes: string[];
    minScore: number;
    maxPendingProposals: number;
  };
}

export interface GenerateProposalsResult {
  proposals: Proposal[];
  stats: { generated: number; byType: Record<string, number> };
}

export function generateProposals(input: GenerateProposalsInput): GenerateProposalsResult {
  const { evaluation, snapshots, config } = input;
  const proposals: Proposal[] = [];
  const byType: Record<string, number> = {};

  const addProposal = (p: Proposal) => {
    if (proposals.length >= config.maxPendingProposals) return;
    if (p.score < config.minScore) return;
    proposals.push(p);
    byType[p.type] = (byType[p.type] ?? 0) + 1;
  };

  // 1) Notas sin flashcards → proponer flashcards
  if (config.autoGenerateTypes.includes("flashcards")) {
    for (const note of evaluation.notesWithoutFlashcards.slice(0, 5)) {
      const cards = generateFlashcardsFromContent(note.content, note.topic ?? null);
      if (cards.length === 0) continue;
      addProposal({
        id: genProposalId(),
        type: "flashcards",
        title: `Crear ${cards.length} flashcards de "${note.basename}"`,
        description: `La nota tiene contenido valioso pero sin flashcards. Generaré ${cards.length} cards automáticamente.`,
        reasoning: `Nota sin flashcards detectada (${note.wordCount} palabras, sin # Card headers)`,
        score: 0.7,
        confidence: 0.7,
        priority: "medium",
        createdAt: Date.now(),
        status: "pending",
        sourceNote: note.path,
        targetFolder: note.path.includes("/") ? note.path.split("/").slice(0, -1).join("/") : "",
        cards,
        autoApply: false,
        requiresDoubleApproval: false,
      });
    }
  }

  // 2) Notas sin tags → proponer tags
  if (config.autoGenerateTypes.includes("tag-suggestion")) {
    for (const note of evaluation.untagged.slice(0, 5)) {
      const suggestedTags = suggestTags(note);
      if (suggestedTags.length === 0) continue;
      addProposal({
        id: genProposalId(),
        type: "tag-suggestion",
        title: `Añadir tags a "${note.basename}"`,
        description: `Tags sugeridos: ${suggestedTags.join(", ")}`,
        reasoning: `Nota sin tags detectada (${note.path})`,
        score: 0.5,
        confidence: 0.6,
        priority: "low",
        createdAt: Date.now(),
        status: "pending",
        notePath: note.path,
        suggestedTags,
        autoApply: true,
        requiresDoubleApproval: false,
      });
    }
  }

  // 3) Notas huérfanas (sin links) → proponer links
  if (config.autoGenerateTypes.includes("link-suggestion")) {
    for (const note of evaluation.orphaned.slice(0, 3)) {
      const related = findRelatedNotes(note, snapshots, 2);
      if (related.length === 0) continue;
      const target = related[0];
      const lastPart = target.path.split("/").pop();
      addProposal({
        id: genProposalId(),
        type: "link-suggestion",
        title: `Vincular "${note.basename}" con nota relacionada`,
        description: `Añadir [[${target.path}]] en "${note.basename}"`,
        reasoning: `Nota sin links y similar a ${target.path} (similitud: ${target.similarity.toFixed(2)})`,
        score: target.similarity,
        confidence: target.similarity,
        priority: "low",
        createdAt: Date.now(),
        status: "pending",
        sourceNote: note.path,
        targetText: lastPart ? lastPart.replace(/\.md$/, "") : target.path,
        targetPath: target.path,
        autoApply: true,
        requiresDoubleApproval: false,
      });
    }
  }

  // 4) Gaps detectados → proponer gap-fill
  if (config.autoGenerateTypes.includes("gap-fill")) {
    for (const gap of evaluation.gaps.slice(0, 3)) {
      addProposal({
        id: genProposalId(),
        type: "gap-fill",
        title: `Cubrir hueco en ${gap.topic}`,
        description: gap.suggestion,
        reasoning: `Hueco detectado: ${gap.reason} (severidad ${gap.severity})`,
        score: gap.severity,
        confidence: gap.severity,
        priority: gap.severity > 0.6 ? "high" : "medium",
        createdAt: Date.now(),
        status: "pending",
        topic: gap.topic,
        autoApply: false,
        requiresDoubleApproval: true,
      });
    }
  }

  // 5) Notas largas sin summary → proponer summary
  if (config.autoGenerateTypes.includes("summary")) {
    const longNotes = snapshots
      .filter((n) => n.wordCount > 200 && !n.content.includes("## Resumen"))
      .slice(0, 3);
    for (const note of longNotes) {
      addProposal({
        id: genProposalId(),
        type: "summary",
        title: `Resumen ejecutivo de "${note.basename}"`,
        description: `Generar resumen al inicio de la nota`,
        reasoning: `Nota larga (${note.wordCount} palabras) sin resumen ejecutivo`,
        score: 0.6,
        confidence: 0.7,
        priority: "low",
        createdAt: Date.now(),
        status: "pending",
        sourceNote: note.path,
        summary: generateSummaryFromContent(note.content),
        keyPoints: extractKeyPoints(note.content, 5),
        length: "medium" as const,
        autoApply: false,
        requiresDoubleApproval: false,
      });
    }
  }

  return { proposals, stats: { generated: proposals.length, byType } };
}

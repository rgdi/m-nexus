// SchedulePlanner: genera un plan de estudio diario teniendo en cuenta:
//   - Exámenes próximos (más cerca = más repaso)
//   - Tarjetas FSRS pendientes
//   - Prioridad de cada nota
//   - Tiempo disponible por día (configurable)
//
// Devuelve un "agenda" diaria: bloques de tiempo con qué estudiar.

import { FlashcardDraft, MNexusFrontmatter, MNexusSettings, Rating } from "../types";

export interface StudyBlock {
  start: string; // HH:MM
  end: string;
  durationMin: number;
  type: "review" | "new-cards" | "deep-study" | "exam-prep" | "socratic" | "break";
  subject?: string;
  notePath?: string;
  description: string;
  priority: "High" | "Medium" | "Low";
}

export interface DailyAgenda {
  date: string; // ISO yyyy-mm-dd
  blocks: StudyBlock[];
  totalMinutes: number;
  summary: string;
}

export interface AgendaInput {
  /** Notas con frontmatter (con exam_date, priority, subject). */
  notes: { path: string; fm: MNexusFrontmatter }[];
  /** Tarjetas pendientes de repaso. */
  dueCards: FlashcardDraft[];
  /** Fecha para la que generar agenda. */
  date: Date;
  /** Minutos disponibles al día. */
  availableMinutes: number;
  /** Hora de inicio (default "09:00"). */
  startTime: string;
  /** FSRS rating por tarjeta (lo que tendría que responder para mantener la cadencia). */
  ratings?: Map<string, Rating>;
}

export class SchedulePlanner {
  constructor(private settings: MNexusSettings) {}

  generate(input: AgendaInput): DailyAgenda {
    const blocks: StudyBlock[] = [];
    let t = parseTime(input.startTime);
    const end = t + input.availableMinutes;

    // 1) Identificar exámenes en los próximos 7 días → exam-prep prioritario
    const examSoon = input.notes
      .filter((n) => {
        if (!n.fm.exam_date) return false;
        const d = new Date(n.fm.exam_date);
        const days = (d.getTime() - input.date.getTime()) / 86400000;
        return days >= 0 && days <= 7;
      })
      .sort((a, b) => (a.fm.exam_date! < b.fm.exam_date! ? -1 : 1));

    // 2) Repasos de tarjetas vencidas (FSRS).
    // Comparar por string "YYYY-MM-DD" para evitar desfases de timezone
    // (los dueDate están en local time en la convención del plugin).
    const todayStr = `${input.date.getFullYear()}-${String(input.date.getMonth() + 1).padStart(2, "0")}-${String(input.date.getDate()).padStart(2, "0")}`;
    const overdueCards = input.dueCards.filter((c) => {
      if (!c.fsrs) return true;
      return c.fsrs.dueDate.slice(0, 10) <= todayStr;
    });

    // 3) Notas High-priority sin repaso
    const highNotes = input.notes.filter((n) => n.fm.priority_level === "High");

    // Construcción greedy de bloques
    let slot = t;
    const block = (duration: number, type: StudyBlock["type"], description: string, opts: Partial<StudyBlock> = {}) => {
      if (slot + duration > end) return false;
      const startH = Math.floor(slot / 60);
      const startM = slot % 60;
      const endH = Math.floor((slot + duration) / 60);
      const endM = (slot + duration) % 60;
      blocks.push({
        start: `${startH.toString().padStart(2, "0")}:${startM.toString().padStart(2, "0")}`,
        end: `${endH.toString().padStart(2, "0")}:${endM.toString().padStart(2, "0")}`,
        durationMin: duration,
        type,
        description,
        priority: opts.priority ?? "Medium",
        ...opts,
      });
      slot += duration;
      return true;
    };

    // Distribución: 40% repasos, 30% deep-study, 20% exam-prep si hay, 10% breaks
    const reviewBudget = Math.round(input.availableMinutes * 0.4);
    const deepBudget = Math.round(input.availableMinutes * 0.3);
    const examBudget = examSoon.length > 0 ? Math.round(input.availableMinutes * 0.2) : 0;
    const breakBudget = input.availableMinutes - reviewBudget - deepBudget - examBudget;

    // Repaso
    if (reviewBudget > 0) {
      const reviewDuration = Math.min(overdueCards.length * 0.5, reviewBudget); // ~30s/card
      const dur = Math.max(15, Math.round(reviewDuration));
      block(
        dur,
        overdueCards.length > 0 ? "review" : "socratic",
        overdueCards.length > 0
          ? `${overdueCards.length} tarjetas pendientes (FSRS)`
          : "Repaso libre / preguntas socráticas",
        { priority: "High" }
      );
    }

    // Exam prep
    if (examBudget > 0 && examSoon.length > 0) {
      const ex = examSoon[0];
      const days = Math.ceil((new Date(ex.fm.exam_date!).getTime() - input.date.getTime()) / 86400000);
      block(examBudget, "exam-prep", `Examen ${ex.fm.subject ?? ex.path} en ${days} día(s)`, {
        subject: ex.fm.subject,
        notePath: ex.path,
        priority: "High",
      });
    }

    // Deep study: notas High sin examen próximo
    let deepRemaining = deepBudget;
    for (const n of highNotes) {
      if (deepRemaining <= 15) break;
      const days = n.fm.exam_date
        ? Math.ceil((new Date(n.fm.exam_date).getTime() - input.date.getTime()) / 86400000)
        : 999;
      if (days <= 7) continue; // ya cubierto arriba
      const dur = Math.min(25, deepRemaining);
      if (block(dur, "deep-study", `Estudio profundo: ${n.fm.subject ?? n.path}`, {
        subject: n.fm.subject,
        notePath: n.path,
        priority: "Medium",
      })) {
        deepRemaining -= dur;
      }
    }

    // Breaks
    if (breakBudget > 0) {
      block(breakBudget, "break", "Descanso / asimilar", { priority: "Low" });
    }

    const total = blocks.reduce((s, b) => s + b.durationMin, 0);
    // Usar local time para evitar desfase de timezone.
    const localDate = `${input.date.getFullYear()}-${String(input.date.getMonth() + 1).padStart(2, "0")}-${String(input.date.getDate()).padStart(2, "0")}`;
    return {
      date: localDate,
      blocks,
      totalMinutes: total,
      summary: this.summarize(blocks, examSoon.length, overdueCards.length),
    };
  }

  private summarize(blocks: StudyBlock[], examCount: number, dueCount: number): string {
    const review = blocks.filter((b) => b.type === "review").length;
    const exam = blocks.filter((b) => b.type === "exam-prep").length;
    const deep = blocks.filter((b) => b.type === "deep-study").length;
    return `${dueCount} tarjetas, ${examCount} exámenes próximos. Bloques: ${review} repasos, ${exam} exam-prep, ${deep} deep-study.`;
  }
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

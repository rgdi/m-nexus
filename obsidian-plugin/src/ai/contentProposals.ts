// v0.28: ContentProposal — la IA propone contenidos, el usuario aprueba.
// Human-in-the-loop estricto: nada se crea/aplica sin aprobación.

export type ProposalType =
  | "summary"           // Resumen de una nota larga
  | "flashcards"        // Deck de flashcards
  | "mind-map"          // Mapa mental (markdown con jerarquía)
  | "study-guide"       // Guía de estudio
  | "link-suggestion"   // Sugerir [[link]] entre notas
  | "reorganize"        // Mover nota a otra carpeta
  | "tag-suggestion"    // Añadir tags a una nota
  | "gap-fill"          // Crear nota sobre tema faltante
  | "merge"             // Fusionar notas duplicadas
  | "annotation-summary" // Resumen de anotaciones
  | "recap";            // Recap temario

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface ProposalBase {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  /** Por qué se sugiere (razonamiento del agente). */
  reasoning: string;
  /** Confianza del agente 0..1. */
  confidence: number;
  /** Prioridad 0..1. */
  priority: number;
  status: ProposalStatus;
  createdAt: number;
  approvedAt?: number;
  appliedAt?: number;
  rejectionReason?: string;
  /** Si requiere confirmación extra (escribir más, etc). */
  requiresDoubleApproval: boolean;
  /** Tags. */
  tags: string[];
}

export interface SummaryProposal extends ProposalBase {
  type: "summary";
  sourceNote: string;
  /** El resumen propuesto. */
  summary: string;
  /** Puntos clave. */
  keyPoints: string[];
  /** Length. */
  length: "short" | "medium" | "long";
}

export interface FlashcardsProposal extends ProposalBase {
  type: "flashcards";
  sourceNote: string;
  /** Cards propuestas. */
  cards: Array<{ front: string; back: string; cardType?: string; tags?: string[] }>;
  /** Carpeta destino. */
  targetFolder: string;
}

export interface MindMapProposal extends ProposalBase {
  type: "mind-map";
  sourceNote: string;
  /** Markdown del mind map (con # y - jerárquicos). */
  mindMap: string;
}

export interface StudyGuideProposal extends ProposalBase {
  type: "study-guide";
  subject: string;
  /** Plan de estudio propuesto. */
  plan: {
    objectives: string[];
    sessions: Array<{ day: number; duration: number; topics: string[]; activities: string[] }>;
    resources: string[];
  };
}

export interface LinkSuggestionProposal extends ProposalBase {
  type: "link-suggestion";
  sourceNote: string;
  targetNote: string;
  /** Texto exacto a convertir en link. */
  targetText: string;
  /** Por qué sugiere este link. */
  reason: string;
}

export interface ReorganizeProposal extends ProposalBase {
  type: "reorganize";
  notePath: string;
  currentFolder: string;
  suggestedFolder: string;
  reason: string;
}

export interface TagSuggestionProposal extends ProposalBase {
  type: "tag-suggestion";
  notePath: string;
  currentTags: string[];
  suggestedTags: string[];
  reason: string;
}

export interface GapFillProposal extends ProposalBase {
  type: "gap-fill";
  topic: string;
  /** Esqueleto de la nota. */
  skeleton: string;
  /** Sources consultadas. */
  sources: string[];
}

export interface MergeProposal extends ProposalBase {
  type: "merge";
  notes: string[];
  /** Nota destino. */
  targetNote: string;
  /** Estrategia de merge. */
  strategy: "append" | "replace" | "new-section";
}

export type Proposal =
  | SummaryProposal
  | FlashcardsProposal
  | MindMapProposal
  | StudyGuideProposal
  | LinkSuggestionProposal
  | ReorganizeProposal
  | TagSuggestionProposal
  | GapFillProposal
  | MergeProposal;

/** Proposal manager. Almacena y gestiona propuestas. */
export class ProposalStore {
  private proposals = new Map<string, Proposal>();
  private byStatus = new Map<ProposalStatus, Set<string>>();

  constructor() {
    for (const s of ["pending", "approved", "rejected", "applied", "failed"] as ProposalStatus[]) {
      this.byStatus.set(s, new Set());
    }
  }

  add(p: Proposal): void {
    this.proposals.set(p.id, p);
    this.byStatus.get(p.status)?.add(p.id);
  }

  update(id: string, patch: Partial<Proposal>): void {
    const p = this.proposals.get(id);
    if (!p) return;
    const oldStatus = p.status;
    Object.assign(p, patch);
    if (patch.status && patch.status !== oldStatus) {
      this.byStatus.get(oldStatus)?.delete(id);
      this.byStatus.get(patch.status)?.add(id);
    }
  }

  get(id: string): Proposal | null {
    return this.proposals.get(id) ?? null;
  }

  list(filter?: { status?: ProposalStatus; type?: ProposalType }): Proposal[] {
    let arr = Array.from(this.proposals.values());
    if (filter?.status) arr = arr.filter((p) => p.status === filter.status);
    if (filter?.type) arr = arr.filter((p) => p.type === filter.type);
    return arr.sort((a, b) => b.priority - a.priority);
  }

  /** Aprueba una propuesta. */
  approve(id: string): void {
    const p = this.proposals.get(id);
    if (!p) return;
    this.update(id, { status: "approved", approvedAt: Date.now() });
  }

  /** Rechaza una propuesta. */
  reject(id: string, reason?: string): void {
    this.update(id, { status: "rejected", rejectionReason: reason });
  }

  /** Marca como aplicada. */
  markApplied(id: string): void {
    this.update(id, { status: "applied", appliedAt: Date.now() });
  }

  /** Marca como fallida. */
  markFailed(id: string): void {
    this.update(id, { status: "failed" });
  }

  /** Estadísticas. */
  stats(): { total: number; byStatus: Record<ProposalStatus, number> } {
    const byStatus: Record<string, number> = {};
    for (const [status, ids] of this.byStatus.entries()) {
      byStatus[status] = ids.size;
    }
    return { total: this.proposals.size, byStatus: byStatus as Record<ProposalStatus, number> };
  }
}

/** Generador de IDs. */
let _pCounter = 0;
export function genProposalId(): string {
  _pCounter++;
  return `prop-${Date.now()}-${_pCounter}`;
}

// Tipos compartidos para proposals (mirror del plugin para evitar dependencia).

export type ProposalType =
  | "summary"
  | "flashcards"
  | "mind-map"
  | "study-guide"
  | "link-suggestion"
  | "reorganize"
  | "tag-suggestion"
  | "gap-fill"
  | "merge"
  | "annotation-summary"
  | "recap";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface ProposalBase {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  reasoning: string;
  score: number;
  confidence: number;
  priority: "low" | "medium" | "high";
  createdAt: number;
  status: ProposalStatus;
  approvedAt?: number;
  appliedAt?: number;
  error?: string;
  autoApply?: boolean;
  requiresDoubleApproval?: boolean;
}

export interface SummaryProposal extends ProposalBase {
  type: "summary";
  sourceNote: string;
  summary: string;
  keyPoints: string[];
  length: "short" | "medium" | "long";
}

export interface FlashcardsProposal extends ProposalBase {
  type: "flashcards";
  sourceNote: string;
  targetFolder: string;
  cards: Array<{ front: string; back: string }>;
}

export interface TagSuggestionProposal extends ProposalBase {
  type: "tag-suggestion";
  notePath: string;
  suggestedTags: string[];
}

export interface LinkSuggestionProposal extends ProposalBase {
  type: "link-suggestion";
  sourceNote: string;
  targetText: string;
  targetPath: string;
}

export interface GapFillProposal extends ProposalBase {
  type: "gap-fill";
  topic: string;
}

export type Proposal =
  | SummaryProposal
  | FlashcardsProposal
  | TagSuggestionProposal
  | LinkSuggestionProposal
  | GapFillProposal
  | (ProposalBase & { type: Exclude<ProposalType, "summary" | "flashcards" | "tag-suggestion" | "link-suggestion" | "gap-fill"> });

/** Genera un ID único para una propuesta. */
export function genProposalId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

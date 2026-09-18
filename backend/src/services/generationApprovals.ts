// generationApprovals.ts — Auto-generation approval queue (v2.8.0).
//
// AI generates candidate cards (clozes, occlusion masks, flashcards).
// Each candidate has a status: pending → approved/rejected.
// Only approved cards become real flashcards.
//
// This prevents hallucinated or low-quality cards from polluting the
// user's deck without explicit consent.

export interface ApprovalCandidate {
  id: string;
  topicId: string;
  sourceNoteId?: string;
  /** What was generated */
  kind: "cloze" | "flashcard" | "occlusion" | "question";
  payload: Record<string, unknown>;
  /** Front of the card (preview) */
  preview: string;
  /** Back of the card (preview) */
  answer: string;
  /** Confidence from the AI 0-1 */
  confidence: number;
  /** Generated at */
  createdAt: number;
  /** Status */
  status: "pending" | "approved" | "rejected";
  decidedAt?: number;
  reason?: string;
}

const approvals: Map<string, ApprovalCandidate> = new Map();

export function addCandidate(c: Omit<ApprovalCandidate, "id" | "createdAt" | "status">): ApprovalCandidate {
  const id = "cand-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const full: ApprovalCandidate = {
    ...c,
    id,
    createdAt: Date.now(),
    status: "pending",
  };
  approvals.set(id, full);
  return full;
}

export function listCandidates(topicId?: string, status?: ApprovalCandidate["status"]): ApprovalCandidate[] {
  let out = Array.from(approvals.values());
  if (topicId) out = out.filter((c) => c.topicId === topicId);
  if (status) out = out.filter((c) => c.status === status);
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function decide(id: string, status: "approved" | "rejected", reason?: string): ApprovalCandidate | null {
  const c = approvals.get(id);
  if (!c) return null;
  c.status = status;
  c.decidedAt = Date.now();
  if (reason) c.reason = reason;
  return c;
}

export function getCandidate(id: string): ApprovalCandidate | null {
  return approvals.get(id) || null;
}

export function clearDecided(): number {
  let n = 0;
  for (const [k, c] of approvals) {
    if (c.status !== "pending") {
      approvals.delete(k);
      n++;
    }
  }
  return n;
}

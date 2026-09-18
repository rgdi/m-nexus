// generationApprovals.ts — Auto-generation approval queue (v2.8.0 + v2.9.0).
//
// AI generates candidate cards (clozes, occlusion masks, flashcards).
// Each candidate has a status: pending → approved/rejected.
// Only approved cards become real flashcards.
//
// v2.9.0: persisted to data/approval-queue.json (file-backed) so the queue
// survives server restarts. Backed up with regular backup rotation.

import fs from "node:fs/promises";
import path from "node:path";

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

const DATA_DIR = path.resolve(process.cwd(), "data");
const FILE_PATH = path.join(DATA_DIR, "approval-queue.json");

let cache: Map<string, ApprovalCandidate> | null = null;
let writeTimer: NodeJS.Timeout | null = null;

async function load(): Promise<Map<string, ApprovalCandidate>> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = await fs.readFile(FILE_PATH, "utf-8");
    const arr = JSON.parse(raw) as ApprovalCandidate[];
    for (const c of arr) cache.set(c.id, c);
  } catch (e: any) {
    if (e.code !== "ENOENT") console.warn("[approvals] load failed:", e.message);
    // First boot: create empty file
    await save();
  }
  return cache;
}

async function save(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const arr = Array.from((cache ?? new Map()).values());
    await fs.writeFile(FILE_PATH, JSON.stringify(arr, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[approvals] save failed:", e.message);
  }
}

// Debounced write — coalesces rapid changes
function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    save().catch(() => {});
  }, 200);
}

export async function addCandidate(c: Omit<ApprovalCandidate, "id" | "createdAt" | "status">): Promise<ApprovalCandidate> {
  const map = await load();
  const id = "cand-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const full: ApprovalCandidate = {
    ...c,
    id,
    createdAt: Date.now(),
    status: "pending",
  };
  map.set(id, full);
  scheduleSave();
  return full;
}

export async function listCandidates(topicId?: string, status?: ApprovalCandidate["status"]): Promise<ApprovalCandidate[]> {
  const map = await load();
  let out = Array.from(map.values());
  if (topicId) out = out.filter((c) => c.topicId === topicId);
  if (status) out = out.filter((c) => c.status === status);
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function decide(id: string, status: "approved" | "rejected", reason?: string): Promise<ApprovalCandidate | null> {
  const map = await load();
  const c = map.get(id);
  if (!c) return null;
  c.status = status;
  c.decidedAt = Date.now();
  if (reason) c.reason = reason;
  scheduleSave();
  return c;
}

export async function getCandidate(id: string): Promise<ApprovalCandidate | null> {
  const map = await load();
  return map.get(id) || null;
}

export async function clearDecided(): Promise<number> {
  const map = await load();
  let n = 0;
  for (const [k, c] of map) {
    if (c.status !== "pending") {
      map.delete(k);
      n++;
    }
  }
  scheduleSave();
  return n;
}

export async function stats(): Promise<{ total: number; pending: number; approved: number; rejected: number }> {
  const map = await load();
  let pending = 0, approved = 0, rejected = 0;
  for (const c of map.values()) {
    if (c.status === "pending") pending++;
    else if (c.status === "approved") approved++;
    else if (c.status === "rejected") rejected++;
  }
  return { total: map.size, pending, approved, rejected };
}

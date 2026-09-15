// cross_verify.ts: cruza notas + grabaciones por hora/asignatura/tema.
// v1.5.6 — detecta huecos entre lo escrito y lo grabado.
//
// Lógica:
//   - Para cada grabación del día, busca notas del mismo subject en ventana ±30 min.
//   - Si no hay, marca "gap" (hueco).
//   - Si hay nota pero body muy corto (< 30 chars) marca "incomplete".
//   - Si grabación > 5min sin nota, marca "missing-notes".

import { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import { join } from "node:path";

interface NoteRec { id: string; title: string; body: string; subject: string; tags: string[]; updatedAt: number }
interface RecRec { id: string; subject: string; subjectName: string; durationSec: number; createdAt: number }

interface GapItem {
  type: "missing-notes" | "incomplete" | "ok" | "no-recording";
  recordingId?: string;
  noteId?: string;
  subject: string;
  timestamp: number;
  message: string;
}

async function loadNotes(): Promise<NoteRec[]> {
  try {
    return JSON.parse(await fs.readFile(join(process.cwd(), "data", "notes.json"), "utf-8"));
  } catch { return []; }
}

async function loadRecs(): Promise<RecRec[]> {
  try {
    return JSON.parse(await fs.readFile(join(process.cwd(), "data", "recordings.json"), "utf-8"));
  } catch { return []; }
}

export async function crossVerify(subject?: string): Promise<{
  gaps: GapItem[];
  totalRecordings: number;
  totalNotes: number;
  coveragePct: number;
}> {
  const notes = await loadNotes();
  const recs = await loadRecs();
  const filteredRecs = subject ? recs.filter((r) => r.subject === subject || r.subjectName === subject) : recs;
  const filteredNotes = subject ? notes.filter((n) => n.subject === subject) : notes;

  const gaps: GapItem[] = [];
  for (const r of filteredRecs) {
    // ventana ±30 min alrededor de la grabación
    const winStart = r.createdAt - 30 * 60 * 1000;
    const winEnd = r.createdAt + 30 * 60 * 1000;
    const nearby = filteredNotes.filter((n) => n.updatedAt >= winStart && n.updatedAt <= winEnd && (n.subject === r.subject || n.subject === r.subjectName));
    if (nearby.length === 0) {
      gaps.push({
        type: "missing-notes",
        recordingId: r.id,
        subject: r.subjectName || r.subject,
        timestamp: r.createdAt,
        message: `Grabación de ${r.subjectName || r.subject} sin notas en ±30 min.`,
      });
    } else if (nearby.some((n) => (n.body || "").length < 30)) {
      gaps.push({
        type: "incomplete",
        recordingId: r.id,
        noteId: nearby.find((n) => (n.body || "").length < 30)?.id,
        subject: r.subjectName || r.subject,
        timestamp: r.createdAt,
        message: `Nota de ${r.subjectName || r.subject} muy corta (${(nearby.find((n) => (n.body || "").length < 30)?.body || "").length} chars).`,
      });
    } else {
      gaps.push({
        type: "ok",
        recordingId: r.id,
        subject: r.subjectName || r.subject,
        timestamp: r.createdAt,
        message: `${r.subjectName || r.subject} OK: nota + grabación alineadas.`,
      });
    }
  }
  const coveragePct = filteredRecs.length === 0
    ? 100
    : Math.round((filteredRecs.length - gaps.filter((g) => g.type === "missing-notes").length) / filteredRecs.length * 100);
  return { gaps, totalRecordings: filteredRecs.length, totalNotes: filteredNotes.length, coveragePct };
}

export async function crossVerifyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { subject?: string } }>("/cross-verify", async (req) => {
    const out = await crossVerify(req.query.subject);
    return out;
  });
}

// cross_verify.ts: cruza notas + grabaciones por hora/asignatura/tema.
// v1.5.6 — detecta huecos entre lo escrito y lo grabado.
// v1.6.2 — incluye timestamp exacto (mmss) estilo Apple Music.
// v1.6.3 — incluye book refs (parte subrayada → minuto en grabación).
//
// Lógica:
//   - Para cada grabación del día, busca notas del mismo subject en ventana ±30 min.
//   - Si no hay, marca "gap" (hueco).
//   - Si hay nota pero body muy corto (< 30 chars) marca "incomplete".
//   - Si grabación > 5min sin nota, marca "missing-notes".
//   - Si la nota tiene @book/ref y existe grabación con esa referencia, jump-to-minute.

import { FastifyInstance } from "fastify";
import { promises as fs } from "node:fs";
import { join } from "node:path";

interface NoteRec { id: string; title: string; body: string; subject: string; tags: string[]; updatedAt: number }
interface RecRec { id: string; subject: string; subjectName: string; durationSec: number; createdAt: number; transcript: string }

export interface GapItem {
  type: "missing-notes" | "incomplete" | "ok" | "no-recording" | "book-ref";
  recordingId?: string;
  noteId?: string;
  subject: string;
  timestamp: number;
  timestampFormatted?: string; // "02:34" (v1.6.2)
  message: string;
  // v1.6.3: book reference info
  bookRef?: string;
  jumpUrl?: string; // ruta interna para navegar
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

function formatMmss(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
    const winStart = r.createdAt - 30 * 60 * 1000;
    const winEnd = r.createdAt + 30 * 60 * 1000;
    const nearby = filteredNotes.filter((n) => n.updatedAt >= winStart && n.updatedAt <= winEnd && (n.subject === r.subject || n.subject === r.subjectName));
    if (nearby.length === 0) {
      gaps.push({
        type: "missing-notes",
        recordingId: r.id,
        subject: r.subjectName || r.subject,
        timestamp: r.createdAt,
        timestampFormatted: formatMmss(r.createdAt - (recs[0]?.createdAt ?? r.createdAt)),
        message: `Grabación de ${r.subjectName || r.subject} sin notas en ±30 min.`,
      });
    } else if (nearby.some((n) => (n.body || "").length < 30)) {
      gaps.push({
        type: "incomplete",
        recordingId: r.id,
        noteId: nearby.find((n) => (n.body || "").length < 30)?.id,
        subject: r.subjectName || r.subject,
        timestamp: r.createdAt,
        timestampFormatted: formatMmss(r.createdAt - (recs[0]?.createdAt ?? r.createdAt)),
        message: `Nota de ${r.subjectName || r.subject} muy corta (${(nearby.find((n) => (n.body || "").length < 30)?.body || "").length} chars).`,
      });
    } else {
      gaps.push({
        type: "ok",
        recordingId: r.id,
        subject: r.subjectName || r.subject,
        timestamp: r.createdAt,
        timestampFormatted: formatMmss(r.createdAt - (recs[0]?.createdAt ?? r.createdAt)),
        message: `${r.subjectName || r.subject} OK: nota + grabación alineadas.`,
      });
    }
  }

  // v1.6.3: book refs desde notas → si la nota tiene @libro/ref y hay grabación,
  // devolvemos un item book-ref con jump URL
  for (const n of filteredNotes) {
    const re = /@([\wÀ-ÿ\/\-]+)/g; // sin punto, no capturar puntuación final
    const refs = [...((n.body || "").matchAll(re))].map((m) => m[1]);
    if (refs.length === 0) continue;
    for (const ref of refs) {
      const winStart = n.updatedAt - 30 * 60 * 1000;
      const winEnd = n.updatedAt + 30 * 60 * 1000;
      const nearbyRecs = filteredRecs
        .filter((r) => r.createdAt >= winStart && r.createdAt <= winEnd);
      const rec = nearbyRecs.sort((a, b) => Math.abs(a.createdAt - n.updatedAt) - Math.abs(b.createdAt - n.updatedAt))[0];
      if (rec) {
        // estimación: minuto dentro de la grabación = (updatedAt - rec.createdAt) / 1000 (segundos desde inicio)
        const offsetMs = Math.max(0, n.updatedAt - rec.createdAt);
        const offsetSec = Math.floor(offsetMs / 1000);
        const recStart = rec.createdAt - (recs[0]?.createdAt ?? rec.createdAt);
        gaps.push({
          type: "book-ref",
          noteId: n.id,
          recordingId: rec.id,
          subject: n.subject,
          timestamp: n.updatedAt,
          timestampFormatted: formatMmss(offsetMs),
          bookRef: ref,
          jumpUrl: `#/notes/${n.id}?rec=${rec.id}&t=${offsetSec}&ref=${encodeURIComponent(ref)}`,
          message: `📖 @${ref} en "${n.title}" → ${formatMmss(offsetMs)} dentro de la grabación.`,
        });
      }
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

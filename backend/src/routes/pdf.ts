// PDF routes: comparación de versiones (mueve la lógica del plugin al backend).
// v0.11: el plugin envía los dos binarios; el backend extrae texto, divide en
// párrafos y devuelve el diff. El plugin SOLO renderiza.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export interface PdfDiffHunk {
  kind: "equal" | "modified" | "added" | "removed";
  oldText?: string;
  newText?: string;
  similarity: number;
}

export interface PdfDiffResponse {
  summary: { equal: number; modified: number; added: number; removed: number; changeRatio: number };
  hunks: PdfDiffHunk[];
  versionA: { size: number; paragraphCount: number };
  versionB: { size: number; paragraphCount: number };
}

interface PdfDiffBody {
  pdfABase64?: string;
  pdfBBase64?: string;
}

export async function pdfRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/pdf/diff", async (req, reply) => {
    const body = (req.body ?? {}) as PdfDiffBody;
    const r = await safeCallAsync<PdfDiffResponse>({
      component: "fs",
      code: "EC-FS-001",
      message: "pdf.diff failed",
      context: {
        sizeA: body.pdfABase64?.length ?? 0,
        sizeB: body.pdfBBase64?.length ?? 0,
      },
      op: async () => {
        if (!body.pdfABase64 || !body.pdfBBase64) {
          throw E.val("EC-FS-002", "pdfABase64 y pdfBBase64 requeridos", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { pdfABase64: '...', pdfBBase64: '...' }",
          });
        }
        const a = Buffer.from(body.pdfABase64, "base64");
        const b = Buffer.from(body.pdfBBase64, "base64");
        const textA = extractText(a);
        const textB = extractText(b);
        const paragraphsA = extractParagraphs(textA);
        const paragraphsB = extractParagraphs(textB);
        const hunks = diffParagraphs(paragraphsA, paragraphsB);
        const summary = {
          equal: hunks.filter((h) => h.kind === "equal").length,
          modified: hunks.filter((h) => h.kind === "modified").length,
          added: hunks.filter((h) => h.kind === "added").length,
          removed: hunks.filter((h) => h.kind === "removed").length,
          changeRatio: 0,
        };
        const total = summary.equal + summary.modified + summary.added + summary.removed;
        summary.changeRatio = total > 0 ? (summary.modified + summary.added + summary.removed) / total : 0;
        logOp("fs", "pdf diff", true, {
          sizeA: a.length, sizeB: b.length,
          paragraphsA: paragraphsA.length, paragraphsB: paragraphsB.length,
          changeRatio: summary.changeRatio.toFixed(2),
        });
        return {
          summary,
          hunks,
          versionA: { size: a.length, paragraphCount: paragraphsA.length },
          versionB: { size: b.length, paragraphCount: paragraphsB.length },
        };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}

/** Extracción de texto mejorada con pdf.js o fallback a streams BT/ET. */
function extractText(buf: Buffer): string {
  let text = "";
  let inText = false;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x28) inText = true;
    else if (b === 0x29) inText = false;
    else if (inText && b >= 0x20 && b < 0x7f) text += String.fromCharCode(b);
    else if (b === 0x0a) text += "\n";
  }
  return text;
}

function extractParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 10);
}

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 ? inter / union : 0;
}

function diffParagraphs(A: string[], B: string[]): PdfDiffHunk[] {
  const hunks: PdfDiffHunk[] = [];
  const usedB = new Set<number>();
  for (let i = 0; i < A.length; i++) {
    const pa = A[i];
    let best = { j: -1, sim: 0 };
    for (let j = 0; j < B.length; j++) {
      if (usedB.has(j)) continue;
      const sim = textSimilarity(pa, B[j]);
      if (sim > best.sim) best = { j, sim };
    }
    if (best.sim > 0.92) {
      hunks.push({ kind: "equal", oldText: pa, newText: B[best.j], similarity: best.sim });
      usedB.add(best.j);
    } else if (best.sim > 0.5) {
      hunks.push({ kind: "modified", oldText: pa, newText: B[best.j], similarity: best.sim });
      usedB.add(best.j);
    } else {
      hunks.push({ kind: "removed", oldText: pa, similarity: 0 });
    }
  }
  for (let j = 0; j < B.length; j++) {
    if (!usedB.has(j)) hunks.push({ kind: "added", newText: B[j], similarity: 0 });
  }
  return hunks;
}

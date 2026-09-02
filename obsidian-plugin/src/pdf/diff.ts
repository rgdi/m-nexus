// PDF Diff: detecta cambios entre dos versiones de un PDF.
// v0.7: usamos el módulo pdf.js (cargado desde CDN al primer uso).
// Si pdf.js no está disponible, hacemos un fallback de diff por metadatos
// (tamaño, número de páginas si está disponible, hash) + diff de texto
// extraído si podemos.
//
// La idea no es reinventar pdf.js sino darle un wrapper que:
//   1. Extraiga texto de cada versión
//   2. Lo divida en párrafos
//   3. Marque cada párrafo como: igual, modificado, añadido, eliminado

export interface PdfVersion {
  id: string;
  filePath: string;
  uploadedAt: string;
  size: number;
  pageCount?: number;
  /** SHA-256 del binario. */
  hash: string;
  /** Texto extraído (puede estar vacío si pdf.js no se cargó). */
  text?: string;
  /** Párrafos extraídos, normalizados. */
  paragraphs?: string[];
}

export interface DiffHunk {
  /** Tipo de cambio. */
  kind: "equal" | "modified" | "added" | "removed";
  /** Texto en la versión A (si existe). */
  oldText?: string;
  /** Texto en la versión B (si existe). */
  newText?: string;
  /** Página aproximada donde aparece (si se puede inferir). */
  page?: number;
  /** Score de similitud 0-1 (1 = idéntico). */
  similarity: number;
}

export interface PdfDiffResult {
  versionA: PdfVersion;
  versionB: PdfVersion;
  hunks: DiffHunk[];
  /** Resumen. */
  summary: {
    equal: number;
    modified: number;
    added: number;
    removed: number;
    /** % de cambio 0-1. */
    changeRatio: number;
  };
}

export class PdfDiff {
  /**
   * Compara dos versiones. Si no hay texto extraído, devuelve un diff
   * de metadatos básico.
   */
  compare(a: PdfVersion, b: PdfVersion): PdfDiffResult {
    // Si AL MENOS UNO tiene texto extraído, intentamos diff por párrafos.
    if (a.paragraphs || b.paragraphs) {
      return this.paragraphDiff(a, b);
    }
    return this.metadataDiff(a, b);
  }

  // ─── Diff por párrafos (LCS aproximado) ─────────────────────────────

  private paragraphDiff(a: PdfVersion, b: PdfVersion): PdfDiffResult {
    const A = a.paragraphs!;
    const B = b.paragraphs!;
    const hunks: DiffHunk[] = [];
    // Algoritmo sencillo: por cada párrafo de A, buscar el más similar en B
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
    return this.makeResult(a, b, hunks);
  }

  // ─── Fallback: diff de metadatos ────────────────────────────────────

  private metadataDiff(a: PdfVersion, b: PdfVersion): PdfDiffResult {
    const hunks: DiffHunk[] = [];
    if (a.hash === b.hash) {
      hunks.push({ kind: "equal", oldText: "(mismo hash, idéntico)", newText: "(mismo hash, idéntico)", similarity: 1 });
    } else {
      hunks.push({
        kind: "modified",
        oldText: `[v${a.id}] ${a.size} bytes${a.pageCount ? `, ${a.pageCount} págs` : ""}`,
        newText: `[v${b.id}] ${b.size} bytes${b.pageCount ? `, ${b.pageCount} págs` : ""}`,
        similarity: 0.5,
      });
    }
    return this.makeResult(a, b, hunks);
  }

  private makeResult(a: PdfVersion, b: PdfVersion, hunks: DiffHunk[]): PdfDiffResult {
    const summary = {
      equal: hunks.filter((h) => h.kind === "equal").length,
      modified: hunks.filter((h) => h.kind === "modified").length,
      added: hunks.filter((h) => h.kind === "added").length,
      removed: hunks.filter((h) => h.kind === "removed").length,
      changeRatio: 0,
    };
    const total = summary.equal + summary.modified + summary.added + summary.removed;
    summary.changeRatio = total > 0 ? (summary.modified + summary.added + summary.removed) / total : 0;
    return { versionA: a, versionB: b, hunks, summary };
  }
}

// ─── Utilidades ────────────────────────────────────────────────────────

/** Similitud de Jaccard sobre palabras. */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (wa.size === 0 && wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Divide un texto en párrafos normalizados (sin líneas vacías, trimmed). */
export function extractParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 5); // párrafos significativos
}

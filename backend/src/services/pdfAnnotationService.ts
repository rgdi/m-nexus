// pdfAnnotationService.ts: highlight annotations en PDFs.
//
// v0.60 (P2.1): los usuarios pueden marcar areas o texto en PDFs
// y se persiste como una lista de highlights por documento. Backend
// expone CRUD. App renderiza y permite navegar al highlight.

import { randomUUID } from "node:crypto";

export interface PdfHighlight {
  id: string;
  documentPath: string; // path al .pdf dentro del vault
  page: number; // 1-indexed
  // v0.60: 2 formatos
  //  - text range: { start, end } caracteres en el textlayer
  //  - rect: { x, y, w, h } en coords PDF (0..1)
  format: "text" | "rect";
  text: string; // texto resaltado
  color: string; // hex color
  noteId?: string; // link opcional a una nota del vault
  createdAt: number;
  updatedAt: number;
}

class PdfAnnotationService {
  private byDoc = new Map<string, PdfHighlight[]>();

  list(documentPath: string): PdfHighlight[] {
    return this.byDoc.get(documentPath) ?? [];
  }

  add(input: Omit<PdfHighlight, "id" | "createdAt" | "updatedAt">): PdfHighlight {
    const h: PdfHighlight = {
      ...input,
      id: `hl-${randomUUID()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const list = this.byDoc.get(input.documentPath) ?? [];
    list.push(h);
    this.byDoc.set(input.documentPath, list);
    return h;
  }

  update(id: string, documentPath: string, patch: Partial<Omit<PdfHighlight, "id" | "documentPath" | "createdAt">>): PdfHighlight | null {
    const list = this.byDoc.get(documentPath);
    if (!list) return null;
    const idx = list.findIndex(h => h.id === id);
    if (idx < 0) return null;
    list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
    return list[idx];
  }

  remove(id: string, documentPath: string): boolean {
    const list = this.byDoc.get(documentPath);
    if (!list) return false;
    const before = list.length;
    this.byDoc.set(documentPath, list.filter(h => h.id !== id));
    return this.byDoc.get(documentPath)!.length < before;
  }

  /// v0.60: exporta todos los highlights como markdown.
  exportAsMarkdown(documentPath: string): string {
    const hs = this.list(documentPath);
    if (hs.length === 0) return '';
    const buf: string[] = [`# Highlights: ${documentPath}`, ''];
    let lastPage = -1;
    for (const h of hs) {
      if (h.page !== lastPage) {
        buf.push(`## Pagina ${h.page}`);
        lastPage = h.page;
      }
      buf.push(`> ${h.text}`);
      if (h.noteId) buf.push(`- Linked: [[${h.noteId}]]`);
      buf.push('');
    }
    return buf.join('\n');
  }
}

let _instance: PdfAnnotationService | null = null;
export function getPdfAnnotationService(): PdfAnnotationService {
  if (!_instance) _instance = new PdfAnnotationService();
  return _instance;
}

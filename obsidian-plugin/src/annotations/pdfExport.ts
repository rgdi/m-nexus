// v0.27: Export de la nota con anotaciones a PDF.
// Combina el texto markdown + las anotaciones (overlay) en un PDF.

import type { App, TFile } from "obsidian";
import type { Annotation, SpatialAnnotation } from "./noteAnnotations";

export interface PDFExportOptions {
  /** Anotaciones a incluir. */
  annotations: Annotation[];
  /** Tamaño de página. */
  pageSize: "A4" | "Letter" | "A5";
  /** Orientación. */
  orientation: "portrait" | "landscape";
  /** Si incluye sticky notes. */
  includeStickies: boolean;
  /** Si incluye el contenido de la nota. */
  includeNoteContent: boolean;
  /** Si incluye los trazos de freehand. */
  includeFreehand: boolean;
  /** Título del PDF. */
  title: string;
}

const PAGE_DIMENSIONS: Record<string, { w: number; h: number }> = {
  A4: { w: 595, h: 842 }, // pt (A4 = 210x297mm)
  Letter: { w: 612, h: 792 },
  A5: { w: 420, h: 595 },
};

export class PDFExporter {
  constructor(private app: App) {}

  /**
   * Exporta la nota con anotaciones a PDF usando jsPDF-like API básica.
   * Devuelve un Blob con el PDF.
   */
  async exportToPDF(file: TFile, options: PDFExportOptions): Promise<Blob> {
    const content = await this.app.vault.read(file);
    const page = PAGE_DIMENSIONS[options.pageSize];
    const width = options.orientation === "portrait" ? page.w : page.h;
    const height = options.orientation === "portrait" ? page.h : page.w;

    // Construir el PDF manualmente (formato simple)
    const lines: string[] = [];
    const annotationsToRender = options.annotations.filter((a) => {
      if (a.type === "freehand" && !options.includeFreehand) return false;
      return true;
    });

    if (options.includeNoteContent) {
      lines.push(`# ${options.title}`);
      lines.push("");
      const noteLines = content.split("\n");
      for (const line of noteLines) {
        lines.push(this.escapePdfString(line));
      }
      lines.push("");
    }

    // Anotaciones como texto descriptivo
    if (annotationsToRender.length > 0) {
      lines.push("");
      lines.push("--- ANOTACIONES ---");
      for (const ann of annotationsToRender) {
        lines.push(`• ${ann.type}${ann.text ? `: ${ann.text}` : ""} [z:${ann.zIndex}]`);
      }
    }

    // Generar PDF simple (estructura básica)
    const pdfContent = this.buildSimplePdf(lines, annotationsToRender, width, height, file.path);
    return new Blob([pdfContent], { type: "application/pdf" });
  }

  private escapePdfString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  /**
   * Construye un PDF mínimo válido.
   * Estructura: header, body (con texto + SVG paths), xref, trailer.
   */
  private buildSimplePdf(
    lines: string[],
    annotations: Annotation[],
    width: number,
    height: number,
    filename: string,
  ): string {
    const objects: string[] = [];
    const xref: number[] = [];
    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";

    // Object 1: Catalog
    xref.push(this.utf8Length(pdf));
    objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

    // Object 2: Pages
    let pagesObj = "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
    xref.push(xref[xref.length - 1] + this.utf8Length(objects[0]));
    objects.push(pagesObj);

    // Object 3: Page
    const pageObj = "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + width + " " + height + "] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n";
    xref.push(xref[xref.length - 1] + this.utf8Length(objects[1]));
    objects.push(pageObj);

    // Object 4: Content stream (texto + líneas SVG)
    let content = "BT /F1 10 Tf 50 " + (height - 50) + " Td\n";
    let yOffset = 0;
    for (const line of lines) {
      if (yOffset > height - 100) break;
      content += `(${this.escapePdfString(line)}) Tj 0 -12 Td\n`;
      yOffset += 12;
    }
    content += "ET\n";

    // Dibujar anotaciones freehand
    for (const ann of annotations) {
      if (ann.type === "freehand" && "points" in ann && ann.points) {
        const pts = ann.points;
        if (pts.length > 1) {
          content += `${this.utf8Length(content)} 0 obj\n<< /Length ${this.utf8Length(content)} >>\nstream\n`;
        }
      }
    }

    const contentLength = this.utf8Length(content);
    const contentObj = `4 0 obj\n<< /Length ${contentLength} >>\nstream\n${content}endstream\nendobj\n`;
    xref.push(xref[xref.length - 1] + this.utf8Length(objects[2]));
    objects.push(contentObj);

    // Object 5: Font
    const fontObj = "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n";
    xref.push(xref[xref.length - 1] + this.utf8Length(objects[3]));
    objects.push(fontObj);

    // Concatenar todo
    for (const obj of objects) {
      pdf += obj;
    }

    // xref
    const xrefPos = this.utf8Length(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const pos of xref) {
      pdf += String(pos).padStart(10, "0") + " 00000 n \n";
    }

    // Trailer
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${this.escapePdfString(filename)}) >> >>\nstartxref\n${xrefPos}\n%%EOF\n`;

    return pdf;
  }

  private utf8Length(s: string): number {
    return Buffer.byteLength(s, "utf8");
  }
}

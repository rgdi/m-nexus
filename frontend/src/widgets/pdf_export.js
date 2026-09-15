/* ============================================================
 * pdf_export.js — exporta una nota como PDF con strokes + texto.
 * v1.7.3 — sin dependencias externas (jsPDF inline mini).
 *
 * Render:
 *   - Texto del body en fuente sans-serif.
 *   - Strokes vectoriales como paths SVG-like en PDF.
 *   - Multi-página: cada page del note es 1 página PDF.
 *
 * Implementación minimalista — NO usa jsPDF. Crea PDF básico
 * con streams + páginas + paths. Suficiente para export real.
 * ============================================================ */

/**
 * downloadNoteAsPDF — genera y descarga el PDF de la nota.
 */
export async function downloadNoteAsPDF(note) {
  const pdfBytes = buildPDF(note);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(note.title || "note").replace(/[^a-z0-9]+/gi, "_")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================
 * PDF builder minimalista
 * ============================================================ */
function buildPDF(note) {
  const pages = (note.pages && note.pages.length > 0) ? note.pages : [{ strokes: [], placeholders: [] }];
  const pageW = 595; // A4 portrait @ 72dpi
  const pageH = 842;
  const margin = 50;

  const objects = []; // array of strings (PDF objects)
  const xref = []; // byte offsets
  let byteOffset = 0;
  function push(obj) {
    xref.push(byteOffset);
    const str = `${objects.length + 1} 0 obj\n${obj}\nendobj\n`;
    objects.push(str);
    byteOffset += new TextEncoder().encode(str).length;
  }

  // 1. catalog
  push("<< /Type /Catalog /Pages 2 0 R >>");
  // 2. pages (placeholder, fix later)
  const pagesObjIdx = objects.length + 1;
  push("<< /Type /Pages /Kids [] /Count 0 >>");
  const pageRefs = [];
  // for each note page: build content stream + page object
  pages.forEach((p, idx) => {
    const contentStream = buildContentStream(p, note, pageW, pageH, margin);
    // Content stream object
    const streamObjIdx = objects.length + 1;
    const stream = `<< /Length ${new TextEncoder().encode(contentStream).length} >>\nstream\n${contentStream}\nendstream`;
    push(stream);
    // Page object
    const pageObjIdx = objects.length + 1;
    pageRefs.push(pageObjIdx);
    push(`<< /Type /Page /Parent ${pagesObjIdx} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R >> >> /Contents ${streamObjIdx} 0 R >>`);
  });

  // 3. Update pages object with real Kids
  objects[pagesObjIdx - 1] = `${pagesObjIdx} 0 obj\n<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>\nendobj\n`;

  // 4. Font
  const fontObjIdx = objects.length + 1;
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  // build the full PDF
  let pdf = "%PDF-1.4\n";
  let currentOffset = new TextEncoder().encode(pdf).length;
  // adjust offsets since objects store their own offsets incorrectly
  const realXref = [];
  objects.forEach((obj) => {
    realXref.push(currentOffset);
    pdf += obj;
    currentOffset += new TextEncoder().encode(obj).length;
  });
  // xref table
  const xrefStart = currentOffset;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of realXref) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

function buildContentStream(page, note, pageW, pageH, margin) {
  const lines = [];
  // title
  lines.push("BT");
  lines.push("/F1 18 Tf");
  lines.push(`${margin} ${pageH - margin} Td`);
  lines.push(`(${pdfEscape(note.title || "Note")}) Tj`);
  lines.push("ET");
  // subtitle
  lines.push("BT");
  lines.push("/F1 10 Tf");
  lines.push(`0 -16 Td`);
  lines.push(`(${pdfEscape(`${note.subject || "general"} · ${new Date(note.updatedAt || Date.now()).toLocaleDateString()}`)}) Tj`);
  lines.push("ET");
  // body text (wrap at ~90 chars)
  let cursorY = pageH - margin - 50;
  lines.push("BT");
  lines.push("/F1 11 Tf");
  lines.push(`${margin} ${cursorY} Td`);
  const body = (note.body || "").replace(/\s+/g, " ").slice(0, 1500);
  const wrapped = wrap(body, 90);
  wrapped.forEach((ln, i) => {
    if (i === 0) {
      lines.push(`(${pdfEscape(ln)}) Tj`);
    } else {
      lines.push(`0 -14 Td`);
      lines.push(`(${pdfEscape(ln)}) Tj`);
    }
  });
  lines.push("ET");

  // strokes (vector paths)
  const strokes = page.strokes || [];
  strokes.forEach((s) => {
    if (!s.points || s.points.length < 2) return;
    // map from canvas size (assume 800x600) to PDF page
    const sx = (pageW - margin * 2) / 800;
    const sy = (pageH - margin * 2) / 600;
    lines.push(`${colorToPdf(s.color)} ${s.size * 0.5} w`);
    lines.push(`${s.alpha ?? 1} g`);
    lines.push(`${margin + s.points[0].x * sx} ${margin + s.points[0].y * sy} m`);
    for (let i = 1; i < s.points.length; i++) {
      lines.push(`${margin + s.points[i].x * sx} ${margin + s.points[i].y * sy} l`);
    }
    lines.push("S");
  });
  return lines.join("\n");
}

function wrap(text, width) {
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur += " " + w;
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

function pdfEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function colorToPdf(color) {
  if (!color || color.startsWith("var")) return "0.1 0.1 0.1";
  // hex → rgb 0-1
  if (color.startsWith("#")) {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`;
  }
  return "0.1 0.1 0.1 RG";
}

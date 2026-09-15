/* ============================================================
 * pdf_export.js — exporta una nota como PDF con strokes + texto +
 * flashcards embebidas + attachments list.
 * v2.1.4 — añade section "Embedded flashcards" + lista de attachments.
 * ============================================================ */

import { getAttachments } from "./file_attachments.js";

/**
 * downloadNoteAsPDF — genera y descarga el PDF de la nota.
 * @param note nota
 * @param opts.flashcards array de cards (opcional, se incluyen al final)
 */
export async function downloadNoteAsPDF(note, opts = {}) {
  const pdfBytes = buildPDF(note, opts);
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
function buildPDF(note, opts = {}) {
  const pages = (note.pages && note.pages.length > 0) ? note.pages : [{ strokes: [], placeholders: [] }];
  const pageW = 595; // A4 portrait @ 72dpi
  const pageH = 842;
  const margin = 50;

  const objects = []; // array of strings (PDF objects)
  let byteOffset = 0;
  function push(obj) {
    const str = `${objects.length + 1} 0 obj\n${obj}\nendobj\n`;
    objects.push(str);
    byteOffset += new TextEncoder().encode(str).length;
  }

  push("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesObjIdx = objects.length + 1;
  push("<< /Type /Pages /Kids [] /Count 0 >>");
  const pageRefs = [];
  pages.forEach((p) => {
    const contentStream = buildContentStream(p, note, pageW, pageH, margin);
    const streamObjIdx = objects.length + 1;
    const stream = `<< /Length ${new TextEncoder().encode(contentStream).length} >>\nstream\n${contentStream}\nendstream`;
    push(stream);
    const pageObjIdx = objects.length + 1;
    pageRefs.push(pageObjIdx);
    push(`<< /Type /Page /Parent ${pagesObjIdx} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R >> >> /Contents ${streamObjIdx} 0 R >>`);
  });
  objects[pagesObjIdx - 1] = `${pagesObjIdx} 0 obj\n<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>\nendobj\n`;
  const fontObjIdx = objects.length + 1;
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  // v2.1.4: extra page with attachments + flashcards
  const atts = getAttachments(note.id) || [];
  const flashList = opts.flashcards || [];
  if (atts.length > 0 || flashList.length > 0) {
    const contentStream = buildExtrasContentStream(atts, flashList, note, pageW, pageH, margin);
    const streamObjIdx = objects.length + 1;
    const stream = `<< /Length ${new TextEncoder().encode(contentStream).length} >>\nstream\n${contentStream}\nendstream`;
    push(stream);
    const pageObjIdx = objects.length + 1;
    pageRefs.push(pageObjIdx);
    push(`<< /Type /Page /Parent ${pagesObjIdx} 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 4 0 R >> >> /Contents ${streamObjIdx} 0 R >>`);
    objects[pagesObjIdx - 1] = `${pagesObjIdx} 0 obj\n<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageRefs.length} >>\nendobj\n`;
  }

  let pdf = "%PDF-1.4\n";
  let currentOffset = new TextEncoder().encode(pdf).length;
  const realXref = [];
  objects.forEach((obj) => {
    realXref.push(currentOffset);
    pdf += obj;
    currentOffset += new TextEncoder().encode(obj).length;
  });
  const xrefStart = currentOffset;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const off of realXref) {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

/**
 * buildExtrasContentStream — v2.1.4 attachments + flashcards.
 */
function buildExtrasContentStream(atts, flashes, note, pageW, pageH, margin) {
  const lines = [];
  let y = pageH - margin;
  lines.push("BT");
  lines.push("/F1 16 Tf");
  lines.push(`${margin} ${y} Td`);
  lines.push(`(${pdfEscape(`Extras - ${note.title || "Note"})`)}) Tj`);
  lines.push("ET");
  y -= 30;
  if (atts.length > 0) {
    lines.push("BT");
    lines.push("/F1 12 Tf");
    lines.push(`${margin} ${y} Td`);
    lines.push(`(Attachments (${atts.length}):) Tj`);
    lines.push("ET");
    y -= 16;
    for (const a of atts) {
      const tagInfo = a.occlusion?.tags?.length ? `, ${a.occlusion.tags.length} occ tags` : "";
      const apprInfo = a.occlusion?.approved ? ", approved" : (a.occlusion ? ", unapproved" : "");
      lines.push("BT");
      lines.push("/F1 10 Tf");
      lines.push(`${margin + 10} ${y} Td`);
      lines.push(`(${pdfEscape(`- ${a.name} (${(a.size / 1024).toFixed(0)} KB, ${a.type}${apprInfo}${tagInfo})`)}) Tj`);
      lines.push("ET");
      y -= 14;
      if (y < 60) break;
    }
    y -= 10;
  }
  if (flashes.length > 0 && y > 60) {
    lines.push("BT");
    lines.push("/F1 12 Tf");
    lines.push(`${margin} ${y} Td`);
    lines.push(`(Embedded flashcards (${flashes.length}):) Tj`);
    lines.push("ET");
    y -= 16;
    for (const f of flashes) {
      lines.push("BT");
      lines.push("/F1 10 Tf");
      lines.push(`${margin + 10} ${y} Td`);
      lines.push(`(${pdfEscape(`Q: ${f.front} -> A: ${f.back}`)}) Tj`);
      lines.push("ET");
      y -= 14;
      if (y < 50) break;
    }
  }
  return lines.join("\n");
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

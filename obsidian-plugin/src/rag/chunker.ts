// RAG Chunker: divide una nota markdown en chunks semánticamente coherentes.
// Estrategia: respetar headers como boundaries; si una sección es muy larga,
// subdividirla por párrafos con overlap.

import { TFile } from "obsidian";

export interface ChunkInput {
  text: string;
  notePath: string;
  noteTitle: string;
}

export interface RawChunk {
  text: string;
  section?: string;
  chunkIndex: number;
}

export interface ChunkOptions {
  /** Tamaño objetivo del chunk en caracteres. */
  targetSize: number;
  /** Overlap entre chunks consecutivos (caracteres). */
  overlap: number;
  /** Si se debe respetar la estructura de headers. */
  respectHeaders: boolean;
  /** Longitud mínima para que un chunk sea indexado. */
  minLength: number;
}

const DEFAULT_OPTS: ChunkOptions = {
  targetSize: 800,
  overlap: 100,
  respectHeaders: true,
  minLength: 80,
};

/** Divide una nota completa en chunks. */
export function chunkNote(file: TFile, content: string, options: Partial<ChunkOptions> = {}): RawChunk[] {
  const opts: ChunkOptions = { ...DEFAULT_OPTS, ...options };
  const stripped = stripFrontmatter(content);
  if (opts.respectHeaders) {
    return chunkByHeaders(stripped, file.basename, opts);
  }
  return chunkBySize(stripped, file.basename, undefined, opts);
}

function stripFrontmatter(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? content.slice(m[0].length) : content;
}

function chunkByHeaders(text: string, noteTitle: string, opts: ChunkOptions): RawChunk[] {
  const lines = text.split(/\r?\n/);
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } = { heading: "", body: [] };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      if (current.body.length > 0 || current.heading) sections.push(current);
      current = { heading: h[2].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length > 0 || current.heading) sections.push(current);

  const out: RawChunk[] = [];
  let globalIdx = 0;
  for (const sec of sections) {
    const fullText = sec.body.join("\n").trim();
    if (fullText.length < opts.minLength && !sec.heading) continue;
    if (fullText.length <= opts.targetSize) {
      out.push({ text: withTitle(sec.heading || noteTitle, fullText), section: sec.heading, chunkIndex: globalIdx++ });
    } else {
      // Subdividir la sección por tamaño
      const sub = chunkBySize(fullText, noteTitle, sec.heading, opts);
      for (const s of sub) {
        out.push({ ...s, chunkIndex: globalIdx++ });
      }
    }
  }
  return out;
}

function chunkBySize(text: string, noteTitle: string, section: string | undefined, opts: ChunkOptions): RawChunk[] {
  const out: RawChunk[] = [];
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= opts.targetSize) {
    out.push({ text: withTitle(section || noteTitle, cleaned), section, chunkIndex: 0 });
    return out;
  }
  let start = 0;
  let idx = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + opts.targetSize, cleaned.length);
    // Intentar cortar en un límite de frase
    if (end < cleaned.length) {
      const slice = cleaned.slice(start, end);
      const lastDot = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"), slice.lastIndexOf("; "));
      if (lastDot > opts.targetSize * 0.5) {
        end = start + lastDot + 1;
      }
    }
    const piece = cleaned.slice(start, end).trim();
    if (piece.length >= opts.minLength) {
      out.push({ text: withTitle(section || noteTitle, piece), section, chunkIndex: idx++ });
    }
    if (end >= cleaned.length) break;
    start = Math.max(end - opts.overlap, start + 1);
  }
  return out;
}

function withTitle(heading: string, body: string): string {
  if (!heading) return body;
  return `${heading}\n\n${body}`;
}

/** Hash simple para invalidación (no criptográfico, solo para detectar cambios). */
export function hashText(text: string): string {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// resourceIndex.ts — el índice de recursos del profesor, con la página
// exacta de donde salió cada frase.
//
// v2.38.9
//
// Para poder decir "esto no está en el PowerPoint" hay que saber qué sí
// está, y para poder señalar hay que saber dónde. Un índice que solo
// guarda texto no sirve para ninguna de las dos cosas: el usuario
// necesita que el sistema le abra el documento en la diapositiva 14, no
// que le diga "no lo encontré".
//
// Por eso cada trozo del índice lleva su procedencia completa:
//
//   { docId, page, kind, heading, lineStart, lineEnd, text }
//
// Y por eso la extracción no es "el PDF a texto": es "el PDF a trozos,
// cada uno con la página y las líneas en las que cae". Un PDF sin
// páginas numeradas —texto plano pegado en uno— es peor que nada,
// porque daría la sensación de que se ha buscado en el sitio.
//
// Formatos: PDF (por texto embebido, página a página), PPTX y DOCX
// (que son zip: se leen por dentro con su XML). Lo que no se puede leer
// —un PDF escaneado sin capa de texto— se dice, no se rellena.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** De dónde sale un trozo. Es lo que permite abrir el documento. */
export interface Provenance {
  docId: string;
  /** "Genética.pptx" */
  fileName: string;
  /** Página de un PDF, diapositiva de un PPTX, o 0 si no tiene. */
  page: number;
  /** Texto de la página en un PDF; título de la diapositiva en un PPTX;
   *  encabezado del documento en un DOCX. */
  kind: "pdf" | "pptx" | "docx" | "txt" | "unknown";
  /** Rótulo visible para el usuario: "diapositiva 14", "pág. 3". */
  locator: string;
  /** Líneas del texto extraído que cubre este trozo. */
  lineStart: number;
  lineEnd: number;
}

export interface IndexedChunk {
  id: string;
  docId: string;
  text: string;
  /** Tokens normalizados, para comparar sin que estorben tildes ni mayúsculas. */
  norm: string;
  provenance: Provenance;
  /** Longitud en palabras, para puntuar cobertura sin favoritismos. */
  words: number;
}

export interface IndexedDoc {
  id: string;
  fileName: string;
  kind: Provenance["kind"];
  /** Páginas o diapositivas detectadas. */
  pages: number;
  chunks: IndexedChunk[];
  indexedAt: number;
  /** Si no se pudo leer, se dice y se explica por qué. */
  warning?: string;
  bytes: number;
}

// ---------------------------------------------------------------------------
// Normalización: comparar "CFTR" con "C.F.T.R."
// ---------------------------------------------------------------------------

/**
 * Minúsculas, sin tildes, sin puntuación y con espacios colapsados.
 *
 * Un PowerPoint y una transcripción nunca van a coincidir literalmente:
 * uno pone "mucoviscidosis" y el otro "muco-viscidosis". Comparar
 * crudo daría cero cobertura en cualquier temario de medicina, que es
 * justo donde se usa esto.
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // v2.38.9 — los puntos entre letras NO son separadores. "C.F.T.R."
    // se convierte en "c f t r" y "CFTR" en "cftr": dos palabras
    // distintas, así que un PowerPoint que escribe el gen con puntos y
    // una transcripción que lo dice sin ellos nunca se cruzaban. Y eso
    // pasa en todos los temarios de genética, que es justo donde esto
    // se usa. Un punto entre una letra y otra se borra; el resto, no.
    .replace(/\b(?:[a-z]\.){2,}[a-z]\b/g, (m) => m.replace(/\./g, ""))
    .replace(/[\u00b7\u2022\u2013\u2014]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palabras que no distinguen un tema de otro. Sin esto, "de" y "la"
 * cuentan como cobertura y un PowerPoint de cualquier cosa parece
 * cubrir una clase entera.
 */
const STOP = new Set(
  ("de la el los las un una unos unas y o a al en por para con que se del lo su sus es son " +
    "como mas pero este esta esto these those the of to in and or is are was were be been " +
    "muy ya no si sí cuando donde sobre entre tras desde hasta hacia asi aqui tambien " +
    "nos nosotros nuestro nuestra v our you your it its")
    .split(/\s+/)
    .filter(Boolean),
);

export function contentWords(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter((w) => w.length > 3 && !STOP.has(w))
    // Un número de cuatro o más cifras casi nunca es contenido: son
    // números de página, años o códigos. Contaban como palabra y
    // hacían que cualquier diapositiva con un "2024" pareciera
    // hablar de lo que fuera.
    .filter((w) => !/^\d{4,}$/.test(w));
}

// ---------------------------------------------------------------------------
// Extracción
// ---------------------------------------------------------------------------

/** Une los trozos de texto de una página en líneas con número. */
function linesOf(parts: string[]): string[] {
  const raw = parts.filter(Boolean).join(" ").replace(/[ \t]+/g, " ");
  return raw
    .split(/\r?\n|\s{2,}|\.\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function chunkFromLines(docId: string, fileName: string, kind: Provenance["kind"], page: number, lines: string[]): IndexedChunk[] {
  const out: IndexedChunk[] = [];
  const size = kind === "pptx" ? 3 : 4; // viñetas pequeñas en diapositivas
  for (let i = 0; i < lines.length; i += size) {
    const slice = lines.slice(i, i + size);
    const text = slice.join(" ").trim();
    if (!text) continue;
    const words = contentWords(text);
    // Un trozo de dos palabras no sirve ni para citar ni para comparar.
    if (words.length < 2) continue;
    out.push({
      id: `${docId}:${page}:${i}`,
      docId,
      text,
      norm: normalise(text),
      provenance: {
        docId,
        fileName,
        page,
        kind,
        locator: kind === "pptx" ? `diapositiva ${page + 1}` : kind === "pdf" ? `pág. ${page + 1}` : "",
        lineStart: i + 1,
        lineEnd: i + slice.length,
      },
      words: words.length,
    });
  }
  return out;
}

/**
 * PDF: se leen los flujos de contenido de cada página. Sin pdf.js no se
 * descomprime el contenido comprimido, así que el extractor lee lo que
 * se puede y avisa del resto en vez de devolver vacío en silencio.
 */
async function extractPdf(buf: Buffer, docId: string, fileName: string): Promise<{ pages: number; texts: string[][]; warning?: string }> {
  const raw = buf.toString("latin1");
  const pageTexts: string[][] = [];
  // Objetos de página en el orden del documento.
  const pageMatches = [...raw.matchAll(/\/Type\s*\/Page[^s]/g)];
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((m) => m[1]);

  let extracted = 0;
  for (const m of streams) {
    let body = m;
    // Los flujos con compresión no se descomprimen aquí; se detecta y
    // se marca la página como no leída.
    const text = (() => {
      try {
        const zlib = require("node:zlib") as typeof import("node:zlib");
        if (looksCompressed(body)) body = zlib.inflateSync(Buffer.from(body, "latin1")).toString("latin1");
      } catch {
        return null;
      }
      const parts = [...body.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)].map((t) =>
        t[0].replace(/\)\s*Tj$/, "").replace(/^\(/, "").replace(/\\([()\\])/g, "$1"),
      );
      return parts.join("");
    })();
    pageTexts.push(text ? text.split(/(?<=[.!?])\s+/) : []);
    if (text && text.trim()) extracted++;
  }

  const warning =
    extracted === 0 && streams.length
      ? "No se ha podido leer el texto del PDF: está comprimido o escaneado sin capa de texto. " +
        "Hace falta pasarlo por OCR para poder compararlo."
      : undefined;
  return { pages: pageMatches.length || pageTexts.length, texts: pageTexts, warning };
}

function looksCompressed(s: string): boolean {
  const head = s.slice(0, 200);
  return head.includes("/FlateDecode") || head.includes("/Filter");
}

/** DOCX: word/document.xml, párrafos marcados con <w:p>. */
function extractDocx(buf: Buffer): { parts: string[]; warning?: string } {
  const zip = new AdmZip(buf);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return { parts: [], warning: "El .docx no tiene word/document.xml: ¿es un archivo de Word de verdad?" };
  const xml = entry.getData().toString("utf8");
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)].map((m) =>
    [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(""),
  );
  const clean = paras.map((p) =>
    p.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim(),
  ).filter(Boolean);
  return { parts: clean, warning: clean.length ? undefined : "El .docx no tiene texto: solo imágenes o tablas vacías." };
}

/** PPTX: cada diapositiva es un slideN.xml. El texto sale de <a:t>. */
function extractPptx(buf: Buffer): { slides: string[][]; warning?: string } {
  const zip = new AdmZip(buf);
  const names = zip.getEntries().map((e) => e.entryName);
  const slides = names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .map((n) => {
      const num = Number(n.match(/slide(\d+)\.xml/)![1]);
      const xml = zip.getEntry(n)!.getData().toString("utf8");
      const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
        m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(),
      );
      return [num, runs.filter(Boolean)] as [number, string[]];
    })
    .sort((a, b) => a[0] - b[0])
    .map(([, runs]) => runs);
  const warning = slides.length ? undefined : "El .pptx no tiene diapositivas legibles.";
  return { slides, warning };
}

// ---------------------------------------------------------------------------
// El índice
// ---------------------------------------------------------------------------

export async function indexResource(
  docId: string,
  fileName: string,
  bytes: Buffer,
): Promise<IndexedDoc> {
  const ext = (fileName.split(".").pop() || "").toLowerCase();
  let chunks: IndexedChunk[] = [];
  let pages = 0;
  let warning: string | undefined;

  try {
    if (ext === "pdf") {
      const r = await extractPdf(bytes, docId, fileName);
      pages = r.pages;
      warning = r.warning;
      r.texts.forEach((parts, i) => {
        chunks.push(...chunkFromLines(docId, fileName, "pdf", i, linesOf(parts)));
      });
    } else if (ext === "pptx" || ext === "ppt") {
      const r = extractPptx(bytes);
      warning = r.warning;
      pages = r.slides.length;
      r.slides.forEach((runs, i) => {
        chunks.push(...chunkFromLines(docId, fileName, "pptx", i, linesOf(runs)));
      });
    } else if (ext === "docx" || ext === "doc") {
      const r = extractDocx(bytes);
      warning = r.warning;
      pages = 1;
      chunks = chunkFromLines(docId, fileName, "docx", 0, r.parts);
    } else if (ext === "txt" || ext === "md") {
      const lines = bytes.toString("utf8").split(/\r?\n/);
      pages = Math.max(1, Math.ceil(lines.length / 40));
      chunks = chunkFromLines(docId, fileName, "txt", 0, lines.map((l) => l.trim()).filter(Boolean));
    } else {
      return {
        id: docId,
        fileName,
        kind: "unknown",
        pages: 0,
        chunks: [],
        indexedAt: Date.now(),
        bytes: bytes.length,
        warning: `No sé leer .${ext}. Se indexa PDF, PPTX, DOCX y texto plano.`,
      };
    }
  } catch (e) {
    return {
      id: docId,
      fileName,
      kind: "unknown",
      pages: 0,
      chunks: [],
      indexedAt: Date.now(),
      bytes: bytes.length,
      warning: `No se pudo abrir: ${(e as Error).message}`,
    };
  }

  return { id: docId, fileName, kind: chunks.length ? (ext as IndexedDoc["kind"]) : "unknown", pages, chunks, indexedAt: Date.now(), warning, bytes: bytes.length };
}

// ---------------------------------------------------------------------------
// Cobertura
// ---------------------------------------------------------------------------

export interface CoverageHit {
  docId: string;
  fileName: string;
  locator: string;
  page: number;
  lineStart: number;
  lineEnd: number;
  quote: string;
  /** 0..1: cuánto de la frase de la transcripción aparece en el recurso. */
  score: number;
}

export interface CoverageGap {
  /** Frase de la clase que no aparece en ningún recurso. */
  text: string;
  /** Palabras que no se han encontrado en ningún sitio. */
  missing: string[];
  /** Dónde sí se habla de eso, aunque con otras palabras. */
  nearest: CoverageHit | null;
  severity: "critical" | "partial" | "trivial";
}

export interface DocCoverage {
  docId: string;
  fileName: string;
  pages: number;
  covered: number;
  total: number;
  ratio: number;
  warning?: string;
}

/**
 * Cuánto de una frase aparece en un documento.
 *
 * Es coincidencia de palabras de contenido, noEmbeddings: tiene que
 * funcionar sin modelo y sin red, porque en cuanto depende de un LLM
 * esto deja de ser una función y pasa a ser una apuesta.
 */
export function scoreAgainst(text: string, doc: IndexedDoc, corpus?: Set<string>): CoverageHit | null {
  const words = contentWords(text);
  if (words.length < 2) return null;
  const want = new Set(words);
  // v2.38.9 — dos preguntas distintas con dos medidas distintas.
  //
  // "¿Está esto en el material?" necesita el denominador completo: si
  // faltan palabras, es un hueco.
  //
  // "¿Dónde se parece esto?" no. Una frase de clase mezcla contenido y
  // metatexto —"el CFTR está en el cromosoma 7, que es lo que vimos al
  // principio, aunque en la última diapositiva no aparece"— y la mitad
  // de las palabras no puede estar en ningún PowerPoint porque hablan
  // de las diapositivas, no del tema. Contarlas en contra hundía el
  // parecido a 0.11 y el sistema decía "no lo encontré" de algo que
  // tenía la respuesta a dos líneas. Con `corpus` solo cuentan las
  // palabras que existen en algún sitio del material.
  const target = corpus ? new Set([...want].filter((w) => corpus.has(w))) : want;
  if (corpus && target.size < 2) return null;
  let best: CoverageHit | null = null;

  for (const c of doc.chunks) {
    const have = new Set(contentWords(c.text));
    if (!have.size) continue;
    let hit = 0;
    for (const w of target) if (have.has(w)) hit++;
    const score = target.size ? hit / target.size : 0;
    if (score >= 0.34 && (!best || score > best.score)) {
      best = {
        docId: doc.id,
        fileName: doc.fileName,
        locator: c.provenance.locator || `${c.provenance.kind} ${c.provenance.page + 1}`,
        page: c.provenance.page,
        lineStart: c.provenance.lineStart,
        lineEnd: c.provenance.lineEnd,
        quote: c.text.slice(0, 220),
        score,
      };
    }
  }
  return best;
}

export interface CoverageReport {
  /** Lo que dijo la clase y no está en el material. */
  missing: CoverageGap[];
  /** Lo que está en el material y no se ha visto en la clase. */
  unreviewed: CoverageHit[];
  perDoc: DocCoverage[];
  /** Frases de la clase que sí están, para no tener que releer todo. */
  covered: number;
  total: number;
  ratio: number;
}

/**
 * El cruce completo: transcripción contra el índice.
 *
 * Se hace en dos direcciones porque las dos preguntas son distintas y
 * las dos importan. "Lo que dijo la clase y no está en el PowerPoint" es
 * un problema del material. "Lo que está en el PowerPoint y nadie ha
 * comentado" es un problema delTemario, y suele ser donde se cuela lo
 * que se pregunta en el examen.
 */
export function crossReference(
  transcript: string,
  docs: IndexedDoc[],
  opts: { minScore?: number; maxGaps?: number } = {},
): CoverageReport {
  const minScore = opts.minScore ?? 0.34;
  const maxGaps = opts.maxGaps ?? 60;

  // Vocabulario de todo el material, para el segundo criterio.
  const corpus = new Set<string>();
  for (const d of docs) for (const c of d.chunks) for (const w of contentWords(c.norm)) corpus.add(w);

  const sentences = transcript
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => contentWords(s).length >= 3);

  const missing: CoverageGap[] = [];
  const seenInClass = new Set<string>();
  let covered = 0;

  for (const s of sentences) {
    let bestHit: CoverageHit | null = null;
    let bestDoc: IndexedDoc | null = null;
    for (const d of docs) {
      const hit = scoreAgainst(s, d);
      if (hit && (!bestHit || hit.score > bestHit.score)) {
        bestHit = hit;
        bestDoc = d;
      }
    }
    // Segunda pasada, solo para señalar dónde se parece. Un hueco de
    // verdad no tendrá referencia y se dirá sin ella; uno que está
    // "cerca pero no en el material" sí, y eso es lo que se quiere.
    let nearest: CoverageHit | null = null;
    if (!bestHit || bestHit.score < minScore) {
      for (const d of docs) {
        const hit = scoreAgainst(s, d, corpus);
        if (hit && (!nearest || hit.score > nearest.score)) nearest = hit;
      }
    }
    if (bestHit && bestHit.score >= minScore) {
      covered++;
      // Para lo "no visto": las partes del recurso que la clase no tocó.
      for (const c of bestDoc!.chunks) {
        for (const w of contentWords(s)) {
          if (new RegExp(`\\b${w}`).test(c.norm)) seenInClass.add(c.id);
        }
      }
      continue;
    }
    const want = new Set(contentWords(s));
    const anyHit = bestHit;
    // El vocabulario de todo el material, para distinguir "no está en
    // ninguna parte" de "está repartido en dos sitios".
    const anywhere = new Set<string>();
    for (const d of docs) for (const c of d.chunks) for (const w of contentWords(c.norm)) anywhere.add(w);
    const missingWords = [...want].filter((w) => !anywhere.has(w));
    if (!missingWords.length) continue; // estaba pero repartido: no es un hueco
    missing.push({
      text: s.slice(0, 260),
      missing: missingWords.slice(0, 8),
      nearest: nearest ?? anyHit,
      severity: missingWords.length >= 6 ? "critical" : missingWords.length >= 3 ? "partial" : "trivial",
    });
  }

  const perDoc: DocCoverage[] = docs.map((d) => {
    const hit = d.chunks.filter((c) => seenInClass.has(c.id)).length;
    return {
      docId: d.id,
      fileName: d.fileName,
      pages: d.pages,
      covered: hit,
      total: d.chunks.length,
      ratio: d.chunks.length ? hit / d.chunks.length : 0,
      warning: d.warning,
    };
  });

  const unreviewed: CoverageHit[] = [];
  for (const d of docs) {
    for (const c of d.chunks) {
      if (seenInClass.has(c.id)) continue;
      const w = contentWords(c.text);
      if (w.length < 4) continue;
      unreviewed.push({
        docId: d.id,
        fileName: d.fileName,
        locator: c.provenance.locator,
        page: c.provenance.page,
        lineStart: c.provenance.lineStart,
        lineEnd: c.provenance.lineEnd,
        quote: c.text.slice(0, 220),
        score: 0,
      });
    }
  }

  const total = sentences.length;
  return {
    missing: missing
      .filter((m) => m.severity !== "trivial")
      .sort((a, b) => b.missing.length - a.missing.length)
      .slice(0, maxGaps),
    unreviewed: unreviewed.sort((a, b) => b.quote.length - a.quote.length).slice(0, maxGaps),
    perDoc,
    covered,
    total,
    ratio: total ? covered / total : 0,
  };
}

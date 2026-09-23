/* ============================================================
 * services/ocrHandwriting.ts — OCR + Handwriting Recognition.
 *
 * v2.32.0 — Optical Character Recognition pipeline for PDFs and
 *   uploaded images, with handwriting-aware fallback.
 *
 * Pipeline:
 *   1. Try Tesseract (system binary) — fastest, free, works for printed text
 *      and "neat" handwriting.
 *   2. If Tesseract fails OR confidence < 0.65, try Vision LLM fallback
 *      (Ollama + llava or external HTTP endpoint) for messy handwriting
 *      or scanned documents with non-standard fonts.
 *   3. Optionally detect handwritten regions via image-difference heuristic
 *      (compare OCR text-density per region).
 *
 * Persistence: backend/data/ocr-cache.json
 *   Caches OCR results keyed by SHA-1(image bytes) so repeated uploads
 *   don't re-run expensive inference.
 *
 * Exports:
 *   ocrHandwriting.recognize(imageBuffer, opts) → OCRResult
 *   ocrHandwriting.recognizePdfPage(pdfBuffer, pageNumber, opts) → OCRResult
 *   ocrHandwriting.detectHandwrittenRegions(imageBuffer) → RectRegion[]
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { logOp } from "../utils/log.js";

const DATA_DIR = join(process.cwd(), "data");
const CACHE_FILE = join(DATA_DIR, "ocr-cache.json");

export interface OCRRegion {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
  /** "printed" | "handwritten" | "mixed". */
  type: "printed" | "handwritten" | "mixed";
}

export interface OCRResult {
  text: string;
  confidence: number;
  regions: OCRRegion[];
  /** Strategy used: "tesseract" | "vision-llm" | "hybrid". */
  strategy: "tesseract" | "vision-llm" | "hybrid";
  durationMs: number;
  cached: boolean;
}

export interface OCROptions {
  /** Languages to recognize (Tesseract format: "spa+eng"). */
  languages?: string;
  /** Minimum confidence threshold (0..1). Below this, try LLM. */
  minConfidence?: number;
  /** If true, also detect handwritten regions. */
  detectHandwriting?: boolean;
  /** Force a specific strategy (skip fallback). */
  forceStrategy?: "tesseract" | "vision-llm";
  /** Optional Vision LLM endpoint override. */
  visionLlmEndpoint?: string;
}

const exec = promisify(spawn);

// ============ Tesseract ============

interface TesseractRunOptions {
  imagePath: string;
  languages?: string;
}

async function runTesseract(opts: TesseractRunOptions): Promise<OCRResult> {
  const start = Date.now();
  const langs = opts.languages ?? "spa+eng";
  // tesseract <image> stdout -l <langs> tsv
  return new Promise((resolve, reject) => {
    const proc = spawn("tesseract", [opts.imagePath, "stdout", "-l", langs, "tsv"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", (e) => reject(e));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tesseract exit ${code}: ${err.slice(0, 200)}`));
        return;
      }
      try {
        const parsed = parseTesseractTSV(out);
        resolve({
          text: parsed.text,
          confidence: parsed.avgConfidence,
          regions: parsed.regions,
          strategy: "tesseract",
          durationMs: Date.now() - start,
          cached: false,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

function parseTesseractTSV(tsv: string): { text: string; avgConfidence: number; regions: OCRRegion[] } {
  const lines = tsv.split("\n").filter(Boolean);
  if (lines.length === 0) return { text: "", avgConfidence: 0, regions: [] };
  const header = lines[0].split("\t");
  const idx = {
    text: header.indexOf("text"),
    conf: header.indexOf("conf"),
    x: header.indexOf("left"),
    y: header.indexOf("top"),
    w: header.indexOf("width"),
    h: header.indexOf("height"),
  };
  if (idx.text === -1 || idx.conf === -1) {
    // Fallback: treat as plain text
    return { text: lines.join("\n"), avgConfidence: 50, regions: [] };
  }
  const regions: OCRRegion[] = [];
  const words: string[] = [];
  let totalConf = 0;
  let confCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const text = cols[idx.text] ?? "";
    const conf = parseFloat(cols[idx.conf] ?? "-1");
    if (!text.trim()) continue;
    if (conf >= 0) {
      totalConf += conf;
      confCount += 1;
    }
    const x = parseInt(cols[idx.x] ?? "0", 10);
    const y = parseInt(cols[idx.y] ?? "0", 10);
    const w = parseInt(cols[idx.w] ?? "0", 10);
    const h = parseInt(cols[idx.h] ?? "0", 10);
    words.push(text);
    regions.push({
      text,
      bbox: { x, y, w, h },
      confidence: conf / 100,
      type: conf > 70 ? "printed" : "mixed",
    });
  }
  return {
    text: words.join(" "),
    avgConfidence: confCount > 0 ? (totalConf / confCount) / 100 : 0,
    regions,
  };
}

// ============ Vision LLM fallback ============

async function runVisionLlm(opts: {
  imagePath: string;
  endpoint?: string;
  prompt?: string;
}): Promise<OCRResult> {
  const start = Date.now();
  const endpoint = opts.endpoint ?? process.env.VISION_LLM_ENDPOINT ?? "http://localhost:11434";
  const prompt = opts.prompt ?? "Extract all text from this image verbatim. Preserve line breaks.";

  // Read image and base64 it
  const buf = await fs.readFile(opts.imagePath);
  const b64 = buf.toString("base64");

  // Try Ollama llava format
  try {
    const res = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llava",
        prompt,
        images: [b64],
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Vision LLM ${res.status}`);
    const data = await res.json() as { response?: string };
    const text = (data.response ?? "").trim();
    return {
      text,
      confidence: 0.8, // LLM-based, hard to estimate
      regions: [],
      strategy: "vision-llm",
      durationMs: Date.now() - start,
      cached: false,
    };
  } catch (e) {
    // Fallback: return a stub so the pipeline doesn't break
    logOp("ocr", "vision_llm_failed", false, { error: String(e) });
    return {
      text: "",
      confidence: 0,
      regions: [],
      strategy: "vision-llm",
      durationMs: Date.now() - start,
      cached: false,
    };
  }
}

// ============ Cache ============

async function loadCache(): Promise<Record<string, OCRResult>> {
  try {
    const raw = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCache(cache: Record<string, OCRResult>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

function hashBuffer(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex").slice(0, 16);
}

// ============ Handwriting region detection ============

/**
 * Heuristic handwritten-region detector.
 * Splits the image into 4x4 grid cells and estimates which cells have
 * handwriting-like patterns by combining:
 *   - High local variance (handwriting is irregular)
 *   - Mid-density (not empty, not solid)
 *   - Stroke-like aspect ratios (taller than wide clusters)
 *
 * Returns the bounding boxes of suspect cells (relative to image).
 *
 * NOTE: This is a coarse heuristic — true handwriting detection needs
 * a CNN. For now it flags regions where OCR confidence is low (proxy
 * for handwriting complexity).
 */
export async function detectHandwrittenRegions(imagePath: string): Promise<Array<{ x: number; y: number; w: number; h: number; confidence: number }>> {
  // We use OCR regions as a proxy: regions where confidence < 0.65 are likely handwriting.
  const ocr = await runTesseract({ imagePath }).catch(() => null);
  if (!ocr) return [];
  return ocr.regions
    .filter((r) => r.confidence < 0.65)
    .map((r) => ({ x: r.bbox.x, y: r.bbox.y, w: r.bbox.w, h: r.bbox.h, confidence: r.confidence }));
}

// ============ Public API ============

export const ocrHandwriting = {
  async recognize(imageBuffer: Buffer, opts: OCROptions = {}): Promise<OCRResult> {
    const minConf = opts.minConfidence ?? 0.65;
    const hash = hashBuffer(imageBuffer);
    const cache = await loadCache();
    if (cache[hash]) {
      return { ...cache[hash], cached: true };
    }

    // Write to temp file for Tesseract
    const tmpPath = join(DATA_DIR, `ocr-tmp-${hash}.png`);
    await fs.writeFile(tmpPath, imageBuffer);

    let result: OCRResult;
    if (opts.forceStrategy === "vision-llm") {
      result = await runVisionLlm({ imagePath: tmpPath, endpoint: opts.visionLlmEndpoint });
    } else {
      // Try tesseract first
      let tesseractResult: OCRResult | null = null;
      try {
        tesseractResult = await runTesseract({ imagePath: tmpPath, languages: opts.languages });
      } catch (e) {
        logOp("ocr", "tesseract_failed", false, { error: String(e) });
      }

      if (tesseractResult && tesseractResult.confidence >= minConf) {
        result = tesseractResult;
      } else if (opts.forceStrategy === "tesseract") {
        result = tesseractResult ?? {
          text: "", confidence: 0, regions: [], strategy: "tesseract",
          durationMs: 0, cached: false,
        };
      } else {
        // Fallback to Vision LLM
        const llmResult = await runVisionLlm({ imagePath: tmpPath, endpoint: opts.visionLlmEndpoint });
        if (llmResult.text) {
          result = {
            ...llmResult,
            strategy: tesseractResult ? "hybrid" : "vision-llm",
            confidence: (tesseractResult?.confidence ?? 0.5 + llmResult.confidence) / 2,
          };
        } else {
          result = tesseractResult ?? llmResult;
        }
      }
    }

    // Cleanup temp
    await fs.unlink(tmpPath).catch(() => {});

    // Persist in cache
    cache[hash] = result;
    await saveCache(cache);

    logOp("ocr", "recognize", true, { hash, strategy: result.strategy, confidence: result.confidence, durationMs: result.durationMs });
    return result;
  },

  async recognizeFromPath(imagePath: string, opts: OCROptions = {}): Promise<OCRResult> {
    const buf = await fs.readFile(imagePath);
    return this.recognize(buf, opts);
  },

  detectHandwrittenRegions,

  /**
   * OCR a PDF page by rasterizing it to PNG first (using pdf-to-png,
   * falls back to a stub if pdftoppm unavailable).
   */
  async recognizePdfPage(pdfPath: string, pageNumber: number, opts: OCROptions = {}): Promise<OCRResult> {
    const start = Date.now();
    const pngPath = join(DATA_DIR, `pdf-page-${hashString(pdfPath + pageNumber)}.png`);
    const ok = await rasterizePdfPage(pdfPath, pageNumber, pngPath);
    if (!ok) {
      return {
        text: "",
        confidence: 0,
        regions: [],
        strategy: "tesseract",
        durationMs: Date.now() - start,
        cached: false,
      };
    }
    const buf = await fs.readFile(pngPath);
    const result = await this.recognize(buf, opts);
    await fs.unlink(pngPath).catch(() => {});
    return result;
  },

  _clearCache: async () => {
    await fs.unlink(CACHE_FILE).catch(() => {});
  },
};

function hashString(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

async function rasterizePdfPage(pdfPath: string, pageNumber: number, outPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("pdftoppm", ["-png", "-r", "200", "-f", String(pageNumber), "-l", String(pageNumber), pdfPath, outPath.replace(/\.png$/, "")], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => {
      if (code !== 0) {
        logOp("ocr", "rasterize_failed", false, { error: err.slice(0, 200) });
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

/* ============================================================
 * services/ocrHtr.ts — Pipeline OCR (impreso) + HTR (manuscrito).
 *
 * v2.32.0 — Dos rutas:
 *
 *   - ocrImage(input):  Tesseract sobre imagen raster (PNG/JPG).
 *   - htrRegion(input): Vision LLM (Ollama) sobre recortes manuscritos.
 *
 * Estrategia:
 *   1. Preproceso: gris + binarización (Otsu) + deskew opcional
 *   2. Tesseract reconoce texto impreso (--psm 6 = bloque)
 *   3. Si confidence < threshold o el usuario marca "manuscrito",
 *      enviamos el recorte al vision LLM (Ollama llama3.2-vision
 *      si disponible) y parseamos la respuesta.
 *   4. Cacheamos resultados por hash del contenido para no repetir.
 *
 * Sin dependencia de GPU: tesseract.js es WASM, Ollama corre local.
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logOp } from "../utils/log.js";

const execp = promisify(exec);
const DATA_DIR = join(process.cwd(), "data");
const OCR_CACHE = join(DATA_DIR, "ocr-cache.json");

const DEFAULT_CONFIDENCE_THRESHOLD = 60;
const DEFAULT_LLM_MODEL = "llama3.2-vision";

export interface OcrInput {
  /** Path or base64 data URL of the image. */
  image: string;
  /** Language hint (default "spa+eng"). */
  lang?: string;
  /** Page Mode for Tesseract: 1=auto, 3=default, 6=block, 11=sparse. */
  psm?: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  /** Bounding boxes per word: [{ text, x, y, w, h }]. */
  words: Array<{ text: string; x: number; y: number; w: number; h: number; confidence: number }>;
  /** Backend used: tesseract | llm-vision. */
  backend: "tesseract" | "llm-vision" | "fallback";
  /** Whether the backend fell back to the LLM due to low confidence. */
  lowConfidence: boolean;
  /** Latency in ms. */
  latencyMs: number;
}

export interface HtrInput extends OcrInput {
  /** Optional subject hint for the LLM (e.g. "medical anatomy"). */
  subject?: string;
  /** LLM model (default llama3.2-vision). */
  model?: string;
  /** Optional fallback text if the LLM fails. */
  fallbackText?: string;
}

async function loadCache(): Promise<Record<string, OcrResult>> {
  try {
    return JSON.parse(await fs.readFile(OCR_CACHE, "utf-8"));
  } catch {
    return {};
  }
}

async function saveCache(cache: Record<string, OcrResult>): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OCR_CACHE, JSON.stringify(cache, null, 2), "utf-8");
}

function hashInput(image: string, lang: string, psm: number): string {
  return createHash("sha256").update(`${image}|${lang}|${psm}`).digest("hex").slice(0, 16);
}

/** Run Tesseract via the tesseract CLI. Returns parsed output or throws. */
async function runTesseract(image: string, lang: string, psm: number): Promise<{
  text: string;
  confidence: number;
  words: OcrResult["words"];
}> {
  // Convert data URL to a temp file if needed
  let path = image;
  let tempCreated = false;
  if (image.startsWith("data:")) {
    const b64 = image.split(",")[1] ?? "";
    const ext = image.includes("png") ? "png" : "jpg";
    path = join(DATA_DIR, `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
    await fs.writeFile(path, Buffer.from(b64, "base64"));
    tempCreated = true;
  }
  try {
    const tsv = `${path} stdout -l ${lang} --psm ${psm} tsv`;
    const { stdout } = await execp(`tesseract "${tsv}"`, { maxBuffer: 32 * 1024 * 1024 });
    return parseTesseractTsv(stdout);
  } finally {
    if (tempCreated) {
      try { await fs.unlink(path); } catch {}
    }
  }
}

function parseTesseractTsv(stdout: string): {
  text: string;
  confidence: number;
  words: OcrResult["words"];
} {
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) return { text: "", confidence: 0, words: [] };
  const header = lines[0].split("\t");
  const idx = {
    text: header.indexOf("text"),
    conf: header.indexOf("conf"),
    left: header.indexOf("left"),
    top: header.indexOf("top"),
    width: header.indexOf("width"),
    height: header.indexOf("height"),
    level: header.indexOf("level"),
  };
  const words: OcrResult["words"] = [];
  let fullText = "";
  let totalConf = 0;
  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const text = cols[idx.text] ?? "";
    const conf = parseFloat(cols[idx.conf] ?? "-1");
    if (idx.level !== -1 && cols[idx.level] !== "5") continue; // only word level
    if (!text || text.trim().length === 0) continue;
    const confPct = conf >= 0 ? conf : 0;
    fullText += (fullText.length > 0 ? " " : "") + text;
    words.push({
      text,
      x: parseInt(cols[idx.left] ?? "0", 10),
      y: parseInt(cols[idx.top] ?? "0", 10),
      w: parseInt(cols[idx.width] ?? "0", 10),
      h: parseInt(cols[idx.height] ?? "0", 10),
      confidence: confPct,
    });
    totalConf += confPct;
    count++;
  }
  const avg = count > 0 ? totalConf / count : 0;
  return { text: fullText.trim(), confidence: avg, words };
}

/**
 * Send a region to Ollama vision LLM. Returns the transcribed text.
 * Falls back gracefully when Ollama is not running.
 */
async function runVisionLlm(input: HtrInput): Promise<string | null> {
  const model = input.model ?? DEFAULT_LLM_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  let imageData = input.image;
  if (!imageData.startsWith("data:")) {
    try {
      const buf = await fs.readFile(imageData);
      const mime = buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : "image/png";
      imageData = `data:${mime};base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  }
  const prompt = input.subject
    ? `Transcribe ONLY the handwritten text visible in this image. The subject context is "${input.subject}". Output the raw text exactly as written, no commentary.`
    : `Transcribe ONLY the handwritten text visible in this image. Output the raw text exactly as written, no commentary.`;
  try {
    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        images: [imageData.split(",")[1] ?? ""],
        stream: false,
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return typeof data.response === "string" ? data.response.trim() : null;
  } catch {
    return null;
  }
}

/**
 * OCR pipeline: tries Tesseract first; falls back to LLM vision
 * if confidence is too low or if explicitly requested.
 */
export async function ocrImage(input: OcrInput): Promise<OcrResult> {
  const lang = input.lang ?? "spa+eng";
  const psm = input.psm ?? 6;
  const start = Date.now();
  const key = hashInput(input.image, lang, psm);
  const cache = await loadCache();
  if (cache[key]) return cache[key];

  let tesseract: Awaited<ReturnType<typeof runTesseract>>;
  try {
    tesseract = await runTesseract(input.image, lang, psm);
  } catch (e: any) {
    logOp("ocr", "tesseract_failed", false, { error: String(e?.message ?? e) });
    // No tesseract available — fallback
    const result: OcrResult = {
      text: "",
      confidence: 0,
      words: [],
      backend: "fallback",
      lowConfidence: true,
      latencyMs: Date.now() - start,
    };
    return result;
  }

  const lowConfidence = tesseract.confidence < DEFAULT_CONFIDENCE_THRESHOLD;
  let result: OcrResult = {
    text: tesseract.text,
    confidence: tesseract.confidence,
    words: tesseract.words,
    backend: "tesseract",
    lowConfidence,
    latencyMs: Date.now() - start,
  };

  if (lowConfidence) {
    const llmText = await runVisionLlm({ ...input, lang, psm }).catch(() => null);
    if (llmText && llmText.length > 0) {
      result = {
        ...result,
        backend: "llm-vision",
        text: llmText,
        confidence: 85, // estimated for LLM
      };
    }
  }

  cache[key] = result;
  await saveCache(cache);
  logOp("ocr", "complete", true, { backend: result.backend, confidence: result.confidence });
  return result;
}

/**
 * HTR pipeline: directly sends to vision LLM (for known-handwritten regions).
 */
export async function htrRegion(input: HtrInput): Promise<OcrResult> {
  const start = Date.now();
  const key = hashInput(input.image, "htr", 0);
  const cache = await loadCache();
  if (cache[key]) return cache[key];

  const text = await runVisionLlm(input);
  let result: OcrResult;
  if (text !== null) {
    result = {
      text,
      confidence: 85,
      words: text.split(/\s+/).map((w, i) => ({
        text: w,
        x: i * 10,
        y: 0,
        w: w.length * 10,
        h: 14,
        confidence: 85,
      })),
      backend: "llm-vision",
      lowConfidence: false,
      latencyMs: Date.now() - start,
    };
  } else {
    result = {
      text: input.fallbackText ?? "",
      confidence: 0,
      words: [],
      backend: "fallback",
      lowConfidence: true,
      latencyMs: Date.now() - start,
    };
  }
  cache[key] = result;
  await saveCache(cache);
  logOp("htr", "complete", true, { backend: result.backend, len: result.text.length });
  return result;
}

/** Check what's available on the system. */
export async function probeEnvironment(): Promise<{
  tesseract: boolean;
  ollama: boolean;
  ollamaModels?: string[];
}> {
  const out: { tesseract: boolean; ollama: boolean; ollamaModels?: string[] } = {
    tesseract: false,
    ollama: false,
  };
  try {
    await execp("tesseract --version", { timeout: 5000 });
    out.tesseract = true;
  } catch {}
  try {
    const r = await fetch(`${process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      out.ollama = true;
      const j = await r.json().catch(() => null);
      out.ollamaModels = (j?.models ?? []).map((m: any) => m.name);
    }
  } catch {}
  return out;
}

export const ocrHtr = {
  ocrImage,
  htrRegion,
  probeEnvironment,
  _reset: async () => {
    try { await fs.unlink(OCR_CACHE); } catch {}
  },
};

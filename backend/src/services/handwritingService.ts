// handwritingService.ts: reconocimiento de handwriting / strokes.
//
// v0.60 (P2.2): convierte strokes (X,Y,T) en texto via heuristica + OCR.
// Backend: recibe strokes (array de {x, y, t}), normaliza a bitmap y
// llama a tesseract si esta disponible; si no, aplica heuristica basica.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

export interface Stroke {
  x: number;
  y: number;
  t: number; // ms timestamp
}

export interface RecognitionResult {
  text: string;
  confidence: number; // 0..1
  // v0.60: bounding box de cada palabra
  words: Array<{ text: string; x: number; y: number; w: number; h: number; confidence: number }>;
  // v0.60: tiempo de procesamiento
  durationMs: number;
  // v0.60: si se uso heuristica vs tesseract
  source: "tesseract" | "heuristic" | "hybrid";
}

class HandwritingService {
  /// v0.60 (P2.2): render strokes a PNG (basico, sin canvas).
  /// Crea un buffer PNG con lineas via PDF-2-image NO. Mejor: PPM -> PNG.
  private async renderToPng(strokes: Stroke[], width = 800, height = 600): Promise<Buffer> {
    // v0.60: PPM (P6) simple, luego invocamos magick/imagemagick si está
    const buf = Buffer.alloc(width * height * 3 + 16);
    // PPM header
    const header = Buffer.from(`P6\n${width} ${height}\n255\n`);
    header.copy(buf, 0);
    let off = header.length;
    for (let i = 0; i < width * height * 3; i++) { buf[off++] = 255; }
    // Try ImageMagick
    try {
      const tmpDir = await mkdtemp(join(tmpdir(), "hw-"));
      const pgm = join(tmpDir, "in.pgm");
      const png = join(tmpDir, "out.png");
      const pgmBuf = Buffer.alloc(width * height);
      pgmBuf.fill(255);
      // Dibujar strokes como lineas en pgm
      for (let i = 1; i < strokes.length; i++) {
        const a = strokes[i - 1];
        const b = strokes[i];
        this.drawLine(pgmBuf, width, height, a.x, a.y, b.x, b.y);
      }
      // Construir header PGM
      const pgmHeader = Buffer.from(`P5\n${width} ${height}\n255\n`);
      const finalPgm = Buffer.concat([pgmHeader, pgmBuf]);
      await writeFile(pgm, finalPgm);
      await execAsync(`convert "${pgm}" "${png}" 2>/dev/null || magick "${pgm}" "${png}" 2>/dev/null`);
      const pngBuf = await import("node:fs/promises").then(m => m.readFile(png));
      await rm(tmpDir, { recursive: true, force: true });
      return pngBuf;
    } catch (e) {
      // No imagemagick: return PPM raw
      return buf;
    }
  }

  private drawLine(img: Buffer, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = Math.floor(x0);
    let y = Math.floor(y0);
    while (true) {
      if (x >= 0 && x < w && y >= 0 && y < h) img[y * w + x] = 0;
      if (x === Math.floor(x1) && y === Math.floor(y1)) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  /// v0.60 (P2.2): reconoce strokes -> texto.
  /// Pipeline:
  ///   1. render a PNG
  ///   2. tesseract si esta disponible
  ///   3. fallback heuristico (densidad de pixeles por region)
  async recognize(strokes: Stroke[]): Promise<RecognitionResult> {
    const start = Date.now();
    if (strokes.length < 2) {
      return {
        text: "", confidence: 0, words: [],
        durationMs: Date.now() - start, source: "heuristic",
      };
    }
    // Bounding box
    const xs = strokes.map(s => s.x);
    const ys = strokes.map(s => s.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 5 || h < 5) {
      return {
        text: "", confidence: 0, words: [],
        durationMs: Date.now() - start, source: "heuristic",
      };
    }
    // Heuristica: dividir en columnas por X, contar strokes por columna
    // y estimar numero de "palabras" (gaps de tiempo > 200ms)
    let words: Array<{ text: string; x: number; y: number; w: number; h: number; confidence: number }> = [];
    let current: Stroke[] = [];
    const sorted = [...strokes].sort((a, b) => a.t - b.t);
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].t - sorted[i - 1].t > 250) {
        if (current.length > 0) {
          words.push(this.estimateWord(current));
          current = [];
        }
      }
      current.push(sorted[i]);
    }
    if (current.length > 0) words.push(this.estimateWord(current));
    // v0.60: intentar tesseract
    let text = "";
    let source: "tesseract" | "heuristic" | "hybrid" = "heuristic";
    let confidence = 0.3;
    try {
      const tmpDir = await mkdtemp(join(tmpdir(), "hw-"));
      const pngPath = join(tmpDir, "in.png");
      const outBase = join(tmpDir, "out");
      const png = await this.renderToPng(strokes, 800, 600);
      await writeFile(pngPath, png);
      await execAsync(`tesseract "${pngPath}" "${outBase}" -l spa+eng --psm 7 2>/dev/null`);
      const outTxt = await import("node:fs/promises").then(m => m.readFile(`${outBase}.txt`, "utf-8"));
      text = outTxt.trim();
      if (text) { source = "tesseract"; confidence = 0.7; }
      await rm(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // tesseract no disponible: usar heuristica
    }
    if (!text) {
      // v0.60: heuristica -> "word 1, word 2, ...". No es OCR real,
      // pero da un placeholder que el usuario puede editar.
      text = words.map(w => `[?]${w.text}[/?]`).join(' ');
    }
    return {
      text, confidence,
      words: words.map(w => ({ ...w, text: w.text })),
      durationMs: Date.now() - start,
      source,
    };
  }

  private estimateWord(strokes: Stroke[]): { text: string; x: number; y: number; w: number; h: number; confidence: number } {
    const xs = strokes.map(s => s.x);
    const ys = strokes.map(s => s.y);
    return {
      text: "",
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      confidence: 0.3,
    };
  }
}

let _instance: HandwritingService | null = null;
export function getHandwritingService(): HandwritingService {
  if (!_instance) _instance = new HandwritingService();
  return _instance;
}

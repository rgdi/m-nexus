// OcrService: usa Tesseract local.
// v0.45: error codes estructurados con AppError.

import { spawn } from "node:child_process";
import { config } from "../config.js";
import { logger, logOp } from "../utils/log.js";
import { writeFile, unlink } from "node:fs/promises";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";

export interface OCRBlock {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  confidence: number;
}

export interface OCRResult {
  text: string;
  confidence: number;
  blocks: OCRBlock[];
}

export class OCRService {
  async isAvailable(): Promise<boolean> {
    if (process.env.MOCK_TESSERACT === "1") return true;
    return await safeCallOrNull<boolean>({
      component: "ocr",
      code: "EC-OCR-010",
      message: "isAvailable check failed",
      context: { binary: config.tesseractBinary },
      op: async () => {
        await this.run(["--version"], 3000);
        return true;
      },
    }) ?? false;
  }

  async recognize(image: Buffer, opts: { language?: string } = {}): Promise<OCRResult> {
    // MOCK_TESSERACT=1: devuelve un resultado simulado sin llamar al binario
    if (process.env.MOCK_TESSERACT === "1") {
      return {
        text: `[MOCK OCR] Recognized ${image.length} bytes (lang: ${opts.language ?? "spa"})`,
        confidence: 0.85,
        blocks: [
          { text: "Mock block 1", bbox: { x: 0, y: 0, w: 100, h: 20 }, confidence: 0.9 },
        ],
      };
    }
    const r = await safeCallAsync<OCRResult>({
      component: "ocr",
      code: "EC-OCR-011",
      message: "recognize failed",
      context: { imageLen: image.length, language: opts.language },
      op: async () => {
        const language = opts.language ?? process.env.OCR_LANG ?? "spa";
        const start = Date.now();
        const result = await this.runTesseract(image, language);
        const durationMs = Date.now() - start;
        logOp("ocr", "recognize", true, {
          language,
          textLen: result.text.length,
          confidence: result.confidence.toFixed(2),
          durationMs,
        });
        return result;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  }

  private async runTesseract(image: Buffer, language: string): Promise<OCRResult> {
    const tmpIn = `/tmp/mnexus-ocr-${Date.now()}.png`;
    const tmpOutBase = `/tmp/mnexus-ocr-${Date.now()}`;
    let stdout: string | undefined;
    try {
      await writeFile(tmpIn, image);
      stdout = await this.run([
        tmpIn, tmpOutBase,
        "-l", language,
        "-c", "preserve_interword_spaces=1",
      ], 30_000);
      const tsv = await import("node:fs/promises").then(fs => fs.readFile(`${tmpOutBase}.tsv`, "utf-8"));
      const text = await import("node:fs/promises").then(fs => fs.readFile(`${tmpOutBase}.txt`, "utf-8"));
      await unlink(`${tmpOutBase}.tsv`).catch(() => {});
      await unlink(`${tmpOutBase}.txt`).catch(() => {});
      return {
        text: text.trim(),
        confidence: this.avgConfidence(tsv),
        blocks: this.parseBlocks(tsv),
      };
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "OCR: tesseract failed");
      throw E.ocr("EC-OCR-012", "Tesseract execution failed", {
        cause: err instanceof Error ? err : new Error(String(err)),
        context: { language, imageLen: image.length, stdout: stdout?.slice(0, 200) },
        hint: "Check tesseract is installed, image is valid, language pack available",
      });
    } finally {
      await unlink(tmpIn).catch(() => {});
    }
  }

  private avgConfidence(tsv: string): number {
    const lines = tsv.split("\n").slice(1);
    const confs: number[] = [];
    for (const l of lines) {
      const cols = l.split("\t");
      const c = parseFloat(cols[10]);
      if (!isNaN(c) && c >= 0) confs.push(c);
    }
    if (confs.length === 0) return 0;
    return confs.reduce((a, b) => a + b, 0) / confs.length;
  }

  private parseBlocks(tsv: string): OCRBlock[] {
    const lines = tsv.split("\n").slice(1);
    const blocks: OCRBlock[] = [];
    for (const l of lines) {
      const cols = l.split("\t");
      if (cols.length < 12) continue;
      const text = cols[11];
      if (!text || !text.trim()) continue;
      const confidence = parseFloat(cols[10]);
      blocks.push({
        text,
        bbox: {
          x: parseInt(cols[6], 10) || 0,
          y: parseInt(cols[7], 10) || 0,
          w: parseInt(cols[8], 10) || 0,
          h: parseInt(cols[9], 10) || 0,
        },
        confidence: isNaN(confidence) ? 0 : confidence,
      });
    }
    return blocks;
  }

  private run(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(config.tesseractBinary, args);
      let stdout = "";
      let stderr = "";
      const t = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(E.ocr("EC-OCR-013", "Tesseract timeout", {
          context: { args, timeoutMs },
          hint: "Increase timeout or check tesseract responsiveness",
        }));
      }, timeoutMs);
      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });
      proc.on("error", (err) => {
        clearTimeout(t);
        reject(E.ocr("EC-OCR-014", "Tesseract spawn error", {
          cause: err,
          context: { args, binary: config.tesseractBinary },
          hint: "Check tesseract is installed and binary path is correct",
        }));
      });
      proc.on("close", (code) => {
        clearTimeout(t);
        if (code === 0) resolve(stdout);
        else reject(E.ocr("EC-OCR-015", "Tesseract non-zero exit", {
          context: { code, args, stderr: stderr.slice(0, 500) },
        }));
      });
    });
  }
}

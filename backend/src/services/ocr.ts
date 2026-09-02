// OcrService: usa Tesseract local.

import { spawn } from "node:child_process";
import { config } from "../config.js";
import { logger } from "../utils/log.js";
import { writeFile, unlink } from "node:fs/promises";

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
    try {
      await this.run(["--version"], 3000);
      return true;
    } catch {
      return false;
    }
  }

  async recognize(image: Buffer, opts: { language?: string }): Promise<OCRResult> {
    if (process.env.MOCK_TESSERACT === "1") {
      return this.mockRecognize(image);
    }
    const tmpPath = `/tmp/mnexus-ocr-${Date.now()}.png`;
    await writeFile(tmpPath, image);
    try {
      const lang = opts.language ?? "spa+eng";
      const stdout = await this.run([tmpPath, "-l", lang, "--psm", "6", "tsv"], 120_000);
      const blocks = this.parseTsv(stdout);
      const text = blocks.map((b) => b.text).join(" ").trim();
      const avgConf = blocks.length > 0 ? blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length / 100 : 0;
      return { text, confidence: avgConf, blocks };
    } finally {
      try { await unlink(tmpPath); } catch { /* ignore */ }
    }
  }

  private mockRecognize(_image: Buffer): OCRResult {
    return {
      text: "Texto OCR simulado para tests",
      confidence: 0.95,
      blocks: [
        { text: "Texto", bbox: { x: 0, y: 0, w: 100, h: 30 }, confidence: 95 },
        { text: "OCR", bbox: { x: 110, y: 0, w: 50, h: 30 }, confidence: 95 },
      ],
    };
  }

  private run(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(config.tesseractBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`Tesseract timeout tras ${timeoutMs}ms`));
      }, timeoutMs);
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`Tesseract exit ${code}: ${stderr.slice(0, 500)}`));
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private parseTsv(tsv: string): OCRBlock[] {
    const lines = tsv.split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split("\t");
    const out: OCRBlock[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split("\t");
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
      // Filtrar palabras con baja confianza
      const conf = parseFloat(row.conf ?? "-1");
      if (conf < 30) continue;
      const text = (row.text ?? "").trim();
      if (!text) continue;
      out.push({
        text,
        bbox: {
          x: parseInt(row.left ?? "0", 10),
          y: parseInt(row.top ?? "0", 10),
          w: parseInt(row.width ?? "0", 10),
          h: parseInt(row.height ?? "0", 10),
        },
        confidence: conf,
      });
    }
    return out;
  }
}

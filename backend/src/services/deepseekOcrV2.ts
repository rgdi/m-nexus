// v0.27: DeepSeek-OCR self-hosted.
// Usa vLLM localmente o el endpoint oficial.
// Endpoint esperado: POST /v1/chat/completions con imagen base64.

import * as fs from "fs/promises";
import * as path from "path";
import { DeepSeekOCR, type DeepSeekOCRResult, type DeepSeekOCROptions } from "./deepseekOcr";

export interface DeepSeekSelfHostedOptions extends DeepSeekOCROptions {
  /** URL del servidor vLLM. Default: http://localhost:8000 */
  vllmUrl?: string;
  /** Modelo a usar. Default: deepseek-ai/DeepSeek-OCR */
  model?: string;
  /** Max tokens. Default: 8192 */
  maxTokens?: number;
  /** Temperatura. Default: 0.0 (OCR determinístico). */
  temperature?: number;
  /** Prompt template. Default: "<image>\n<|grounding|>Convert the document to markdown." */
  prompt?: string;
  /** Si preserve grounding (coordenadas). */
  grounding?: boolean;
}

const DEFAULT_PROMPT_MD = "<image>\n<|grounding|>Convert the document to markdown.";
const DEFAULT_PROMPT_FREE = "<image>\nFree OCR.";

/**
 * DeepSeek-OCR self-hosted via vLLM.
 * https://huggingface.co/deepseek-ai/DeepSeek-OCR
 */
export class DeepSeekSelfHostedOCR {
  private options: Required<DeepSeekSelfHostedOptions>;

  constructor(options: DeepSeekSelfHostedOptions = { preserveTables: true, includeImages: true, mode: "accurate" }) {
    this.options = {
      apiKey: options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      languages: options.languages ?? ["es", "en"],
      preserveTables: options.preserveTables ?? true,
      includeImages: options.includeImages ?? true,
      mode: options.mode ?? "accurate",
      vllmUrl: options.vllmUrl ?? process.env.DEEPSEEK_VLLM_URL ?? "http://localhost:8000",
      model: options.model ?? "deepseek-ai/DeepSeek-OCR",
      maxTokens: options.maxTokens ?? 8192,
      temperature: options.temperature ?? 0.0,
      prompt: options.prompt ?? DEFAULT_PROMPT_MD,
      grounding: options.grounding ?? true,
    };
  }

  /**
   * Verifica si el servidor vLLM está disponible.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.options.vllmUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Procesa un archivo con DeepSeek-OCR self-hosted.
   */
  async processFile(filePath: string): Promise<DeepSeekOCRResult> {
    const start = Date.now();
    const ext = path.extname(filePath).toLowerCase();

    if (!(await this.isAvailable())) {
      // Fallback al OCR mock/class
      console.warn(`[DeepSeekSelfHosted] vLLM not available at ${this.options.vllmUrl}. Using fallback.`);
      const fallback = new DeepSeekOCR({ preserveTables: this.options.preserveTables, includeImages: this.options.includeImages, mode: this.options.mode });
      const result = await fallback.processFile(filePath);
      result.elapsedMs = Date.now() - start;
      return result;
    }

    // 1) Si es PDF, convertir a imagen (primera página) — DeepSeek-OCR es para imágenes
    let imageBase64: string;
    let mimeType: string;
    if (ext === ".pdf") {
      const pageImage = await this.convertPdfToImage(filePath);
      imageBase64 = pageImage.base64;
      mimeType = pageImage.mimeType;
    } else if ([".ppt", ".pptx"].includes(ext)) {
      // PowerPoint: convertir primera slide a imagen
      const slideImage = await this.convertPptToImage(filePath);
      imageBase64 = slideImage.base64;
      mimeType = slideImage.mimeType;
    } else {
      const image = await this.readImageAsBase64(filePath);
      imageBase64 = image.base64;
      mimeType = image.mimeType;
    }

    // 2) Llamar a vLLM con el chat completion endpoint
    const prompt = this.options.grounding ? DEFAULT_PROMPT_MD : DEFAULT_PROMPT_FREE;
    const res = await fetch(`${this.options.vllmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: this.options.maxTokens,
        temperature: this.options.temperature,
      }),
    });

    if (!res.ok) {
      throw new Error(`DeepSeek-OCR error: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const markdown = json.choices[0]?.message?.content ?? "";

    // 3) Parsear markdown a regiones
    const regions = this.parseMarkdownToRegions(markdown);

    return {
      markdown,
      regions,
      language: "es", // DeepSeek-OCR no devuelve idioma, asumimos
      hasTables: regions.some((r) => r.type === "table"),
      elapsedMs: Date.now() - start,
      provider: "deepseek-ocr",
    };
  }

  /**
   * Procesa múltiples páginas (PDFs multipágina).
   */
  async processPdfPages(filePath: string, pages?: number[]): Promise<DeepSeekOCRResult[]> {
    if (!(await this.isAvailable())) {
      throw new Error("vLLM not available");
    }
    // Para multipágina: convertir cada página a imagen y procesar
    const allPages = await this.convertPdfToImagesAll(filePath);
    const targetPages = pages ?? allPages.map((_, i) => i);
    const results: DeepSeekOCRResult[] = [];
    for (const pageNum of targetPages) {
      if (pageNum >= allPages.length) continue;
      const img = allPages[pageNum];
      const r = await this.processImageBase64(img.base64, img.mimeType, pageNum + 1);
      results.push(r);
    }
    return results;
  }

  private async processImageBase64(base64: string, mimeType: string, page?: number): Promise<DeepSeekOCRResult> {
    const prompt = this.options.grounding ? DEFAULT_PROMPT_MD : DEFAULT_PROMPT_FREE;
    const res = await fetch(`${this.options.vllmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: this.options.maxTokens,
        temperature: this.options.temperature,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek-OCR error: ${res.status}`);
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const markdown = json.choices[0]?.message?.content ?? "";
    return {
      markdown,
      regions: this.parseMarkdownToRegions(markdown),
      language: "es",
      hasTables: markdown.includes("|"),
      elapsedMs: 0,
      provider: "deepseek-ocr",
      page,
    };
  }

  private async readImageAsBase64(filePath: string): Promise<{ base64: string; mimeType: string }> {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { base64: buf.toString("base64"), mimeType };
  }

  private async convertPdfToImage(filePath: string): Promise<{ base64: string; mimeType: string }> {
    // Requiere pdf2image o poppler-utils. Si no, fallback.
    try {
      const { execFile } = await import("child_process");
      const tmpDir = await fs.mkdtemp("/tmp/dsocr-");
      const outBase = path.join(tmpDir, "page");
      await new Promise<void>((resolve, reject) => {
        execFile("pdftoppm", ["-png", "-r", "200", "-f", "1", "-l", "1", filePath, outBase], (err) => err ? reject(err) : resolve());
      });
      const pngPath = `${outBase}-1.png`;
      const buf = await fs.readFile(pngPath);
      return { base64: buf.toString("base64"), mimeType: "image/png" };
    } catch {
      throw new Error("PDF→image conversion requires pdftoppm (poppler-utils). Install: apt install poppler-utils");
    }
  }

  private async convertPptToImage(filePath: string): Promise<{ base64: string; mimeType: string }> {
    try {
      const { execFile } = await import("child_process");
      const tmpDir = await fs.mkdtemp("/tmp/dsocr-");
      const outBase = path.join(tmpDir, "slide");
      await new Promise<void>((resolve, reject) => {
        execFile("libreoffice", ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, filePath], (err) => err ? reject(err) : resolve());
      });
      const pdfPath = path.join(tmpDir, path.basename(filePath, path.extname(filePath)) + ".pdf");
      return await this.convertPdfToImage(pdfPath);
    } catch {
      throw new Error("PPT→image conversion requires libreoffice. Install: apt install libreoffice");
    }
  }

  private async convertPdfToImagesAll(filePath: string): Promise<Array<{ base64: string; mimeType: string }>> {
    try {
      const { execFile } = await import("child_process");
      const tmpDir = await fs.mkdtemp("/tmp/dsocr-");
      const outBase = path.join(tmpDir, "page");
      await new Promise<void>((resolve, reject) => {
        execFile("pdftoppm", ["-png", "-r", "200", filePath, outBase], (err) => err ? reject(err) : resolve());
      });
      const files = await fs.readdir(tmpDir);
      const pngs = files.filter((f) => f.endsWith(".png")).sort();
      return Promise.all(
        pngs.map(async (f) => {
          const buf = await fs.readFile(path.join(tmpDir, f));
          return { base64: buf.toString("base64"), mimeType: "image/png" };
        })
      );
    } catch {
      throw new Error("PDF→images conversion requires pdftoppm.");
    }
  }

  private parseMarkdownToRegions(md: string): Array<{ text: string; type: "title" | "paragraph" | "table" | "list" | "image" | "header" | "footer" | "code"; confidence: number }> {
    const regions: Array<{ text: string; type: "title" | "paragraph" | "table" | "list" | "image" | "header" | "footer" | "code"; confidence: number }> = [];
    const lines = md.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("# ")) {
        regions.push({ text: line.slice(2), type: "title", confidence: 0.95 });
      } else if (line.startsWith("## ") || line.startsWith("### ")) {
        regions.push({ text: line.replace(/^#+\s/, ""), type: "header", confidence: 0.92 });
      } else if (line.includes("|") && i + 1 < lines.length && lines[i + 1]?.includes("---")) {
        // Tabla
        const tableLines = [line];
        let j = i + 1;
        while (j < lines.length && lines[j].includes("|")) {
          tableLines.push(lines[j]);
          j++;
        }
        regions.push({ text: tableLines.join("\n"), type: "table", confidence: 0.88 });
        i = j - 1;
      } else if (line.startsWith("- ") || line.startsWith("* ") || /^\d+\.\s/.test(line)) {
        regions.push({ text: line, type: "list", confidence: 0.9 });
      } else if (line.startsWith("```")) {
        const codeLines = [line];
        let j = i + 1;
        while (j < lines.length && !lines[j].startsWith("```")) {
          codeLines.push(lines[j]);
          j++;
        }
        codeLines.push("```");
        regions.push({ text: codeLines.join("\n"), type: "code", confidence: 0.9 });
        i = j;
      } else if (line.startsWith("![") && line.includes("](")) {
        regions.push({ text: line, type: "image", confidence: 0.9 });
      } else if (line.trim().length > 0) {
        regions.push({ text: line, type: "paragraph", confidence: 0.85 });
      }
    }
    return regions;
  }
}

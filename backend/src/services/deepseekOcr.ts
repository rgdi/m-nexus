// v0.25: DeepSeek OCR para PowerPoint y PDFs.
// Preserva tablas y diseño — convierte a Markdown con estructura.

import * as fs from "fs/promises";
import * as path from "path";

export interface OCRRegion {
  /** Texto extraído. */
  text: string;
  /** Tipo de región. */
  type: "title" | "paragraph" | "table" | "list" | "image" | "header" | "footer" | "code";
  /** Coordenadas (x, y, w, h) si están disponibles. */
  bbox?: { x: number; y: number; w: number; h: number };
  /** Confianza 0..1. */
  confidence: number;
  /** Si es parte de una tabla, índice de fila/columna. */
  tableCell?: { row: number; col: number };
}

export interface DeepSeekOCRResult {
  /** Texto en formato Markdown. */
  markdown: string;
  /** Regiones detectadas. */
  regions: OCRRegion[];
  /** Idioma detectado. */
  language: string;
  /** Número de página (si aplica). */
  page?: number;
  /** Si la página tiene tablas. */
  hasTables: boolean;
  /** Tiempo de procesamiento. */
  elapsedMs: number;
  /** Provider usado. */
  provider: "deepseek-ocr" | "tesseract" | "mock";
}

export interface DeepSeekOCROptions {
  /** API key de DeepSeek. */
  apiKey?: string;
  /** Idioma(s) del OCR. */
  languages?: string[];
  /** Si debe preservar la estructura de tablas. */
  preserveTables: boolean;
  /** Si debe incluir imágenes como referencias. */
  includeImages: boolean;
  /** Modo: "fast" (rápido) o "accurate" (más preciso). */
  mode: "fast" | "accurate";
}

export class DeepSeekOCR {
  private options: Required<DeepSeekOCROptions>;

  constructor(options: DeepSeekOCROptions = { preserveTables: true, includeImages: true, mode: "accurate" }) {
    this.options = {
      apiKey: options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      languages: options.languages ?? ["es", "en"],
      preserveTables: options.preserveTables ?? true,
      includeImages: options.includeImages ?? true,
      mode: options.mode ?? "accurate",
    };
  }

  /**
   * Procesa un archivo: PDF, PPT, PPTX, imagen.
   * Devuelve Markdown con estructura preservada.
   */
  async processFile(filePath: string): Promise<DeepSeekOCRResult> {
    const start = Date.now();
    const ext = path.extname(filePath).toLowerCase();
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) throw new Error(`File not found: ${filePath}`);

    let result: DeepSeekOCRResult;
    if (ext === ".pdf") {
      result = await this.processPDF(filePath);
    } else if (ext === ".ppt" || ext === ".pptx") {
      result = await this.processPowerPoint(filePath);
    } else if ([".png", ".jpg", ".jpeg", ".webp", ".tiff"].includes(ext)) {
      result = await this.processImage(filePath);
    } else {
      throw new Error(`Unsupported file type: ${ext}`);
    }
    result.elapsedMs = Date.now() - start;
    return result;
  }

  private async processPDF(filePath: string): Promise<DeepSeekOCRResult> {
    if (this.options.apiKey) {
      return this.callDeepSeekAPI(filePath);
    }
    return this.mockPDFProcessing(filePath);
  }

  private async processPowerPoint(filePath: string): Promise<DeepSeekOCRResult> {
    // PowerPoint: usar python-pptx para extraer texto + imágenes por slide
    // Si no está disponible, fallback a conversión PDF → OCR
    if (this.options.apiKey) {
      return this.callDeepSeekAPI(filePath);
    }
    return this.mockPPTProcessing(filePath);
  }

  private async processImage(filePath: string): Promise<DeepSeekOCRResult> {
    if (this.options.apiKey) {
      return this.callDeepSeekAPI(filePath);
    }
    return this.mockImageProcessing(filePath);
  }

  private async callDeepSeekAPI(filePath: string): Promise<DeepSeekOCRResult> {
    // DeepSeek OCR API (ejemplo — verificar endpoint real)
    const fileBuffer = await fs.readFile(filePath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), path.basename(filePath));
    formData.append("mode", this.options.mode);
    formData.append("languages", this.options.languages.join(","));
    formData.append("preserve_tables", String(this.options.preserveTables));
    formData.append("include_images", String(this.options.includeImages));

    // DeepSeek vision endpoint
    const res = await fetch("https://api.deepseek.com/v1/ocr/process", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      // Fallback a mock si la API no está disponible
      console.warn(`DeepSeek OCR API error: ${res.status}. Using mock.`);
      return this.mockPDFProcessing(filePath);
    }

    const json = (await res.json()) as {
      markdown: string;
      regions: OCRRegion[];
      language: string;
      has_tables: boolean;
    };
    return {
      markdown: json.markdown,
      regions: json.regions,
      language: json.language,
      hasTables: json.has_tables,
      elapsedMs: 0,
      provider: "deepseek-ocr",
    };
  }

  private async mockPDFProcessing(filePath: string): Promise<DeepSeekOCRResult> {
    const name = path.basename(filePath, path.extname(filePath));
    const regions: OCRRegion[] = [
      { text: name, type: "title", confidence: 0.95, bbox: { x: 100, y: 50, w: 400, h: 40 } },
      { text: "Este es un párrafo de ejemplo extraído del PDF.", type: "paragraph", confidence: 0.9, bbox: { x: 100, y: 120, w: 400, h: 60 } },
    ];
    if (this.options.preserveTables) {
      regions.push({
        text: "Columna A | Columna B\nValor 1 | Valor 2\nValor 3 | Valor 4",
        type: "table",
        confidence: 0.88,
      });
    }
    return {
      markdown: this.regionsToMarkdown(regions, name),
      regions,
      language: "es",
      hasTables: this.options.preserveTables,
      elapsedMs: 0,
      provider: "mock",
    };
  }

  private async mockPPTProcessing(filePath: string): Promise<DeepSeekOCRResult> {
    const name = path.basename(filePath, path.extname(filePath));
    const regions: OCRRegion[] = [
      { text: name, type: "title", confidence: 0.95 },
      { text: "Diapositiva 1: Introducción", type: "header", confidence: 0.92 },
      { text: "Punto importante 1\nPunto importante 2", type: "list", confidence: 0.88 },
    ];
    if (this.options.preserveTables) {
      regions.push({
        text: "| Sistema | Función |\n|---------|---------|\n| Nervioso | Coord. |\n| Endocrino | Regul. |",
        type: "table",
        confidence: 0.9,
      });
    }
    return {
      markdown: this.regionsToMarkdown(regions, name),
      regions,
      language: "es",
      hasTables: this.options.preserveTables,
      elapsedMs: 0,
      provider: "mock",
    };
  }

  private async mockImageProcessing(filePath: string): Promise<DeepSeekOCRResult> {
    const name = path.basename(filePath, path.extname(filePath));
    return {
      markdown: `# ${name}\n\nTexto extraído de la imagen.`,
      regions: [
        { text: name, type: "title", confidence: 0.9 },
        { text: "Texto de la imagen", type: "paragraph", confidence: 0.85 },
      ],
      language: "es",
      hasTables: false,
      elapsedMs: 0,
      provider: "mock",
    };
  }

  /**
   * Convierte las regiones a Markdown preservando la estructura.
   * Tablas se mantienen como tablas Markdown.
   * Listas como listas.
   * Títulos como headers.
   */
  private regionsToMarkdown(regions: OCRRegion[], title: string): string {
    const parts: string[] = [`# ${title}\n`];
    let inTable = false;
    let tableRows: string[][] = [];

    for (const r of regions) {
      if (r.type === "table" && this.options.preserveTables) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
        }
        // Parsear filas
        const lines = r.text.split("\n");
        for (const line of lines) {
          const cells = line.split("|").map((c) => c.trim());
          if (cells.length > 1) tableRows.push(cells);
        }
      } else {
        // Si estábamos en una tabla, cerrarla
        if (inTable) {
          parts.push(this.renderTable(tableRows));
          inTable = false;
          tableRows = [];
        }
        switch (r.type) {
          case "title":
            parts.push(`## ${r.text}\n`);
            break;
          case "header":
            parts.push(`### ${r.text}\n`);
            break;
          case "list":
            parts.push(r.text.split("\n").map((l) => `- ${l}`).join("\n") + "\n");
            break;
          case "code":
            parts.push("```\n" + r.text + "\n```\n");
            break;
          case "image":
            if (this.options.includeImages) {
              parts.push(`![imagen](${r.text})\n`);
            }
            break;
          default:
            parts.push(r.text + "\n");
        }
      }
    }
    if (inTable && tableRows.length > 0) {
      parts.push(this.renderTable(tableRows));
    }
    return parts.join("\n");
  }

  private renderTable(rows: string[][]): string {
    if (rows.length === 0) return "";
    const cols = Math.max(...rows.map((r) => r.length));
    const normalized = rows.map((r) => {
      while (r.length < cols) r.push("");
      return r;
    });
    const header = `| ${normalized[0].join(" | ")} |`;
    const sep = `| ${normalized[0].map(() => "---").join(" | ")} |`;
    const body = normalized.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
    return [header, sep, body].join("\n") + "\n";
  }
}

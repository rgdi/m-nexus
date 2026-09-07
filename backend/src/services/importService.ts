// importService.ts: importers de PDF, Anki, Notion, Obsidian, Roam (Fase 6).
//
// v0.46: extrae texto de PDFs, importa APKG (Anki), parsea exports de
// Notion/Obsidian/Roam. Sin dependencias externas (parsing nativo).

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

export interface ImportResult {
  /** Tipo de fuente */
  source: "pdf" | "anki" | "obsidian" | "notion" | "roam" | "markdown" | "text";
  /** Notas importadas (path -> content) */
  notes: Array<{ path: string; content: string; frontmatter?: Record<string, string> }>;
  /** Tags encontrados */
  tags: string[];
  /** Wikilinks encontrados */
  wikilinks: string[];
  /** Cards SRS encontradas */
  srsCards: number;
  /** Errores durante la importación */
  errors: string[];
  /** Total de bytes procesados */
  bytes: number;
}

export class ImportService {
  /**
   * Auto-detecta el tipo de archivo y lo importa.
   */
  async importFile(filePath: string, options: { vault?: string } = {}): Promise<ImportResult> {
    if (!existsSync(filePath)) {
      return this.emptyResult("text", `File not found: ${filePath}`);
    }
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
      case ".pdf":
        return this.importPDF(filePath);
      case ".apkg":
      case ".zip":
        return this.importAnki(filePath);
      case ".md":
      case ".markdown":
        return this.importMarkdown(filePath, options);
      case ".json":
        // Auto-detect: si tiene 'pages' es Roam, si no Notion
        return this.importJsonAuto(filePath);
      case ".roam":
        return this.importRoam(filePath);
      case ".txt":
      case ".text":
      case "":
        return this.importText(filePath);
      default:
        return this.importText(filePath);
    }
  }

  /**
   * Importa un PDF. Como no podemos parsear PDF sin deps,
   * extraemos texto del stream crudo (works for text-based PDFs).
   */
  importPDF(filePath: string): ImportResult {
    const buffer = readFileSync(filePath);
    const text = this.extractPDFText(buffer.toString("latin1"));
    const notes = [
      {
        path: `Imports/${Date.now()}-pdf-extract.md`,
        content: `# ${this.basename(filePath)} — PDF Extract\n\n${text}`,
      },
    ];
    return {
      source: "pdf",
      notes,
      tags: [],
      wikilinks: [],
      srsCards: 0,
      errors: text.length === 0 ? ["No text extracted (PDF may be image-based, needs OCR)"] : [],
      bytes: buffer.length,
    };
  }

  /**
   * Extrae texto de un PDF binario.
   * Heurística: encuentra streams entre 'BT' y 'ET' (text objects en PDF).
   */
  private extractPDFText(raw: string): string {
    const textSegments: string[] = [];
    const regex = /\(([^)]+)\)\s*Tj/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(raw)) !== null) {
      textSegments.push(m[1]);
    }
    // También Tj' con array
    const arrayRegex = /\[([^\]]+)\]\s*TJ/g;
    while ((m = arrayRegex.exec(raw)) !== null) {
      const inner = m[1].match(/\(([^)]+)\)/g);
      if (inner) {
        textSegments.push(inner.map((s) => s.slice(1, -1)).join(""));
      }
    }
    return textSegments.join(" ").replace(/\\(\d{3})/g, (_m, n) => {
      // Decode octal
      return String.fromCharCode(parseInt(n, 8));
    });
  }

  /**
   * Importa un Anki deck (.apkg is a zip with collection.anki2 SQLite).
   * Sin zip parsing lib, retornamos error explicativo.
   */
  importAnki(filePath: string): ImportResult {
    return {
      source: "anki",
      notes: [],
      tags: [],
      wikilinks: [],
      srsCards: 0,
      errors: [
        "Anki .apkg import requires unzipping and parsing SQLite. Install 'better-sqlite3' and 'yauzl' for full support. File detected: " + this.basename(filePath),
      ],
      bytes: 0,
    };
  }

  /**
   * Auto-detecta Roam vs Notion en un JSON.
   */
  private importJsonAuto(filePath: string): ImportResult {
    try {
      const json = JSON.parse(readFileSync(filePath, "utf8"));
      // Roam: {pages: [...]}
      if (json && typeof json === "object" && !Array.isArray(json) && Array.isArray(json.pages)) {
        return this.importRoam(filePath);
      }
      // Notion: array de pages o single page
      return this.importNotion(filePath);
    } catch (e) {
      return this.emptyResult("notion", `Failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Importa un Markdown simple (con frontmatter).
   */
  importMarkdown(filePath: string, _options: { vault?: string } = {}): ImportResult {
    const content = readFileSync(filePath, "utf8");
    const { frontmatter, body } = this.parseFrontmatter(content);
    const path = this.basename(filePath);
    // Tags del frontmatter
    let tags: string[] = [];
    if (frontmatter.tags) {
      // Soporta [a, b, c] o a, b, c
      const raw = frontmatter.tags;
      if (raw.startsWith("[")) {
        tags = raw.slice(1, -1).split(",").map((t) => t.trim().replace(/['"]/g, "")).filter(Boolean);
      } else {
        tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
      }
    } else {
      tags = this.extractTagsFromBody(body);
    }
    return {
      source: "markdown",
      notes: [{ path, content, frontmatter }],
      tags,
      wikilinks: this.extractWikilinks(body),
      srsCards: (body.match(/::/g) ?? []).length,
      errors: [],
      bytes: content.length,
    };
  }

  /**
   * Importa export de Notion (formato JSON con pages + blocks).
   */
  importNotion(filePath: string): ImportResult {
    try {
      const json = JSON.parse(readFileSync(filePath, "utf8"));
      const notes: Array<{ path: string; content: string; frontmatter?: Record<string, string> }> = [];
      const pages = Array.isArray(json) ? json : [json];
      for (const page of pages) {
        if (!page || typeof page !== "object") continue;
        const title = page.properties?.title?.title?.[0]?.plain_text ?? page.title ?? "Untitled";
        const blocks = page.children ?? page.blocks ?? [];
        const content = `# ${title}\n\n${this.notionBlocksToMarkdown(blocks)}`;
        notes.push({ path: `${title}.md`, content });
      }
      return {
        source: "notion",
        notes,
        tags: [],
        wikilinks: [],
        srsCards: 0,
        errors: [],
        bytes: readFileSync(filePath).length,
      };
    } catch (e) {
      return this.emptyResult("notion", `Failed to parse: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Convierte blocks de Notion a Markdown.
   */
  private notionBlocksToMarkdown(blocks: unknown[]): string {
    if (!Array.isArray(blocks)) return "";
    return blocks
      .map((b: any) => {
        const type = b.type;
        const data = b[type];
        if (!data) return "";
        const text = data.rich_text?.map((r: any) => r.plain_text).join("") ?? "";
        switch (type) {
          case "paragraph":
            return text + "\n\n";
          case "heading_1":
            return `# ${text}\n\n`;
          case "heading_2":
            return `## ${text}\n\n`;
          case "heading_3":
            return `### ${text}\n\n`;
          case "bulleted_list_item":
            return `- ${text}\n`;
          case "numbered_list_item":
            return `1. ${text}\n`;
          case "code":
            return "```\n" + text + "\n```\n\n";
          case "quote":
            return `> ${text}\n\n`;
          default:
            return text + "\n\n";
        }
      })
      .join("");
  }

  /**
   * Importa un Roam Research export.
   * Roam format: JSON con {pages: [{title, children: [{string, children, createTime}]}]}
   */
  importRoam(filePath: string): ImportResult {
    try {
      const json = JSON.parse(readFileSync(filePath, "utf8"));
      const notes: Array<{ path: string; content: string; frontmatter?: Record<string, string> }> = [];
      const pages = json.pages ?? json;
      if (!Array.isArray(pages)) {
        return this.emptyResult("roam", "Expected array of pages");
      }
      for (const page of pages) {
        if (!page.title && !page["page-name"]) continue;
        const title = page.title ?? page["page-name"];
        const content = `# ${title}\n\n${this.roamBlocksToMarkdown(page.children ?? [])}`;
        notes.push({ path: `${title}.md`, content });
      }
      return {
        source: "roam",
        notes,
        tags: [],
        wikilinks: [],
        srsCards: 0,
        errors: [],
        bytes: readFileSync(filePath).length,
      };
    } catch (e) {
      return this.emptyResult("roam", `Failed to parse: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private roamBlocksToMarkdown(blocks: unknown[]): string {
    if (!Array.isArray(blocks)) return "";
    return blocks
      .map((b: any) => {
        if (typeof b === "string") return `- ${b}\n`;
        if (b.string) return `- ${b.string}\n`;
        if (b.text) return `- ${b.text}\n`;
        return "";
      })
      .join("");
  }

  /**
   * Importa un archivo de texto plano.
   */
  importText(filePath: string): ImportResult {
    const content = readFileSync(filePath, "utf8");
    return {
      source: "text",
      notes: [{ path: this.basename(filePath) + ".md", content: `# ${this.basename(filePath)}\n\n${content}` }],
      tags: [],
      wikilinks: this.extractWikilinks(content),
      srsCards: 0,
      errors: [],
      bytes: content.length,
    };
  }

  /**
   * Parsea front matter YAML simple.
   */
  parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { frontmatter: {}, body: content };
    const fm: Record<string, string> = {};
    const lines = match[1].split("\n");
    for (const line of lines) {
      const m = line.match(/^(\w+):\s*(.+)$/);
      if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return { frontmatter: fm, body: content.slice(match[0].length) };
  }

  /**
   * Extrae #tags del body.
   */
  private extractTagsFromBody(body: string): string[] {
    const tags = new Set<string>();
    const regex = /(?:^|[^\w/])#([a-zA-Z][a-zA-Z0-9_\-/]*)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      tags.add(m[1].toLowerCase());
    }
    return Array.from(tags);
  }

  /**
   * Extrae [[wikilinks]] del body.
   */
  private extractWikilinks(body: string): string[] {
    const links: string[] = [];
    const regex = /\[\[([^\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      links.push(m[1].split("|")[0].trim());
    }
    return links;
  }

  private basename(path: string): string {
    return path.split("/").pop() ?? path;
  }

  private emptyResult(source: ImportResult["source"], error: string): ImportResult {
    return {
      source,
      notes: [],
      tags: [],
      wikilinks: [],
      srsCards: 0,
      errors: [error],
      bytes: 0,
    };
  }
}

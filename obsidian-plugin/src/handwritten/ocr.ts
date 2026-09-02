// OCR para apuntes manuscritos digitalizados (PDF / imágenes).
// Backends soportados: tesseract (CLI), local-llm (multimodal local), cloud (Drive/OneDrive OCR).
// El resultado se inyecta como bloque dentro de la nota destino (o se encola en Inbox).

import { App, Notice, TFile, normalizePath } from "obsidian";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { MNexusSettings } from "../types";
import { Logger } from "../utils/logger";
import { FrontmatterManager } from "../metadata/frontmatter";
import { secondsToObsidian } from "../audio/timestamps";

export interface OcrResult {
  text: string;
  pages: number;
  blocks: { page: number; text: string }[];
}

export class HandwrittenOcr {
  private fm: FrontmatterManager;

  constructor(private app: App, private settings: MNexusSettings, private log: Logger) {
    this.fm = new FrontmatterManager(app);
  }

  async process(file: string, targetNotePath?: string): Promise<OcrResult> {
    const backend = this.settings.ocrBackend;
    if (backend === "disabled") throw new Error("OCR deshabilitado en ajustes.");
    const result = await this.run(file, backend);

    // Enrutar igual que audio: nota existe → bloque; no existe → Inbox.
    const target = targetNotePath ?? (await this.guessTarget(file));
    if (target && (await this.app.vault.adapter.exists(target))) {
      await this.linkToNote(file, target, result);
    } else {
      await this.sendToInbox(file, result, target);
    }
    return result;
  }

  // -------------------------------------------------------------------------

  private run(file: string, backend: string): Promise<OcrResult> {
    if (backend === "tesseract") return this.runTesseract(file);
    if (backend === "local-llm") return this.runLocalLlm(file);
    if (backend === "cloud") return this.runCloud(file);
    throw new Error(`Backend OCR no soportado: ${backend}`);
  }

  private runTesseract(file: string): Promise<OcrResult> {
    const out = file + ".ocr";
    return new Promise<OcrResult>((resolve, reject) => {
      const proc = spawn("tesseract", [file, out, "-l", "spa+eng", "pdf"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", async (code) => {
        if (code !== 0) return reject(new Error(`Tesseract (${code}): ${stderr}`));
        const txt = await fs.promises.readFile(out + ".txt", "utf8");
        resolve({ text: txt, pages: 1, blocks: [{ page: 1, text: txt }] });
      });
    });
  }

  private async runLocalLlm(file: string): Promise<OcrResult> {
    if (!this.settings.ocrScriptPath || !fs.existsSync(this.settings.ocrScriptPath)) {
      throw new Error("Script OCR (local LLM) no configurado.");
    }
    return new Promise<OcrResult>((resolve, reject) => {
      const proc = spawn("python3", [this.settings.ocrScriptPath, file], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) return reject(new Error(`OCR LLM (${code}): ${stderr}`));
        try {
          resolve(JSON.parse(stdout) as OcrResult);
        } catch (e) {
          reject(new Error("OCR LLM no devolvió JSON válido: " + (e as Error).message));
        }
      });
    });
  }

  private async runCloud(file: string): Promise<OcrResult> {
    // Stub: integración con Google Vision / Azure OCR.
    // El usuario debe implementar este bridge si lo necesita.
    throw new Error(
      "Backend cloud no implementado por defecto. Conecta tu propio servicio o usa tesseract."
    );
  }

  // -------------------------------------------------------------------------

  private async guessTarget(file: string): Promise<string | undefined> {
    const stem = path.basename(file, path.extname(file)).toLowerCase();
    const notes = this.app.vault.getMarkdownFiles();
    for (const n of notes) {
      const src = this.app.metadataCache.getFileCache(n)?.frontmatter?.handwritten_source;
      if (typeof src === "string" && src.toLowerCase().includes(stem)) return n.path;
      if (n.basename.toLowerCase().includes(stem)) return n.path;
    }
    return undefined;
  }

  private async linkToNote(file: string, notePath: string, ocr: OcrResult) {
    const tfile = this.app.vault.getAbstractFileByPath(notePath);
    if (!(tfile instanceof TFile)) return;
    const block = [
      `\n\n## Apuntes de Cuaderno / Esquemas — ${path.basename(file)}\n`,
      `> [!info] Fuente manuscrita: \`${path.basename(file)}\``,
      "",
      ...ocr.blocks.map((b) => `### Página ${b.page}\n\n${b.text}`),
      "",
    ].join("\n");
    const raw = await this.app.vault.read(tfile);
    await this.app.vault.modify(tfile, raw.trimEnd() + block);
    await this.fm.merge(tfile, {
      has_handwritten_notes: true,
      handwritten_source: path.basename(file),
    });
    new Notice(`OCR de ${path.basename(file)} añadido a ${tfile.basename}.`);
  }

  private async sendToInbox(file: string, ocr: OcrResult, guessed?: string) {
    const inbox = normalizePath(this.settings.handwrittenFolder);
    const parts = inbox.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.createFolder(cur);
      }
    }
    const stem = path.basename(file, path.extname(file));
    const dest = normalizePath(`${inbox}/${stem}.md`);
    const body = [
      "---",
      `title: "Manuscrito pendiente — ${path.basename(file)}"`,
      "mnexus_inbox: true",
      "author_verified: false",
      `pending_link: "${guessed ?? ""}"`,
      "---",
      "",
      `# 🖋️ Manuscrito pendiente: ${path.basename(file)}`,
      "",
      guessed
        ? `> [!warning] **Sospecha:** podría pertenecer a \`${guessed}\`.`
        : "> [!warning] No se detectó nota destino.",
      "",
      "## Texto OCR",
      "",
      ...ocr.blocks.map((b) => `### Página ${b.page}\n\n${b.text}`),
    ].join("\n");
    await this.app.vault.create(dest, body);
    new Notice(`Manuscrito enviado a Inbox.`);
  }
}

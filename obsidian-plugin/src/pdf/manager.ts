// PdfManager: gestiona versiones de PDFs en el vault.
// Almacena metadatos en _M-NEXUS/PDFs/versions.json y los binarios
// en una carpeta del vault. Soporta extracción de texto con pdf.js
// (cargado lazy) o fallback a metadatos.

import { App, TFile, normalizePath } from "obsidian";
import { Logger } from "../utils/logger";
import { sha256Sync } from "../utils/hash";
import { PdfVersion, extractParagraphs } from "./diff";

const VERSIONS_FOLDER = "_M-NEXUS/PDFs";
const VERSIONS_FILE = "versions.json";

export class PdfManager {
  private versions = new Map<string, PdfVersion[]>();
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(private app: App, private log: Logger) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this._load();
    return this.loadingPromise;
  }

  private async _load(): Promise<void> {
    const path = normalizePath(`${VERSIONS_FOLDER}/${VERSIONS_FILE}`);
    if (await this.app.vault.adapter.exists(path)) {
      try {
        const raw = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(raw) as Record<string, PdfVersion[]>;
        for (const [k, v] of Object.entries(parsed)) this.versions.set(k, v);
      } catch (e) {
        this.log.warn(`PDF versions corrupto: ${(e as Error).message}`);
      }
    } else {
      await this.ensureFolder();
    }
    this.loaded = true;
    this.loadingPromise = null;
  }

  private async ensureFolder() {
    const norm = normalizePath(VERSIONS_FOLDER);
    if (await this.app.vault.adapter.exists(norm)) return;
    const parts = norm.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await this.app.vault.adapter.exists(cur))) {
        try { await this.app.vault.createFolder(cur); } catch { /* idempotente */ }
      }
    }
  }

  private async save(): Promise<void> {
    await this.ensureFolder();
    const path = normalizePath(`${VERSIONS_FOLDER}/${VERSIONS_FILE}`);
    const obj: Record<string, PdfVersion[]> = {};
    for (const [k, v] of this.versions) obj[k] = v;
    await this.app.vault.adapter.write(path, JSON.stringify(obj, null, 2));
  }

  /** Devuelve el "slug" de un PDF basado en su nombre canónico. */
  private slugFor(name: string): string {
    return name.replace(/\.pdf$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  /** Lista todas las versiones registradas para un PDF canónico. */
  async listVersions(originalName: string): Promise<PdfVersion[]> {
    await this.load();
    return this.versions.get(this.slugFor(originalName)) ?? [];
  }

  /** Registra una nueva versión de un PDF. */
  async register(file: TFile): Promise<PdfVersion> {
    await this.load();
    const buf = await this.app.vault.readBinary(file);
    const bytes = new Uint8Array(buf);
    const hash = sha256Sync(bytes);
    const slug = this.slugFor(file.name);
    const list = this.versions.get(slug) ?? [];
    // Si el hash ya existe, no duplicar
    if (list.some((v) => v.hash === hash)) {
      return list.find((v) => v.hash === hash)!;
    }
    let text: string | undefined;
    let paragraphs: string[] | undefined;
    try {
      text = await this.extractText(buf);
      paragraphs = extractParagraphs(text);
    } catch (e) {
      this.log.debug(`PDF text extraction no disponible: ${(e as Error).message}`);
    }
    const ver: PdfVersion = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      filePath: file.path,
      uploadedAt: new Date().toISOString(),
      size: buf.byteLength,
      hash,
      text,
      paragraphs,
    };
    list.push(ver);
    list.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    this.versions.set(slug, list);
    await this.save();
    this.log.info(`PDF version registrada: ${slug} v${list.length}`);
    return ver;
  }

  /**
   * Extrae texto de un PDF. Si pdf.js no está disponible, devuelve el
   * binario como latin1 (útil para diff básico si el PDF es texto plano).
   */
  private async extractText(buf: ArrayBuffer): Promise<string> {
    // v0.7: implementación simple. En producción cargar pdf.js dinámicamente.
    // Fallback: leer los streams de texto entre BT/ET (PostScript-like).
    const bytes = new Uint8Array(buf);
    let text = "";
    let inText = false;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x28 /* ( */) inText = true;
      else if (b === 0x29 /* ) */) inText = false;
      else if (inText && b >= 0x20 && b < 0x7f) text += String.fromCharCode(b);
      else if (b === 0x0a) text += "\n";
    }
    return text;
  }

  /**
   * Detecta si hay una versión anterior del PDF en el vault. Si existe,
   * devuelve las dos versiones para diff. Si no, devuelve null.
   *
   * Para evitar ambigüedad entre versiones subidas en el mismo ms, se
   * desempata por `id` (alfabético).
   */
  async detectAndPair(file: TFile): Promise<{ previous: PdfVersion; current: PdfVersion } | null> {
    const list = await this.listVersions(file.name);
    if (list.length < 2) return null;
    // Orden determinista: uploadedAt asc, luego id como tiebreaker
    const sorted = [...list].sort((a, b) => {
      const cmp = a.uploadedAt.localeCompare(b.uploadedAt);
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    });
    const current = await this.register(file);
    // Re-leer la lista actualizada y re-ordenar
    const updated = await this.listVersions(file.name);
    const sortedUpdated = [...updated].sort((a, b) => {
      const cmp = a.uploadedAt.localeCompare(b.uploadedAt);
      return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
    });
    const previous = sortedUpdated[sortedUpdated.length - 2];
    return { previous, current };
  }
}

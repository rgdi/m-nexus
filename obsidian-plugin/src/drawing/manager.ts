// DrawingManager: gestiona documentos de dibujo anclados a notas.
// Almacenamiento: archivos .svg dentro de settings.drawingsFolder.
// Formato del SVG: incluye metadatos en un <metadata> JSON para round-tripping.

import { App, normalizePath, TAbstractFile, TFile } from "obsidian";
import { DrawingDocument, DrawingShape, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";

const SVG_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400">
<metadata>{meta}</metadata>
<g id="mnexus-canvas" stroke-linecap="round" stroke-linejoin="round">`;

const SVG_FOOTER = `</g></svg>`;

export class DrawingManager {
  constructor(private app: App, private settings: MNexusSettings, private log: Logger) {}

  /** Crea un documento de dibujo nuevo y devuelve su path. */
  async create(notePath: string, anchor?: string): Promise<{ path: string; doc: DrawingDocument }> {
    await this.ensureFolder();
    const id = `draw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const fileName = `${id}.svg`;
    const path = normalizePath(`${this.settings.drawingsFolder}/${fileName}`);
    const doc: DrawingDocument = {
      id,
      notePath,
      anchor,
      shapes: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.app.vault.create(path, this.renderSvg(doc));
    this.log.info(`Dibujo creado: ${path}`);
    return { path, doc };
  }

  /** Lee un documento de dibujo desde un .svg. */
  async read(svgPath: string): Promise<DrawingDocument | null> {
    const file = this.app.vault.getAbstractFileByPath(svgPath);
    if (!(file instanceof TFile)) return null;
    const text = await this.app.vault.read(file);
    const metaMatch = text.match(/<metadata>([\s\S]*?)<\/metadata>/);
    if (!metaMatch) return null;
    try {
      return JSON.parse(metaMatch[1]) as DrawingDocument;
    } catch {
      return null;
    }
  }

  /** Persiste un documento de dibujo. */
  async save(doc: DrawingDocument, svgPath: string): Promise<void> {
    doc.updatedAt = new Date().toISOString();
    const file: TAbstractFile | null = this.app.vault.getAbstractFileByPath(svgPath);
    if (file instanceof TFile) {
      await this.app.vault.modify(file, this.renderSvg(doc));
    }
  }

  /** Lista dibujos asociados a una nota. */
  async listForNote(notePath: string): Promise<{ path: string; doc: DrawingDocument }[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.drawingsFolder));
    if (!folder) return [];
    const out: { path: string; doc: DrawingDocument }[] = [];
    for (const child of (folder as unknown as { children?: TFile[] }).children ?? []) {
      if (!(child instanceof TFile)) continue;
      if (!child.name.endsWith(".svg")) continue;
      const doc = await this.read(child.path);
      if (doc && doc.notePath === notePath) {
        out.push({ path: child.path, doc });
      }
    }
    return out;
  }

  /** Genera un enlace wikilink para insertar el dibujo en una nota. */
  embedWikilink(svgPath: string, size?: { width: number; height: number }): string {
    const w = size?.width ?? this.settings.drawingDefaultSize.width;
    const h = size?.height ?? this.settings.drawingDefaultSize.height;
    return `![[${svgPath}|${w}x${h}]]`;
  }

  /** Detecta si Excalidraw está instalado. */
  hasExcalidraw(): boolean {
    // @ts-ignore - Excalidraw se registra como plugin app.plugins.plugins["obsidian-excalidraw-plugin"]
    const plugins = (this.app as unknown as { plugins?: { plugins: Record<string, unknown> } }).plugins?.plugins ?? {};
    return "obsidian-excalidraw-plugin" in plugins;
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private renderSvg(doc: DrawingDocument): string {
    const meta = JSON.stringify(doc).replace(/<\//g, "<\\/");
    const body = doc.shapes.map((s) => this.shapeToSvg(s)).join("\n");
    return `${SVG_HEADER.replace("{meta}", meta)}\n${body}\n${SVG_FOOTER}`;
  }

  private shapeToSvg(s: DrawingShape): string {
    if (s.type === "path" && s.points.length >= 4) {
      const d = s.points
        .reduce((acc, n, i) => acc + (i % 2 === 0 ? ` ${i === 0 ? "M" : "L"} ${n}` : ` ${n}`), "")
        .trim();
      return `<path d="${d}" fill="none" stroke="${s.stroke ?? "#1f6feb"}" stroke-width="${s.strokeWidth ?? 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (s.type === "rect" && s.points.length >= 4) {
      const [x, y, x2, y2] = s.points;
      return `<rect x="${Math.min(x, x2)}" y="${Math.min(y, y2)}" width="${Math.abs(x2 - x)}" height="${Math.abs(y2 - y)}" fill="none" stroke="${s.stroke ?? "#1f6feb"}" stroke-width="${s.strokeWidth ?? 2}"/>`;
    }
    if (s.type === "circle" && s.points.length >= 4) {
      const [x, y, x2, y2] = s.points;
      const r = Math.hypot(x2 - x, y2 - y);
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${s.stroke ?? "#1f6feb"}" stroke-width="${s.strokeWidth ?? 2}"/>`;
    }
    if (s.type === "text" && s.points.length >= 2) {
      return `<text x="${s.points[0]}" y="${s.points[1]}" fill="${s.stroke ?? "#1f6feb"}" font-family="sans-serif" font-size="14">${(s.text ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!)}</text>`;
    }
    return "";
  }

  private async ensureFolder(): Promise<void> {
    const norm = normalizePath(this.settings.drawingsFolder);
    if (await this.app.vault.adapter.exists(norm)) return;
    const parts = norm.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}

// PhotoManager: manejo de imágenes/fotos en el vault.
// Almacena imágenes en _M-NEXUS/Photos/, extrae metadatos y permite
// generar flashcards con image occlusion.

import { App, normalizePath, TFile } from "obsidian";
import { Logger } from "../utils/logger";
import { sanitizeFilename, buildFilename } from "../utils/paths";

export interface PhotoMetadata {
  path: string;
  name: string;
  size: number;
  /** Ancho y alto en píxeles (si se puede extraer). */
  width?: number;
  height?: number;
  /** Caption/descripción opcional. */
  caption?: string;
  /** Fecha de subida. */
  uploadedAt: string;
  /** OCR si se ha hecho. */
  ocrText?: string;
}

export class PhotoManager {
  private photos = new Map<string, PhotoMetadata>();

  constructor(
    private app: App,
    private photosFolder: string,
    private log: Logger
  ) {}

  async ensureFolder(): Promise<void> {
    const norm = normalizePath(this.photosFolder);
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

  /**
   * Procesa un archivo (drag/drop, paste o file picker) y lo guarda
   * en la carpeta de fotos. Devuelve el path.
   */
  async importPhoto(file: File, caption?: string): Promise<PhotoMetadata> {
    await this.ensureFolder();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const filename = buildFilename(sanitizeFilename(baseName), ext);
    const path = normalizePath(`${this.photosFolder}/${filename}`);

    const buffer = await file.arrayBuffer();
    await this.app.vault.adapter.writeBinary(path, buffer);

    const meta: PhotoMetadata = {
      path,
      name: filename,
      size: file.size,
      caption,
      uploadedAt: new Date().toISOString(),
    };
    this.photos.set(path, meta);
    this.log.info(`Foto importada: ${path} (${file.size} bytes)`);
    return meta;
  }

  /**
   * Procesa un paste del clipboard (imagen).
   */
  async importFromClipboard(): Promise<PhotoMetadata | null> {
    if (typeof ClipboardItem === "undefined") {
      this.log.warn("Clipboard API no disponible.");
      return null;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const ext = type.split("/")[1] ?? "png";
            const file = new File([blob], `paste-${Date.now()}.${ext}`, { type });
            return this.importPhoto(file);
          }
        }
      }
    } catch (e) {
      this.log.warn(`Paste no disponible: ${(e as Error).message}`);
    }
    return null;
  }

  /**
   * Lista todas las fotos del vault.
   */
  async listPhotos(): Promise<PhotoMetadata[]> {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.photosFolder));
    if (!folder) return [];
    const out: PhotoMetadata[] = [];
    for (const child of (folder as unknown as { children: TFile[] }).children ?? []) {
      if (!(child instanceof TFile)) continue;
      if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(child.name)) continue;
      out.push({
        path: child.path,
        name: child.name,
        size: child.stat.size,
        uploadedAt: new Date(child.stat.ctime).toISOString(),
      });
    }
    return out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  /**
   * Genera un wikilink para embeber la foto en una nota.
   */
  embedWikilink(path: string, size?: { width: number; height: number }): string {
    const w = size?.width ?? 600;
    const h = size?.height ?? 400;
    return `![[${path}|${w}x${h}]]`;
  }

  /**
   * Devuelve un dataURL de la imagen (para usar en canvas/image occlusion).
   */
  async toDataUrl(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`No se encontró: ${path}`);
    const buffer = await this.app.vault.readBinary(file);
    const ext = path.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    // Convertir ArrayBuffer → base64
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${mime};base64,${btoa(binary)}`;
  }
}

/** Crea un file-like object desde un dataURL. */
export function dataUrlToFile(dataUrl: string, name: string): File {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta.match(/data:([^;]+)/)?.[1] ?? "image/png";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

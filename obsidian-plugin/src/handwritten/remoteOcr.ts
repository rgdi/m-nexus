// RemoteOcr: thin-client que delega el OCR al backend.
// v0.8: el plugin NO usa Tesseract local. Solo envía la imagen y recibe texto.

import { App, TFile, normalizePath } from "obsidian";
import { RemoteClient } from "../server/remoteClient";
import { MNexusSettings } from "../types";
import { OcrResult } from "./ocr";
import { Logger } from "../utils/logger";
import { OfflineQueue } from "../server/offlineQueue";

export class RemoteOcr {
  constructor(
    private app: App,
    private settings: MNexusSettings,
    private remote: RemoteClient,
    private queue: OfflineQueue,
    private log: Logger
  ) {}

  shouldUseRemote(): boolean {
    if (this.settings.forceRemote) return true;
    return (this.settings.ocrBackend as string) === "remote";
  }

  async process(imagePath: string, targetNotePath?: string): Promise<OcrResult> {
    if (!this.shouldUseRemote()) {
      throw new Error(
        "forceRemote=true. Configura backendUrl o desactiva forceRemote para usar Tesseract local."
      );
    }
    if (!this.remote.hasBackend()) {
      throw new Error("Backend no configurado.");
    }
    const base64 = await this.readImageBase64(imagePath);
    try {
      const res = await this.remote.ocr({ imageBase64: base64, preprocess: true });
      this.log.info(`OCR remoto: ${res.text.length} chars, confianza ${(res.confidence * 100).toFixed(1)}%`);
      return {
        text: res.text,
        pages: 1,
        blocks: res.blocks.map((b, i) => ({ page: Math.floor(i / 10) + 1, text: b.text })),
      };
    } catch (e) {
      this.log.warn(`Backend caído en OCR: ${(e as Error).message}. Encolando.`);
      await this.queue.enqueueFileChange({
        kind: "upsert",
        path: imagePath,
        hash: "ocr-pending",
        content: JSON.stringify({ imagePath, targetNotePath }),
        modifiedAt: new Date().toISOString(),
      });
      throw e;
    }
  }

  private async readImageBase64(imagePath: string): Promise<string> {
    const norm = normalizePath(imagePath);
    const file = this.app.vault.getAbstractFileByPath(norm);
    if (!file) throw new Error(`Imagen no encontrada: ${imagePath}`);
    const buf = await this.app.vault.readBinary(file as never);
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
}

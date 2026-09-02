// HTRManager: punto único de acceso al provider HTR activo.
// Similar a LLMManager: registry + cache.

import { HTRProvider } from "./provider";
import { RenderedOcrProvider } from "./renderedOcr";
import { MyScriptHtrProvider } from "./myscript";
import { MNexusSettings, HTRBackend } from "../types";
import { Logger } from "../utils/logger";

export class HTRManager {
  private current: HTRProvider | null = null;
  private currentId: HTRBackend | null = null;

  constructor(
    private settings: MNexusSettings,
    private log: Logger
  ) {}

  getProvider(): HTRProvider {
    const id = this.settings.htrBackend;
    if (id === "disabled") {
      throw new Error("HTR deshabilitado. Actívalo en Ajustes → M-NEXUS → HTR.");
    }
    if (this.current && this.currentId === id) return this.current;
    this.current = this.createProvider(id);
    this.currentId = id;
    return this.current;
  }

  tryGetProvider(): HTRProvider | null {
    try {
      const p = this.getProvider();
      if (!p.isConfigured()) return null;
      return p;
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return this.tryGetProvider() !== null;
  }

  private createProvider(id: HTRBackend): HTRProvider {
    if (id === "rendered-ocr") {
      return new RenderedOcrProvider(
        () => this.settings.htrScriptPath,
        this.log
      );
    }
    if (id === "myscript") {
      return new MyScriptHtrProvider({
        appKey: this.settings.myscriptAppKey,
        appSecret: this.settings.myscriptAppSecret,
      });
    }
    if (id === "local-ml") {
      // Stub: implementar si quieres usar TrOCR local
      throw new Error("Local ML HTR no implementado. Usa 'rendered-ocr' o 'myscript'.");
    }
    throw new Error(`HTR backend desconocido: ${id}`);
  }
}

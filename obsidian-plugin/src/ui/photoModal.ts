// PhotoModal: importar fotos por file picker, paste, drag-drop.
// Tras importar, ofrece OCR automático y/o crear flashcards con image occlusion.

import { App, Modal } from "obsidian";
import { PhotoManager } from "../photos/manager";
import { HandwrittenOcr } from "../handwritten/ocr";
import { HTRManager } from "../htr/manager";
import { ImageOcclusionBuilder } from "../flashcards/imageOcclusion";
import { MNexusSettings } from "../types";

export class PhotoModal extends Modal {
  private imgEl: HTMLImageElement | null = null;
  private resultEl: HTMLElement | null = null;
  private importedPath: string | null = null;

  constructor(
    app: App,
    private settings: MNexusSettings,
    private photos: PhotoManager,
    private ocr: HandwrittenOcr,
    private htr: HTRManager,
    private occlusionBuilder: ImageOcclusionBuilder
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "500px";
    contentEl.createEl("h2", { text: "📷 Importar foto o imagen" });

    // Drop zone
    const dropZone = contentEl.createDiv({ cls: "mnexus-dropzone" });
    dropZone.style.cssText = "border:2px dashed var(--background-modifier-border);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:all 0.2s;";
    dropZone.textContent = "Arrastra una imagen aquí · o click para seleccionar · o Ctrl+V para pegar";
    dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropZone.style.background = "var(--background-modifier-hover)";
      dropZone.style.borderColor = "var(--interactive-accent)";
    });
    dropZone.addEventListener("dragleave", () => {
      dropZone.style.background = "";
      dropZone.style.borderColor = "";
    });
    dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropZone.style.background = "";
      dropZone.style.borderColor = "";
      const file = e.dataTransfer?.files?.[0];
      if (file) await this.handleFile(file);
    });
    dropZone.addEventListener("click", () => this.pickFile());

    // Paste handler
    this.contentEl.addEventListener("paste", async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            await this.handleFile(file);
            return;
          }
        }
      }
    });

    // Botón pegar desde portapapeles
    const pasteBtn = contentEl.createEl("button", { text: "📋 Pegar del portapapeles" });
    pasteBtn.style.cssText = "margin-top:8px;width:100%;";
    pasteBtn.onclick = async () => {
      const meta = await this.photos.importFromClipboard();
      if (meta) {
        this.importedPath = meta.path;
        this.showPreview();
      } else {
        alert("No hay imagen en el portapapeles. Usa Ctrl+V o arrastra una imagen.");
      }
    };

    // Result area
    this.resultEl = contentEl.createDiv();
  }

  private async pickFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) await this.handleFile(f);
    };
    input.click();
  }

  private async handleFile(file: File) {
    try {
      const meta = await this.photos.importPhoto(file);
      this.importedPath = meta.path;
      this.showPreview();
    } catch (e) {
      alert("Error importando: " + (e as Error).message);
    }
  }

  private async showPreview() {
    if (!this.resultEl || !this.importedPath) return;
    this.resultEl.empty();
    const path = this.importedPath;
    this.resultEl.createEl("p", { text: "✔ Foto importada: " + path, cls: "mnexus-label" });

    // Preview
    this.imgEl = this.resultEl.createEl("img");
    this.imgEl.src = await this.photos.toDataUrl(path);
    this.imgEl.style.cssText = "max-width:100%;max-height:300px;display:block;margin:8px auto;border-radius:6px;";

    // Acciones
    const actions = this.resultEl.createDiv();
    actions.style.cssText = "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;";

    const ocrBtn = actions.createEl("button", { text: "🔍 OCR (extraer texto)" });
    ocrBtn.onclick = async () => {
      ocrBtn.textContent = "Procesando…";
      try {
        const result = await this.ocr.process(path);
        const out = this.resultEl!.createDiv({ cls: "mnexus-photo-ocr" });
        out.createEl("strong", { text: "Texto extraído:" });
        const ta = out.createEl("textarea") as HTMLTextAreaElement;
        ta.value = result.text;
        ta.rows = 6;
        ta.style.cssText = "width:100%;margin:4px 0;";
        const insertBtn = out.createEl("button", { text: "📥 Insertar en nota activa" });
        insertBtn.onclick = async () => {
          const file = this.app.workspace.getActiveFile();
          if (!file) {
            alert("Abre una nota para insertar el texto.");
            return;
          }
          const content = await this.app.vault.read(file);
          const block = `\n\n## 📷 ${path.split("/").pop()}\n\n![[${path}]]\n\n${ta.value}\n`;
          await this.app.vault.modify(file, content.trimEnd() + block);
          this.close();
        };
      } catch (e) {
        alert("OCR falló: " + (e as Error).message);
      } finally {
        ocrBtn.textContent = "🔍 OCR (extraer texto)";
      }
    };

    const occlusionBtn = actions.createEl("button", { text: "🖼 Crear flashcards con oclusión" });
    occlusionBtn.onclick = async () => {
      try {
        const jsonPath = await this.occlusionBuilder.create(path);
        new ImageOcclusionModal(this.app, this.occlusionBuilder, jsonPath, file => {
          // Tras crear oclusiones, generar drafts
          alert(`${file.length} oclusiones guardadas. Se crearán las flashcards al aprobarlas.`);
        }).open();
        this.close();
      } catch (e) {
        alert("Error: " + (e as Error).message);
      }
    };

    const insertBtn = actions.createEl("button", { text: "📥 Insertar en nota" });
    insertBtn.onclick = async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        alert("Abre una nota donde insertar.");
        return;
      }
      const content = await this.app.vault.read(file);
      const link = this.photos.embedWikilink(path);
      await this.app.vault.modify(file, content.trimEnd() + `\n\n${link}\n`);
      this.close();
    };
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Modal para crear oclusiones sobre una imagen. */
export class ImageOcclusionModal extends Modal {
  private img: HTMLImageElement | null = null;
  private imgEl: HTMLImageElement | null = null;
  private occlusions: { x: number; y: number; width: number; height: number; label: string }[] = [];
  private startX = 0;
  private startY = 0;
  private currentRect: SVGRectElement | null = null;

  constructor(
    app: App,
    private builder: ImageOcclusionBuilder,
    private jsonPath: string,
    private onSave: (cards: { front: string; back: string }[]) => void
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "700px";
    contentEl.createEl("h2", { text: "🖼 Image Occlusion" });
    const doc = await this.builder.load(this.jsonPath);
    contentEl.createEl("p", {
      text: "Arrastra sobre la imagen para marcar regiones. Escribe la etiqueta de cada una.",
      cls: "mnexus-label",
    });

    // Imagen
    const wrap = contentEl.createDiv();
    wrap.style.cssText = "position:relative;display:inline-block;margin:8px 0;border:1px solid var(--background-modifier-border);";
    this.imgEl = wrap.createEl("img");
    this.imgEl.src = await this.app.vault.adapter.readBinary(doc.imagePath).then(buf => {
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return `data:image/${doc.imagePath.split(".").pop()};base64,${btoa(bin)}`;
    });
    this.imgEl.style.cssText = "display:block;max-width:600px;max-height:500px;user-select:none;";
    this.imgEl.draggable = false;
    await new Promise((r) => (this.imgEl!.onload = r));

    // SVG overlay para dibujar rectángulos
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    svg.setAttribute("width", String(this.imgEl.naturalWidth || this.imgEl.clientWidth));
    svg.setAttribute("height", String(this.imgEl.naturalHeight || this.imgEl.clientHeight));
    svg.style.cssText = "position:absolute;top:0;left:0;cursor:crosshair;";
    wrap.appendChild(svg);
    this.img = this.imgEl; // alias

    // Mouse handlers
    svg.addEventListener("pointerdown", (e) => {
      const rect = svg.getBoundingClientRect();
      this.startX = e.clientX - rect.left;
      this.startY = e.clientY - rect.top;
      this.currentRect = document.createElementNS("http://www.w3.org/2000/svg", "rect") as SVGRectElement;
      this.currentRect.setAttribute("x", String(this.startX));
      this.currentRect.setAttribute("y", String(this.startY));
      this.currentRect.setAttribute("width", "0");
      this.currentRect.setAttribute("height", "0");
      this.currentRect.setAttribute("fill", "rgba(255, 200, 0, 0.4)");
      this.currentRect.setAttribute("stroke", "#ffc800");
      this.currentRect.setAttribute("stroke-width", "2");
      svg.appendChild(this.currentRect);
      (e.target as Element).setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!this.currentRect) return;
      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this.currentRect.setAttribute("x", String(Math.min(x, this.startX)));
      this.currentRect.setAttribute("y", String(Math.min(y, this.startY)));
      this.currentRect.setAttribute("width", String(Math.abs(x - this.startX)));
      this.currentRect.setAttribute("height", String(Math.abs(y - this.startY)));
    });
    svg.addEventListener("pointerup", (e) => {
      if (!this.currentRect) return;
      const x = parseFloat(this.currentRect.getAttribute("x") ?? "0");
      const y = parseFloat(this.currentRect.getAttribute("y") ?? "0");
      const w = parseFloat(this.currentRect.getAttribute("width") ?? "0");
      const h = parseFloat(this.currentRect.getAttribute("height") ?? "0");
      if (w > 10 && h > 10) {
        const label = window.prompt("Etiqueta (respuesta) de esta región:");
        if (label) {
          // Guardar coordenadas en píxeles de la imagen original
          const scaleX = (this.imgEl!.naturalWidth || this.imgEl!.clientWidth) / svg.getBoundingClientRect().width;
          const scaleY = (this.imgEl!.naturalHeight || this.imgEl!.clientHeight) / svg.getBoundingClientRect().height;
          this.occlusions.push({ x: x * scaleX, y: y * scaleY, width: w * scaleX, height: h * scaleY, label });
        }
        // Cambiar el color del rect a verde (guardado)
        this.currentRect.setAttribute("fill", "rgba(63, 185, 80, 0.4)");
        this.currentRect.setAttribute("stroke", "#3fb950");
      } else {
        this.currentRect.remove();
      }
      this.currentRect = null;
    });

    // Acciones
    const actions = contentEl.createDiv();
    actions.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    const saveBtn = actions.createEl("button", { text: "💾 Guardar y generar flashcards" });
    saveBtn.onclick = async () => {
      // Guardar cada oclusión
      const loaded = await this.builder.load(this.jsonPath);
      loaded.occlusions = this.occlusions.map((o) => ({ ...o, id: `occ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }));
      await this.builder.save(this.jsonPath, loaded);
      const cards = this.builder.toDrafts(loaded, this.jsonPath).map((c) => ({ front: c.front, back: c.back }));
      this.onSave(cards);
      this.close();
    };
    const cancelBtn = actions.createEl("button", { text: "Cancelar" });
    cancelBtn.onclick = () => this.close();

    const count = contentEl.createEl("p", { text: `Oclusiones: ${this.occlusions.length}`, cls: "mnexus-label" });
    this.contentEl.appendChild(count);
  }

  onClose() {
    this.contentEl.empty();
  }
}

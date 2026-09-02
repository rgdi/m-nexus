// v0.26: Toolbar mejorada tipo Samsung Notes con:
// - Undo/Redo (Ctrl+Z / Ctrl+Y)
// - Selector de color con paleta completa
// - Selector de grosor
// - Postits virtuales (sticky notes)
// - Capas (z-index management)
// - Persistencia inmediata

import { App, Editor, MarkdownView, Plugin } from "obsidian";
import type { AnnotationStore, Annotation, SpatialAnnotation, TextRangeAnnotation, AnnotationStyle } from "../annotations/noteAnnotations";
import { StickyNoteManager, type StickyColor, type StickyStyle } from "../annotations/stickyNotes";

export type AnnotationTool =
  | "select"
  | "hand"
  | "highlight"
  | "underline"
  | "strike"
  | "freehand"
  | "arrow"
  | "rectangle"
  | "circle"
  | "text"
  | "sticky"
  | "sticker"
  | "comment"
  | "image-stamp"
  | "link"
  | "eraser";

const STICKY_COLORS: Array<{ name: StickyColor; label: string; shortcut: string }> = [
  { name: "yellow", label: "🟡 Amarillo", shortcut: "q" },
  { name: "pink", label: "🩷 Rosa", shortcut: "w" },
  { name: "blue", label: "🔵 Azul", shortcut: "e" },
  { name: "green", label: "🟢 Verde", shortcut: "r" },
  { name: "purple", label: "🟣 Morado", shortcut: "t" },
  { name: "orange", label: "🟠 Naranja", shortcut: "y" },
  { name: "white", label: "⚪ Blanco", shortcut: "u" },
];

const COLORS: Array<{ name: string; value: string; shortcut: string }> = [
  { name: "Amarillo", value: "#FFEB3B", shortcut: "1" },
  { name: "Rojo", value: "#F44336", shortcut: "2" },
  { name: "Verde", value: "#4CAF50", shortcut: "3" },
  { name: "Azul", value: "#2196F3", shortcut: "4" },
  { name: "Morado", value: "#9C27B0", shortcut: "5" },
  { name: "Naranja", value: "#FF9800", shortcut: "6" },
  { name: "Negro", value: "#000000", shortcut: "7" },
  { name: "Blanco", value: "#FFFFFF", shortcut: "8" },
];

const STICKERS = ["⭐", "❤️", "🔥", "💡", "⚠️", "❌", "✅", "❓", "📌", "🎯", "💊", "🧬", "🦠", "🧠", "🫀", "🫁", "🩺", "🧪", "🔬", "📚", "✏️", "🖍️", "📌", "💉", "🧫"];

const STROKE_WIDTHS = [
  { name: "Fino", value: 1 },
  { name: "Medio", value: 3 },
  { name: "Grueso", value: 6 },
  { name: "Extra", value: 10 },
];

interface UndoEntry {
  type: "add" | "remove" | "update";
  annotation: Annotation;
  previous?: Annotation;
}

export class AnnotationToolbar {
  private toolbarEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private currentView: MarkdownView | null = null;
  private currentTool: AnnotationTool = "select";
  private currentColor: string = COLORS[0].value;
  private currentStrokeWidth: number = 3;
  private isDrawing = false;
  private drawPoints: Array<{ x: number; y: number; pressure?: number }> = [];
  private startPos: { x: number; y: number } | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private stickyManager: StickyNoteManager | null = null;
  private layerPanelEl: HTMLElement | null = null;
  private showLayers = false;
  private scale = 1;
  private minimap: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(private opts: { store: AnnotationStore; plugin: Plugin; app: App }) {}

  /** Monta la toolbar + overlay + sticky manager sobre el editor. */
  mount(view: MarkdownView): void {
    this.unmount();
    this.currentView = view;
    const container = view.containerEl;
    const file = view.file;

    // Toolbar
    this.toolbarEl = this.createToolbarElement();
    container.prepend(this.toolbarEl);

    // Status bar
    this.statusEl = this.createStatusElement();
    this.toolbarEl.after(this.statusEl);

    // Overlay (capa de dibujo, no destructiva)
    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "mnexus-annotation-overlay";
    this.overlayEl.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 50;
      overflow: hidden;
    `;
    container.appendChild(this.overlayEl);

    // Sticky notes container (encima del overlay)
    const stickyContainer = document.createElement("div");
    stickyContainer.className = "mnexus-sticky-container";
    stickyContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 100;
    `;
    container.appendChild(stickyContainer);

    // Sticky manager
    this.stickyManager = new StickyNoteManager(this.opts.app, this.opts.store);
    this.stickyManager.mount(stickyContainer);

    // Layer panel (oculto por defecto)
    this.layerPanelEl = this.createLayerPanel();

    // Cargar anotaciones existentes en el overlay
    if (file) this.refreshOverlay(file.path);

    // Listeners
    this.overlayEl.addEventListener("mousedown", (e) => this.onMouseDown(e, view));
    this.overlayEl.addEventListener("mousemove", (e) => this.onMouseMove(e, view));
    this.overlayEl.addEventListener("mouseup", (e) => this.onMouseUp(e, view));
    this.overlayEl.addEventListener("dblclick", (e) => this.onDoubleClick(e, view));

    // Keyboard shortcuts
    this.bindKeyboardShortcuts();

    // Resize observer
    const ro = new ResizeObserver(() => {
      this.updateStatus({ info: "Listo" });
    });
    ro.observe(container);
  }

  /** v0.28: toggle de la toolbar (mount/unmount). */
  toggle(): void {
    if (this.toolbarEl) {
      this.unmount();
    } else if (this.currentView) {
      this.mount(this.currentView);
    }
  }

  /** v0.28: getter para la view actual. */
  getCurrentView(): MarkdownView | null {
    return this.currentView;
  }

  unmount(): void {
    if (this.toolbarEl) { this.toolbarEl.remove(); this.toolbarEl = null; }
    if (this.statusEl) { this.statusEl.remove(); this.statusEl = null; }
    if (this.overlayEl) { this.overlayEl.remove(); this.overlayEl = null; }
    if (this.layerPanelEl) { this.layerPanelEl.remove(); this.layerPanelEl = null; }
    if (this.minimap) { this.minimap.remove(); this.minimap = null; }
    if (this.stickyManager) { this.stickyManager.unmount(); this.stickyManager = null; }
    this.unbindKeyboardShortcuts();
  }

  setTool(tool: AnnotationTool): void {
    this.currentTool = tool;
    this.updateToolButtons();
    this.updateOverlayProperties();
    this.updateStatus({ info: `Herramienta: ${tool}` });
  }

  setColor(color: string): void {
    this.currentColor = color;
    this.updateColorButtons();
  }

  setStrokeWidth(w: number): void {
    this.currentStrokeWidth = w;
    this.updateStrokeButtons();
  }

  toggleLayers(): void {
    this.showLayers = !this.showLayers;
    if (this.showLayers && this.layerPanelEl) {
      document.body.appendChild(this.layerPanelEl);
      this.refreshLayerList();
    } else if (this.layerPanelEl) {
      this.layerPanelEl.remove();
    }
  }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    if (entry.type === "add") {
      // Revertir: eliminar
      this.opts.store.remove(entry.annotation.id, entry.annotation.notePath);
    } else if (entry.type === "remove" && entry.previous) {
      // Revertir: volver a añadir
      this.opts.store.add(entry.previous);
    } else if (entry.type === "update" && entry.previous) {
      // Revertir: update con previous
      this.opts.store.update(entry.previous.id, entry.previous.notePath, entry.previous);
    }
    this.redoStack.push(entry);
    this.refreshOverlay(entry.annotation.notePath);
    this.updateStatus({ info: `↶ Deshecho` });
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    if (entry.type === "add") {
      this.opts.store.add(entry.annotation);
    } else if (entry.type === "remove") {
      this.opts.store.remove(entry.annotation.id, entry.annotation.notePath);
    } else if (entry.type === "update") {
      this.opts.store.update(entry.annotation.id, entry.annotation.notePath, entry.annotation);
    }
    this.undoStack.push(entry);
    this.refreshOverlay(entry.annotation.notePath);
    this.updateStatus({ info: `↷ Rehecho` });
  }

  pushUndo(entry: UndoEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }

  // ─── Creación de elementos UI ──────────────────────────────

  private createToolbarElement(): HTMLElement {
    const el = document.createElement("div");
    el.className = "mnexus-annotation-toolbar";
    el.style.cssText = `
      position: sticky;
      top: 0;
      z-index: 1000;
      display: flex;
      gap: 4px;
      padding: 6px 8px;
      background: linear-gradient(180deg, var(--background-secondary) 0%, var(--background-secondary) 90%, transparent 100%);
      border-bottom: 1px solid var(--background-modifier-border);
      flex-wrap: wrap;
      align-items: center;
      backdrop-filter: blur(8px);
    `;
    this.renderToolbarContent(el);
    return el;
  }

  private createStatusElement(): HTMLElement {
    const el = document.createElement("div");
    el.className = "mnexus-annotation-status";
    el.style.cssText = `
      position: sticky;
      top: 48px;
      z-index: 999;
      padding: 4px 12px;
      background: var(--background-secondary);
      border-bottom: 1px solid var(--background-modifier-border);
      color: var(--text-muted);
      font-size: 11px;
      font-family: ui-monospace, monospace;
      display: flex;
      gap: 12px;
    `;
    return el;
  }

  private renderToolbarContent(el: HTMLElement): void {
    // Tools (izquierda)
    const toolsGroup = this.createGroup();
    const tools: Array<{ tool: AnnotationTool; icon: string; label: string }> = [
      { tool: "select", icon: "🖱", label: "Seleccionar (V)" },
      { tool: "hand", icon: "✋", label: "Mano (H)" },
      { tool: "highlight", icon: "🖊", label: "Resaltar (G)" },
      { tool: "underline", icon: "U̲", label: "Subrayar (U)" },
      { tool: "strike", icon: "S̶", label: "Tachar (D)" },
      { tool: "freehand", icon: "✏️", label: "Dibujar (P)" },
      { tool: "arrow", icon: "➡", label: "Flecha (A)" },
      { tool: "rectangle", icon: "▭", label: "Rectángulo (R)" },
      { tool: "circle", icon: "○", label: "Círculo (C)" },
      { tool: "text", icon: "T", label: "Texto (T)" },
      { tool: "sticky", icon: "📝", label: "Postit (N)" },
      { tool: "sticker", icon: "😀", label: "Sticker (E)" },
      { tool: "comment", icon: "💬", label: "Comentario (M)" },
      { tool: "image-stamp", icon: "🖼", label: "Sello (I)" },
      { tool: "link", icon: "🔗", label: "Enlace (L)" },
      { tool: "eraser", icon: "🧹", label: "Borrador (X)" },
    ];
    for (const t of tools) {
      const btn = document.createElement("button");
      btn.className = "mnexus-tool-btn";
      btn.dataset.tool = t.tool;
      btn.title = t.label;
      btn.textContent = t.icon;
      btn.style.cssText = `
        padding: 4px 8px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        line-height: 1;
        min-width: 30px;
      `;
      btn.onclick = () => this.setTool(t.tool);
      toolsGroup.appendChild(btn);
    }
    el.appendChild(toolsGroup);

    el.appendChild(this.createSeparator());

    // Colores
    const colorsGroup = this.createGroup();
    for (const c of COLORS) {
      const colorBtn = document.createElement("button");
      colorBtn.className = "mnexus-color-btn";
      colorBtn.dataset.color = c.value;
      colorBtn.title = `${c.name} (${c.shortcut})`;
      colorBtn.style.cssText = `
        width: 22px;
        height: 22px;
        background: ${c.value};
        border: 2px solid var(--background-modifier-border);
        border-radius: 50%;
        cursor: pointer;
        padding: 0;
      `;
      colorBtn.onclick = () => this.setColor(c.value);
      colorsGroup.appendChild(colorBtn);
    }
    el.appendChild(colorsGroup);

    el.appendChild(this.createSeparator());

    // Grosor
    const strokeGroup = this.createGroup();
    for (const sw of STROKE_WIDTHS) {
      const swBtn = document.createElement("button");
      swBtn.className = "mnexus-stroke-btn";
      swBtn.dataset.stroke = String(sw.value);
      swBtn.title = sw.name;
      swBtn.style.cssText = `
        padding: 2px 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
      `;
      const dot = document.createElement("div");
      dot.style.cssText = `width: ${sw.value}px; height: ${sw.value}px; border-radius: 50%; background: var(--text-normal);`;
      swBtn.appendChild(dot);
      swBtn.appendChild(document.createTextNode(sw.name));
      swBtn.onclick = () => this.setStrokeWidth(sw.value);
      strokeGroup.appendChild(swBtn);
    }
    el.appendChild(strokeGroup);

    el.appendChild(this.createSeparator());

    // Postit colors
    const stickyGroup = this.createGroup();
    for (const sc of STICKY_COLORS) {
      const scBtn = document.createElement("button");
      scBtn.className = "mnexus-sticky-color-btn";
      scBtn.dataset.stickyColor = sc.name;
      scBtn.title = sc.label;
      scBtn.style.cssText = `
        padding: 2px 6px;
        border: 1px solid var(--background-modifier-border);
        background: var(--background-primary);
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
      `;
      scBtn.textContent = sc.label;
      scBtn.onclick = () => {
        this.setTool("sticky");
        this.createStickyAtCenter(sc.name);
      };
      stickyGroup.appendChild(scBtn);
    }
    el.appendChild(stickyGroup);

    // Spacer
    const spacer = document.createElement("div");
    spacer.style.cssText = "flex: 1;";
    el.appendChild(spacer);

    // Acciones derecha
    const actionsGroup = this.createGroup();
    const undoBtn = document.createElement("button");
    undoBtn.textContent = "↶";
    undoBtn.title = "Deshacer (Ctrl+Z)";
    undoBtn.style.cssText = "padding: 4px 8px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); border-radius: 4px; cursor: pointer;";
    undoBtn.onclick = () => this.undo();
    actionsGroup.appendChild(undoBtn);

    const redoBtn = document.createElement("button");
    redoBtn.textContent = "↷";
    redoBtn.title = "Rehacer (Ctrl+Y)";
    redoBtn.style.cssText = "padding: 4px 8px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); border-radius: 4px; cursor: pointer;";
    redoBtn.onclick = () => this.redo();
    actionsGroup.appendChild(redoBtn);

    const layersBtn = document.createElement("button");
    layersBtn.textContent = "📚";
    layersBtn.title = "Capas";
    layersBtn.style.cssText = "padding: 4px 8px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); border-radius: 4px; cursor: pointer;";
    layersBtn.onclick = () => this.toggleLayers();
    actionsGroup.appendChild(layersBtn);

    const stickersBtn = document.createElement("button");
    stickersBtn.textContent = "😀";
    stickersBtn.title = "Stickers";
    stickersBtn.style.cssText = "padding: 4px 8px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); border-radius: 4px; cursor: pointer;";
    stickersBtn.onclick = () => this.showStickerPicker();
    actionsGroup.appendChild(stickersBtn);

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "🗑";
    clearBtn.title = "Borrar todo";
    clearBtn.style.cssText = "padding: 4px 8px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); border-radius: 4px; cursor: pointer; color: var(--text-error);";
    clearBtn.onclick = () => this.clearAll();
    actionsGroup.appendChild(clearBtn);

    el.appendChild(actionsGroup);
    this.updateToolButtons();
    this.updateColorButtons();
    this.updateStrokeButtons();
  }

  private createGroup(): HTMLElement {
    const g = document.createElement("div");
    g.className = "mnexus-toolbar-group";
    g.style.cssText = "display: flex; gap: 2px; align-items: center;";
    return g;
  }

  private createSeparator(): HTMLElement {
    const sep = document.createElement("div");
    sep.style.cssText = "width: 1px; height: 24px; background: var(--background-modifier-border); margin: 0 4px;";
    return sep;
  }

  private createLayerPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "mnexus-layer-panel";
    panel.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      width: 280px;
      max-height: 70vh;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      z-index: 10000;
      padding: 8px;
      overflow-y: auto;
    `;
    const title = document.createElement("h3");
    title.textContent = "📚 Capas";
    title.style.cssText = "margin: 0 0 8px 0; font-size: 14px;";
    panel.appendChild(title);
    const list = document.createElement("div");
    list.className = "mnexus-layer-list";
    list.id = "mnexus-layer-list";
    panel.appendChild(list);
    return panel;
  }

  private refreshLayerList(): void {
    if (!this.layerPanelEl) return;
    const list = this.layerPanelEl.querySelector(".mnexus-layer-list");
    if (!list) return;
    const view = this.opts.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path;
    if (!path) return;
    const anns = this.opts.store.get(path);
    list.innerHTML = "";
    // Ordenar por zIndex desc (capas superiores primero)
    const sorted = [...anns].sort((a, b) => b.zIndex - a.zIndex);
    for (const ann of sorted) {
      const item = document.createElement("div");
      item.style.cssText = `
        padding: 6px 8px;
        border-bottom: 1px solid var(--background-modifier-hover);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
      `;
      const label = document.createElement("span");
      const icon = this.getTypeIcon(ann.type);
      label.textContent = `${icon} ${ann.type} z:${ann.zIndex}`;
      const actions = document.createElement("div");
      actions.style.cssText = "display: flex; gap: 4px;";
      const upBtn = document.createElement("button");
      upBtn.textContent = "↑";
      upBtn.title = "Subir";
      upBtn.style.cssText = "padding: 2px 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 3px; cursor: pointer;";
      upBtn.onclick = async () => {
        await this.opts.store.update(ann.id, ann.notePath, { zIndex: ann.zIndex + 10 });
        this.pushUndo({ type: "update", annotation: ann, previous: { ...ann } });
        this.refreshOverlay(ann.notePath);
        this.refreshLayerList();
      };
      const downBtn = document.createElement("button");
      downBtn.textContent = "↓";
      downBtn.title = "Bajar";
      downBtn.style.cssText = "padding: 2px 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 3px; cursor: pointer;";
      downBtn.onclick = async () => {
        await this.opts.store.update(ann.id, ann.notePath, { zIndex: Math.max(0, ann.zIndex - 10) });
        this.pushUndo({ type: "update", annotation: ann, previous: { ...ann } });
        this.refreshOverlay(ann.notePath);
        this.refreshLayerList();
      };
      const delBtn = document.createElement("button");
      delBtn.textContent = "✕";
      delBtn.title = "Eliminar";
      delBtn.style.cssText = "padding: 2px 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 3px; cursor: pointer; color: var(--text-error);";
      delBtn.onclick = async () => {
        this.pushUndo({ type: "remove", annotation: ann, previous: { ...ann } });
        await this.opts.store.remove(ann.id, ann.notePath);
        this.refreshOverlay(ann.notePath);
        this.refreshLayerList();
      };
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);
      actions.appendChild(delBtn);
      item.appendChild(label);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      highlight: "🖊",
      underline: "U̲",
      strike: "S̶",
      freehand: "✏️",
      arrow: "➡",
      rectangle: "▭",
      circle: "○",
      text: "T",
      sticker: "😀",
      comment: "💬",
      "image-stamp": "🖼",
      link: "🔗",
    };
    return icons[type] ?? "•";
  }

  private updateToolButtons(): void {
    if (!this.toolbarEl) return;
    for (const btn of Array.from(this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mnexus-tool-btn"))) {
      const active = btn.dataset.tool === this.currentTool;
      btn.classList.toggle("active", active);
      btn.style.background = active ? "var(--interactive-accent)" : "var(--background-primary)";
      btn.style.color = active ? "var(--text-on-accent)" : "var(--text-normal)";
    }
  }

  private updateColorButtons(): void {
    if (!this.toolbarEl) return;
    for (const btn of Array.from(this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mnexus-color-btn"))) {
      const active = btn.dataset.color === this.currentColor;
      btn.style.border = active ? "2px solid var(--interactive-accent)" : "2px solid var(--background-modifier-border)";
      btn.style.transform = active ? "scale(1.15)" : "scale(1)";
    }
  }

  private updateStrokeButtons(): void {
    if (!this.toolbarEl) return;
    for (const btn of Array.from(this.toolbarEl.querySelectorAll<HTMLButtonElement>(".mnexus-stroke-btn"))) {
      const active = Number(btn.dataset.stroke) === this.currentStrokeWidth;
      btn.style.background = active ? "var(--interactive-accent)" : "var(--background-primary)";
      btn.style.color = active ? "var(--text-on-accent)" : "var(--text-normal)";
    }
  }

  private updateOverlayProperties(): void {
    if (!this.overlayEl) return;
    const interactive = ["select", "hand"].includes(this.currentTool) ? "none" : "auto";
    this.overlayEl.style.pointerEvents = interactive;
    this.overlayEl.style.cursor = this.currentTool === "eraser" ? "cell" : this.currentTool === "select" ? "default" : "crosshair";
  }

  private updateStatus(opts: { info?: string; count?: number }): void {
    if (!this.statusEl) return;
    const anns = this.opts.store.getAll();
    this.statusEl.innerHTML = `
      <span>${opts.info ?? "Listo"}</span>
      <span style="margin-left: auto;">📝 ${opts.count ?? anns.length} anotaciones</span>
      <span>↶ ${this.undoStack.length} ↷ ${this.redoStack.length}</span>
      <span>Zoom: ${Math.round(this.scale * 100)}%</span>
    `;
  }

  // ─── Sticker picker ──────────────────────────────────────

  private showStickerPicker(): void {
    const existing = document.querySelector(".mnexus-sticker-picker");
    if (existing) { existing.remove(); return; }
    const picker = document.createElement("div");
    picker.className = "mnexus-sticker-picker";
    picker.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 10001;
      background: var(--background-primary);
      border: 1px solid var(--background-modifier-border);
      border-radius: 12px;
      padding: 16px;
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    `;
    for (const s of STICKERS) {
      const b = document.createElement("button");
      b.textContent = s;
      b.style.cssText = "padding: 8px; font-size: 28px; background: transparent; border: 1px solid transparent; border-radius: 8px; cursor: pointer; transition: all 0.1s;";
      b.onmouseenter = () => { b.style.background = "var(--background-modifier-hover)"; b.style.borderColor = "var(--interactive-accent)"; };
      b.onmouseleave = () => { b.style.background = "transparent"; b.style.borderColor = "transparent"; };
      b.onclick = () => {
        this.setTool("sticker");
        this.createStickerAt(s, 0, 0, "⭐");
        picker.remove();
      };
      picker.appendChild(b);
    }
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "Cerrar";
    closeBtn.style.cssText = "grid-column: 1 / -1; padding: 8px; margin-top: 8px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 6px; cursor: pointer;";
    closeBtn.onclick = () => picker.remove();
    picker.appendChild(closeBtn);
    document.body.appendChild(picker);
  }

  // ─── Mouse handlers ──────────────────────────────────────

  private onMouseDown(e: MouseEvent, view: MarkdownView): void {
    if (this.currentTool === "select" || this.currentTool === "hand") return;
    const path = view.file?.path;
    if (!path) return;
    const rect = this.overlayEl!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;

    if (this.currentTool === "freehand") {
      this.isDrawing = true;
      this.drawPoints = [{ x, y, pressure: 1 }];
    } else if (this.currentTool === "arrow" || this.currentTool === "rectangle" || this.currentTool === "circle") {
      this.isDrawing = true;
      this.startPos = { x, y };
    } else if (this.currentTool === "sticky") {
      this.createStickyAt(path, x, y, "yellow");
      this.setTool("select");
    } else if (this.currentTool === "sticker") {
      this.createStickerAt(path, e.clientX - rect.left, e.clientY - rect.top, "⭐");
      this.setTool("select");
    } else if (this.currentTool === "text" || this.currentTool === "image-stamp" || this.currentTool === "link") {
      this.createSpatialAt(path, x, y);
      this.setTool("select");
    } else if (this.currentTool === "comment" || this.currentTool === "highlight" || this.currentTool === "underline" || this.currentTool === "strike") {
      this.applyTextRange(view);
    } else if (this.currentTool === "eraser") {
      this.eraseAt(e);
    }
  }

  private onMouseMove(e: MouseEvent, _view: MarkdownView): void {
    if (!this.isDrawing) return;
    const rect = this.overlayEl!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.scale;
    const y = (e.clientY - rect.top) / this.scale;
    if (this.currentTool === "freehand") {
      this.drawPoints.push({ x, y, pressure: 1 });
      this.previewFreehand();
    } else if (this.startPos && (this.currentTool === "arrow" || this.currentTool === "rectangle" || this.currentTool === "circle")) {
      this.previewShape(x, y);
    }
  }

  private onMouseUp(_e: MouseEvent, view: MarkdownView): void {
    if (!this.isDrawing) return;
    const path = view.file?.path;
    if (!path) return;
    const rect = this.overlayEl!.getBoundingClientRect();
    const x = (_e.clientX - rect.left) / this.scale;
    const y = (_e.clientY - rect.top) / this.scale;

    if (this.currentTool === "freehand" && this.drawPoints.length > 1) {
      const ann: SpatialAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "freehand",
        notePath: path,
        position: { x: this.drawPoints[0].x, y: this.drawPoints[0].y },
        points: this.drawPoints,
        style: this.getStyle(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: "user",
        zIndex: 50,
        locked: false,
      };
      this.opts.store.add(ann);
      this.pushUndo({ type: "add", annotation: ann });
    } else if ((this.currentTool === "arrow" || this.currentTool === "rectangle" || this.currentTool === "circle") && this.startPos) {
      const ann: SpatialAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: this.currentTool,
        notePath: path,
        position: { x: this.startPos.x, y: this.startPos.y, width: x - this.startPos.x, height: y - this.startPos.y },
        endPosition: this.currentTool === "arrow" ? { x, y } : undefined,
        style: this.getStyle(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: "user",
        zIndex: 40,
        locked: false,
      };
      this.opts.store.add(ann);
      this.pushUndo({ type: "add", annotation: ann });
    }

    this.isDrawing = false;
    this.drawPoints = [];
    this.startPos = null;
    this.refreshOverlay(path);
    this.updateStatus({});
  }

  private onDoubleClick(e: MouseEvent, view: MarkdownView): void {
    // Doble click en una anotación → abrir para editar
    const target = e.target as HTMLElement;
    const annEl = target.closest("[data-annotation-id]") as HTMLElement | null;
    if (annEl) {
      const id = annEl.dataset.annotationId;
      const path = view.file?.path;
      if (id && path) {
        const ann = this.opts.store.get(path).find((a) => a.id === id);
        if (ann && (ann.type === "text" || ann.type === "comment")) {
          const newText = prompt("Editar:", ann.text ?? "");
          if (newText !== null) {
            const prev = { ...ann };
            this.opts.store.update(id, path, { text: newText });
            this.pushUndo({ type: "update", annotation: ann, previous: prev });
            this.refreshOverlay(path);
          }
        }
      }
    }
  }

  private getStyle(): AnnotationStyle {
    return {
      color: this.currentColor,
      opacity: 1,
      strokeWidth: this.currentStrokeWidth,
      fillColor: "transparent",
    };
  }

  private async applyTextRange(view: MarkdownView): Promise<void> {
    const editor = view.editor;
    const sel = editor.getSelection();
    if (!sel) {
      this.updateStatus({ info: "⚠ Selecciona texto primero" });
      return;
    }
    const path = view.file?.path;
    if (!path) return;

    const text = editor.getValue();
    const start = text.indexOf(sel);
    if (start === -1) return;
    const end = start + sel.length;

    const ann: TextRangeAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: this.currentTool as "highlight" | "underline" | "strike" | "comment",
      notePath: path,
      range: { start, end, text: sel },
      text: this.currentTool === "comment" ? prompt("Comentario:") ?? "" : undefined,
      style: { color: this.currentColor, opacity: 1, strokeWidth: this.currentStrokeWidth },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: "user",
      zIndex: 10,
      locked: false,
    };
    await this.opts.store.add(ann);
    this.pushUndo({ type: "add", annotation: ann });
    this.refreshOverlay(path);
    this.updateStatus({});
  }

  private async createSpatialAt(path: string, x: number, y: number): Promise<void> {
    let content: string | undefined;
    let linkTarget: string | undefined;
    let imageUrl: string | undefined;
    if (this.currentTool === "text") {
      content = prompt("Texto:") ?? "";
      if (!content) return;
    } else if (this.currentTool === "image-stamp") {
      imageUrl = prompt("URL de imagen:") ?? "";
      if (!imageUrl) return;
    } else if (this.currentTool === "link") {
      linkTarget = prompt("Ruta o URL:") ?? "";
      if (!linkTarget) return;
      content = prompt("Etiqueta:") ?? linkTarget;
    }
    const ann: SpatialAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: this.currentTool as any,
      notePath: path,
      position: { x, y },
      content,
      linkTarget,
      imageUrl,
      style: { color: this.currentColor, opacity: 1, strokeWidth: this.currentStrokeWidth, fontSize: 16 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: "user",
      zIndex: this.currentTool === "text" ? 60 : 30,
      locked: false,
    };
    await this.opts.store.add(ann);
    this.pushUndo({ type: "add", annotation: ann });
    this.refreshOverlay(path);
    this.updateStatus({});
  }

  private createStickerAt(path: string, x: number, y: number, emoji: string): void {
    const ann: SpatialAnnotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "sticker",
      notePath: path,
      position: { x, y },
      content: emoji,
      style: { color: this.currentColor, opacity: 1, strokeWidth: 0, fontSize: 32 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: "user",
      zIndex: 100,
      locked: false,
    };
    this.opts.store.add(ann);
    this.pushUndo({ type: "add", annotation: ann });
    this.refreshOverlay(path);
    this.updateStatus({});
  }

  private createStickyAt(path: string, x: number, y: number, color: StickyColor): void {
    if (!this.stickyManager) return;
    const content = prompt("Contenido del postit (opcional):") ?? "";
    this.stickyManager.create(path, x, y, color, content);
    this.updateStatus({ info: "📝 Postit creado" });
  }

  private createStickyAtCenter(color: StickyColor): void {
    const view = this.opts.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    const rect = this.overlayEl!.getBoundingClientRect();
    this.createStickyAt(view.file.path, rect.width / 2 - 100, rect.height / 2 - 75, color);
  }

  private createStickerAtCenter(emoji: string): void {
    const view = this.opts.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    const rect = this.overlayEl!.getBoundingClientRect();
    this.createStickerAt(view.file.path, rect.width / 2, rect.height / 2, emoji);
  }

  private async eraseAt(e: MouseEvent): Promise<void> {
    const target = e.target as HTMLElement;
    const annEl = target.closest("[data-annotation-id]") as HTMLElement | null;
    if (annEl) {
      const id = annEl.dataset.annotationId;
      const path = annEl.dataset.notePath ?? this.opts.app.workspace.getActiveViewOfType(MarkdownView)?.file?.path;
      if (id && path) {
        const ann = this.opts.store.get(path).find((a) => a.id === id);
        if (ann) {
          this.pushUndo({ type: "remove", annotation: ann, previous: { ...ann } });
          await this.opts.store.remove(id, path);
          this.refreshOverlay(path);
          this.updateStatus({ info: "🧹 Borrado" });
        }
      }
    }
  }

  private previewFreehand(): void {
    if (!this.overlayEl) return;
    this.overlayEl.querySelectorAll(".mnexus-preview").forEach((el) => el.remove());
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mnexus-preview");
    svg.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;";
    const path = this.drawPoints.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    svg.innerHTML = `<path d="${path}" stroke="${this.currentColor}" stroke-width="${this.currentStrokeWidth}" fill="none" stroke-linecap="round" />`;
    this.overlayEl.appendChild(svg);
  }

  private previewShape(x: number, y: number): void {
    if (!this.overlayEl || !this.startPos) return;
    this.overlayEl.querySelectorAll(".mnexus-preview").forEach((el) => el.remove());
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("mnexus-preview");
    svg.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;";
    if (this.currentTool === "arrow") {
      svg.innerHTML = `<line x1="${this.startPos.x}" y1="${this.startPos.y}" x2="${x}" y2="${y}" stroke="${this.currentColor}" stroke-width="${this.currentStrokeWidth}" />`;
    } else if (this.currentTool === "rectangle") {
      const w = x - this.startPos.x;
      const h = y - this.startPos.y;
      svg.innerHTML = `<rect x="${this.startPos.x}" y="${this.startPos.y}" width="${w}" height="${h}" stroke="${this.currentColor}" stroke-width="${this.currentStrokeWidth}" fill="none" />`;
    } else if (this.currentTool === "circle") {
      const cx = (this.startPos.x + x) / 2;
      const cy = (this.startPos.y + y) / 2;
      const rx = Math.abs(x - this.startPos.x) / 2;
      const ry = Math.abs(y - this.startPos.y) / 2;
      svg.innerHTML = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${this.currentColor}" stroke-width="${this.currentStrokeWidth}" fill="none" />`;
    }
    this.overlayEl.appendChild(svg);
  }

  private async refreshOverlay(notePath: string): Promise<void> {
    if (!this.overlayEl) return;
    this.overlayEl.innerHTML = "";
    const anns = this.opts.store.get(notePath).filter((a) => !(a.metadata?.type === "sticky-note"));
    for (const ann of anns) {
      const el = renderSpatialToHTML(ann);
      if (el) this.overlayEl.appendChild(el);
    }
    if (this.showLayers) this.refreshLayerList();
  }

  private async clearAll(): Promise<void> {
    if (!confirm("¿Borrar todas las anotaciones de esta nota?")) return;
    const view = this.opts.app.workspace.getActiveViewOfType(MarkdownView);
    const path = view?.file?.path;
    if (!path) return;
    const anns = this.opts.store.get(path);
    for (const ann of anns) {
      this.pushUndo({ type: "remove", annotation: ann, previous: { ...ann } });
      await this.opts.store.remove(ann.id, path);
    }
    this.stickyManager?.getAll().forEach((s) => s.destroy());
    this.refreshOverlay(path);
    this.updateStatus({ info: "🗑 Todo borrado" });
  }

  // ─── Keyboard shortcuts ──────────────────────────────────

  private keyHandler?: (e: KeyboardEvent) => void;

  private bindKeyboardShortcuts(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "Z"))) {
        e.preventDefault();
        this.redo();
        return;
      }
      // Tools (sin modificador)
      if (e.altKey) return;
      const map: Record<string, AnnotationTool> = {
        v: "select", h: "hand", g: "highlight", u: "underline", d: "strike",
        p: "freehand", a: "arrow", r: "rectangle", c: "circle", t: "text",
        n: "sticky", e: "sticker", m: "comment", i: "image-stamp", l: "link", x: "eraser",
      };
      const tool = map[e.key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        this.setTool(tool);
        return;
      }
      // Color shortcuts (números)
      const num = Number(e.key);
      if (num >= 1 && num <= 8) {
        const c = COLORS[num - 1];
        if (c) this.setColor(c.value);
      }
    };
    window.addEventListener("keydown", this.keyHandler);
  }

  private unbindKeyboardShortcuts(): void {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = undefined;
    }
  }
}

function renderSpatialToHTML(ann: Annotation): HTMLElement | null {
  if (!("position" in ann)) return null;
  const el = document.createElement("div");
  el.dataset.annotationId = ann.id;
  el.dataset.notePath = ann.notePath;
  el.style.position = "absolute";
  el.style.left = `${ann.position.x}px`;
  el.style.top = `${ann.position.y}px`;
  el.style.zIndex = String(ann.zIndex);
  el.style.opacity = String(ann.style.opacity);
  el.style.pointerEvents = "all";

  switch (ann.type) {
    case "freehand": {
      if ("points" in ann && ann.points && ann.points.length > 1) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible;";
        const path = ann.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
        svg.innerHTML = `<path d="${path}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="none" stroke-linecap="round" />`;
        el.appendChild(svg);
      }
      break;
    }
    case "sticker":
      el.textContent = ann.content ?? "📌";
      el.style.fontSize = `${ann.style.fontSize ?? 32}px`;
      el.style.lineHeight = "1";
      el.style.cursor = "grab";
      break;
    case "text":
      el.textContent = ann.content ?? "";
      el.style.fontSize = `${ann.style.fontSize ?? 14}px`;
      el.style.color = ann.style.color;
      el.style.background = ann.style.fillColor ?? "#FFFDE7";
      el.style.padding = "4px 8px";
      el.style.borderRadius = "4px";
      el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
      el.style.maxWidth = "300px";
      el.style.whiteSpace = "pre-wrap";
      break;
    case "arrow": {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible;";
      const fx = ann.position.x;
      const fy = ann.position.y;
      const tx = ann.endPosition?.x ?? fx;
      const ty = ann.endPosition?.y ?? fy;
      svg.innerHTML = `
        <defs>
          <marker id="arr-${ann.id}" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="${ann.style.color}" />
          </marker>
        </defs>
        <line x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" marker-end="url(#arr-${ann.id})" />
      `;
      el.appendChild(svg);
      break;
    }
    case "rectangle": {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible;";
      svg.innerHTML = `<rect x="${ann.position.x}" y="${ann.position.y}" width="${ann.position.width ?? 100}" height="${ann.position.height ?? 50}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="${ann.style.fillColor ?? "transparent"}" />`;
      el.appendChild(svg);
      break;
    }
    case "circle": {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; overflow: visible;";
      const cx = ann.position.x + (ann.position.width ?? 50) / 2;
      const cy = ann.position.y + (ann.position.height ?? 50) / 2;
      const rx = (ann.position.width ?? 50) / 2;
      const ry = (ann.position.height ?? 50) / 2;
      svg.innerHTML = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="${ann.style.fillColor ?? "transparent"}" />`;
      el.appendChild(svg);
      break;
    }
    case "link":
      el.textContent = `🔗 ${ann.content ?? ann.linkTarget}`;
      el.style.color = ann.style.color;
      el.style.cursor = "pointer";
      el.style.padding = "4px 8px";
      el.style.border = `2px dashed ${ann.style.color}`;
      el.style.borderRadius = "4px";
      el.onclick = () => {
        if (ann.linkTarget) {
          window.open(ann.linkTarget.startsWith("http") ? ann.linkTarget : `obsidian://open?path=${encodeURIComponent(ann.linkTarget)}`);
        }
      };
      break;
  }
  return el;
}

/** Factory helper: crea una AnnotationToolbar configurada con el plugin. */
export function getAnnotationToolbar(plugin: Plugin, store?: AnnotationStore): AnnotationToolbar {
  // Si no se pasa store, usamos uno por defecto en memoria.
  const defaultStore: AnnotationStore = store ?? ({} as AnnotationStore);
  return new AnnotationToolbar({ store: defaultStore, plugin, app: plugin.app });
}

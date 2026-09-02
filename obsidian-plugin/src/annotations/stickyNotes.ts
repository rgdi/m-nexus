// v0.26: Postits virtuales (sticky notes) tipo Samsung Notes.
// Sticky notes flotantes con colores, drag, resize, contenido rich.

import type { App } from "obsidian";
import type { AnnotationStore, SpatialAnnotation } from "./noteAnnotations";

export type StickyColor = "yellow" | "pink" | "blue" | "green" | "purple" | "orange" | "white";

export interface StickyStyle {
  color: StickyColor;
  fontSize: number;
  fontFamily: string;
  width: number;
  height: number;
  showShadow: boolean;
  textAlign: "left" | "center" | "right";
}

export const STICKY_PRESETS: Record<StickyColor, { bg: string; border: string; text: string }> = {
  yellow: { bg: "#FFF59D", border: "#FBC02D", text: "#5D4037" },
  pink: { bg: "#F8BBD0", border: "#EC407A", text: "#880E4F" },
  blue: { bg: "#B3E5FC", border: "#039BE5", text: "#01579B" },
  green: { bg: "#C8E6C9", border: "#43A047", text: "#1B5E20" },
  purple: { bg: "#E1BEE7", border: "#8E24AA", text: "#4A148C" },
  orange: { bg: "#FFCC80", border: "#FB8C00", text: "#E65100" },
  white: { bg: "#FAFAFA", border: "#BDBDBD", text: "#212121" },
};

let _stickyCounter = 0;
function nextStickyId(): string {
  _stickyCounter++;
  return `sticky-${Date.now()}-${_stickyCounter}`;
}

export class StickyNote {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  style: StickyStyle;
  notePath: string;
  zIndex: number;
  rotation: number = 0; // grados
  createdAt: string;
  updatedAt: string;
  author: string;
  isEditing: boolean = false;
  isDragging: boolean = false;
  isResizing: boolean = false;
  el: HTMLElement | null = null;
  textArea: HTMLTextAreaElement | null = null;
  dragOffset: { x: number; y: number } = { x: 0, y: 0 };

  constructor(opts: {
    notePath: string;
    x: number;
    y: number;
    content?: string;
    style?: Partial<StickyStyle>;
    author?: string;
  }) {
    this.id = nextStickyId();
    this.notePath = opts.notePath;
    this.x = opts.x;
    this.y = opts.y;
    this.width = opts.style?.width ?? 200;
    this.height = opts.style?.height ?? 150;
    this.content = opts.content ?? "";
    this.style = {
      color: opts.style?.color ?? "yellow",
      fontSize: opts.style?.fontSize ?? 14,
      fontFamily: opts.style?.fontFamily ?? "system-ui, -apple-system, sans-serif",
      width: this.width,
      height: this.height,
      showShadow: opts.style?.showShadow ?? true,
      textAlign: opts.style?.textAlign ?? "left",
    };
    this.zIndex = 200;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    this.author = opts.author ?? "user";
  }

  render(): HTMLElement {
    if (this.el) return this.el;
    const preset = STICKY_PRESETS[this.style.color];
    const el = document.createElement("div");
    el.className = "mnexus-sticky-note";
    el.dataset.stickyId = this.id;
    el.style.cssText = `
      position: absolute;
      left: ${this.x}px;
      top: ${this.y}px;
      width: ${this.width}px;
      min-height: ${this.height}px;
      background: ${preset.bg};
      border: 1px solid ${preset.border};
      border-radius: 4px;
      padding: 8px 10px;
      color: ${preset.text};
      font-family: ${this.style.fontFamily};
      font-size: ${this.style.fontSize}px;
      line-height: 1.4;
      text-align: ${this.style.textAlign};
      box-shadow: ${this.style.showShadow ? "2px 4px 12px rgba(0,0,0,0.15)" : "none"};
      z-index: ${this.zIndex};
      cursor: move;
      user-select: none;
      transition: box-shadow 0.15s ease;
      transform: rotate(${this.rotation}deg);
    `;

    // Header con controles
    const header = document.createElement("div");
    header.className = "mnexus-sticky-header";
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: -8px -10px 6px;
      padding: 4px 8px;
      background: ${preset.border}22;
      border-bottom: 1px solid ${preset.border}44;
      border-radius: 4px 4px 0 0;
      cursor: move;
    `;
    const colorDot = document.createElement("div");
    colorDot.style.cssText = `width: 10px; height: 10px; border-radius: 50%; background: ${preset.border};`;
    header.appendChild(colorDot);

    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; gap: 4px;";
    const editBtn = document.createElement("button");
    editBtn.textContent = "✏";
    editBtn.title = "Editar";
    editBtn.style.cssText = "background: transparent; border: none; cursor: pointer; padding: 0 2px; color: inherit;";
    editBtn.onclick = (e) => { e.stopPropagation(); this.startEditing(); };
    actions.appendChild(editBtn);
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "Cerrar";
    closeBtn.style.cssText = "background: transparent; border: none; cursor: pointer; padding: 0 2px; color: inherit;";
    closeBtn.onclick = (e) => { e.stopPropagation(); this.destroy(); };
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    el.appendChild(header);

    // Content
    const content = document.createElement("div");
    content.className = "mnexus-sticky-content";
    content.style.cssText = "white-space: pre-wrap; word-break: break-word;";
    content.textContent = this.content || "(vacío — doble click para editar)";
    el.appendChild(content);

    // Doble click para editar
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.startEditing();
    });

    // Drag
    let dragStartX = 0, dragStartY = 0;
    header.addEventListener("mousedown", (e) => {
      if (this.isEditing) return;
      this.isDragging = true;
      el.style.cursor = "grabbing";
      dragStartX = e.clientX - this.x;
      dragStartY = e.clientY - this.y;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      this.x = e.clientX - dragStartX;
      this.y = e.clientY - dragStartY;
      el.style.left = `${this.x}px`;
      el.style.top = `${this.y}px`;
    });
    document.addEventListener("mouseup", () => {
      if (this.isDragging) {
        this.isDragging = false;
        el.style.cursor = "move";
        this.updatedAt = new Date().toISOString();
        this.persist();
      }
    });

    // Resize (esquina inferior derecha)
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "mnexus-sticky-resize";
    resizeHandle.style.cssText = `
      position: absolute;
      right: 0;
      bottom: 0;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, ${preset.border} 50%);
    `;
    el.appendChild(resizeHandle);
    let resizeStartX = 0, resizeStartY = 0, resizeStartW = 0, resizeStartH = 0;
    resizeHandle.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.isResizing = true;
      resizeStartX = e.clientX;
      resizeStartY = e.clientY;
      resizeStartW = this.width;
      resizeStartH = this.height;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.isResizing) return;
      const newW = Math.max(80, resizeStartW + (e.clientX - resizeStartX));
      const newH = Math.max(60, resizeStartH + (e.clientY - resizeStartY));
      this.width = newW;
      this.height = newH;
      el.style.width = `${newW}px`;
      el.style.minHeight = `${newH}px`;
    });
    document.addEventListener("mouseup", () => {
      if (this.isResizing) {
        this.isResizing = false;
        this.updatedAt = new Date().toISOString();
        this.persist();
      }
    });

    // Color cycle on click en el color dot
    let colorIdx = 0;
    const colors: StickyColor[] = ["yellow", "pink", "blue", "green", "purple", "orange", "white"];
    colorDot.onclick = (e) => {
      e.stopPropagation();
      colorIdx = (colorIdx + 1) % colors.length;
      this.style.color = colors[colorIdx];
      this.render();
    };

    // Hover highlight
    el.addEventListener("mouseenter", () => {
      el.style.boxShadow = "4px 8px 20px rgba(0,0,0,0.25)";
    });
    el.addEventListener("mouseleave", () => {
      el.style.boxShadow = this.style.showShadow ? "2px 4px 12px rgba(0,0,0,0.15)" : "none";
    });

    this.el = el;
    return el;
  }

  startEditing(): void {
    if (this.isEditing || !this.el) return;
    this.isEditing = true;
    const content = this.el.querySelector(".mnexus-sticky-content") as HTMLElement;
    const ta = document.createElement("textarea");
    ta.value = this.content;
    ta.style.cssText = `
      width: 100%;
      min-height: ${this.height - 50}px;
      background: transparent;
      border: none;
      outline: none;
      color: inherit;
      font: inherit;
      resize: none;
      padding: 0;
    `;
    content.replaceWith(ta);
    this.textArea = ta;
    ta.focus();
    ta.addEventListener("blur", () => this.stopEditing());
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") ta.blur();
    });
  }

  stopEditing(): void {
    if (!this.isEditing || !this.el || !this.textArea) return;
    this.content = this.textArea.value;
    this.textArea.remove();
    this.textArea = null;
    this.isEditing = false;
    this.updatedAt = new Date().toISOString();
    this.persist();
    // Re-render content
    const content = document.createElement("div");
    content.className = "mnexus-sticky-content";
    content.style.cssText = "white-space: pre-wrap; word-break: break-word;";
    content.textContent = this.content || "(vacío — doble click para editar)";
    this.el.appendChild(content);
  }

  destroy(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.onDestroy?.(this);
  }

  onDestroy?: (s: StickyNote) => void;

  toAnnotation(): SpatialAnnotation {
    return {
      id: `ann-${this.id}`,
      type: "text", // Usamos "text" para sticky notes (es lo más cercano)
      notePath: this.notePath,
      position: { x: this.x, y: this.y, width: this.width, height: this.height },
      content: this.content,
      style: {
        color: STICKY_PRESETS[this.style.color].text,
        opacity: 1,
        strokeWidth: 0,
        fontSize: this.style.fontSize,
        fontFamily: this.style.fontFamily,
        fillColor: STICKY_PRESETS[this.style.color].bg,
      },
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      author: this.author,
      zIndex: this.zIndex,
      locked: false,
      metadata: {
        type: "sticky-note",
        color: this.style.color,
        rotation: this.rotation,
      },
    };
  }

  async persist(): Promise<void> {
    if (this.onPersist) await this.onPersist(this);
  }

  onPersist?: (s: StickyNote) => Promise<void>;
}

/** Manager de sticky notes. Carga/persiste/gestiona todas. */
export class StickyNoteManager {
  private stickies: Map<string, StickyNote> = new Map();
  private containerEl: HTMLElement | null = null;
  private zCounter = 200;

  constructor(private app: App, private store: AnnotationStore) {}

  mount(container: HTMLElement): void {
    this.containerEl = container;
    this.loadFromStore();
  }

  unmount(): void {
    for (const s of this.stickies.values()) {
      s.destroy();
    }
    this.stickies.clear();
    this.containerEl = null;
  }

  create(notePath: string, x: number, y: number, color: StickyColor = "yellow", content = ""): StickyNote {
    const sticky = new StickyNote({
      notePath,
      x,
      y,
      content,
      style: { color },
    });
    sticky.zIndex = ++this.zCounter;
    sticky.onDestroy = (s) => {
      this.stickies.delete(s.id);
      this.removeFromStore(s);
    };
    sticky.onPersist = async (s) => {
      await this.saveToStore(s);
    };
    this.stickies.set(sticky.id, sticky);
    if (this.containerEl) {
      this.containerEl.appendChild(sticky.render());
    }
    this.saveToStore(sticky);
    return sticky;
  }

  getAll(): StickyNote[] {
    return Array.from(this.stickies.values());
  }

  bringToFront(sticky: StickyNote): void {
    sticky.zIndex = ++this.zCounter;
    if (sticky.el) {
      sticky.el.style.zIndex = String(sticky.zIndex);
    }
  }

  private async saveToStore(sticky: StickyNote): Promise<void> {
    // Eliminar versión anterior
    const existing = this.store.get(sticky.notePath).filter((a) => a.metadata?.type === "sticky-note" && a.id === `ann-${sticky.id}`);
    for (const e of existing) {
      await this.store.remove(e.id, sticky.notePath);
    }
    await this.store.add(sticky.toAnnotation());
  }

  private async removeFromStore(sticky: StickyNote): Promise<void> {
    const anns = this.store.get(sticky.notePath);
    for (const a of anns) {
      if (a.metadata?.type === "sticky-note" && a.id === `ann-${sticky.id}`) {
        await this.store.remove(a.id, sticky.notePath);
      }
    }
  }

  private async loadFromStore(): Promise<void> {
    if (!this.containerEl) return;
    // Buscar todas las anotaciones tipo sticky-note en el vault
    const all = this.store.getAll();
    for (const ann of all) {
      if (ann.metadata?.type === "sticky-note") {
        const sid = ann.id.replace(/^ann-/, "");
        // Cast: los stickies son SpatialAnnotation con position, content y metadata.
        const annAny = ann as unknown as {
          notePath: string;
          position: { x: number; y: number; width?: number; height?: number };
          content?: string;
          metadata?: { color?: StickyColor };
        };
        const sticky = new StickyNote({
          notePath: annAny.notePath,
          x: annAny.position.x,
          y: annAny.position.y,
          content: annAny.content ?? "",
          style: {
            color: annAny.metadata?.color ?? "yellow",
            width: annAny.position.width,
            height: annAny.position.height,
          },
        });
        sticky.id = sid;
        sticky.zIndex = ann.zIndex;
        sticky.onDestroy = (s) => {
          this.stickies.delete(s.id);
          this.removeFromStore(s);
        };
        sticky.onPersist = async (s) => {
          await this.saveToStore(s);
        };
        this.stickies.set(sticky.id, sticky);
        if (this.containerEl) {
          this.containerEl.appendChild(sticky.render());
        }
      }
    }
  }
}

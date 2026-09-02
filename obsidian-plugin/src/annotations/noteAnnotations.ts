// v0.25: Sistema de anotaciones tipo "papel real" sobre cualquier nota.
// Capa overlay — NO modifica la nota original. Se almacena en data.json del plugin.
// Funciona sobre: texto, dibujos, flashcards, fotos, etc.

import type { App, TFile } from "obsidian";

export type AnnotationType =
  | "highlight"     // Resaltado (background color)
  | "underline"     // Subrayado
  | "strike"        // Tachado
  | "freehand"      // Dibujo a mano alzada (path)
  | "arrow"         // Flecha
  | "rectangle"     // Rectángulo
  | "circle"        // Círculo/elipse
  | "text"          // Nota adhesiva de texto
  | "sticker"       // Emoji/sticker
  | "comment"       // Comentario emergente
  | "image-stamp"   // Sello con imagen
  | "link";         // Enlace a otra nota/archivo

export interface AnnotationStyle {
  color: string;       // Hex color
  opacity: number;     // 0..1
  strokeWidth: number; // px (para líneas)
  fontSize?: number;   // Para texto
  fontFamily?: string;
  fillColor?: string;  // Para formas rellenas
  dashArray?: number[]; // Para líneas discontinuas
}

export interface AnnotationBase {
  id: string;
  type: AnnotationType;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
  /** Autor (user/device id). */
  author: string;
  /** Capa Z (0 = debajo, 100 = encima). */
  zIndex: number;
  style: AnnotationStyle;
  /** Si está bloqueada (no editable). */
  locked: boolean;
  /** Texto asociado (para comentarios, stickers, etc). */
  text?: string;
  /** Tags/labels para búsqueda. */
  tags?: string[];
  /** Metadata adicional. */
  metadata?: Record<string, unknown>;
}

/** Anotación vinculada a un rango de texto. */
export interface TextRangeAnnotation extends AnnotationBase {
  type: "highlight" | "underline" | "strike" | "comment";
  /** Path del archivo. */
  notePath: string;
  /** Rango en el texto. */
  range: {
    /** Offset de inicio en el texto plano. */
    start: number;
    /** Offset de fin. */
    end: number;
    /** Texto exacto (para verificación). */
    text: string;
    /** Línea (1-based). */
    line?: number;
    /** Columna. */
    column?: number;
  };
}

/** Anotación espacial (coordenadas en el canvas). */
export interface SpatialAnnotation extends AnnotationBase {
  type: "freehand" | "arrow" | "rectangle" | "circle" | "sticker" | "text" | "image-stamp" | "link";
  notePath: string;
  /** Posición en el canvas de la nota (puede ser % o px). */
  position: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };
  /** Puntos del path (para freehand). */
  points?: Array<{ x: number; y: number; pressure?: number }>;
  /** Para flechas: punto final. */
  endPosition?: { x: number; y: number };
  /** Para stickers/texto: contenido. */
  content?: string;
  /** Para image-stamp: URL o data URL. */
  imageUrl?: string;
  /** Para link: URL o notePath destino. */
  linkTarget?: string;
}

export type Annotation = TextRangeAnnotation | SpatialAnnotation;

export interface NoteAnnotations {
  notePath: string;
  annotations: Annotation[];
  /** Versión del esquema. */
  schemaVersion: number;
}

const SCHEMA_VERSION = 1;
const ANNOTATIONS_KEY = "mnexus:annotations";

export class AnnotationStore {
  private cache = new Map<string, Annotation[]>();

  constructor(private app: App, private plugin: { loadData: () => Promise<Record<string, unknown>>; saveData: (d: Record<string, unknown>) => Promise<void> }) {}

  /**
   * Carga todas las anotaciones del vault desde data.json.
   */
  async loadAll(): Promise<void> {
    const data = await this.plugin.loadData();
    const raw = (data[ANNOTATIONS_KEY] as Record<string, Annotation[]>) ?? {};
    this.cache.clear();
    for (const [path, anns] of Object.entries(raw)) {
      this.cache.set(path, anns);
    }
  }

  /**
   * Persiste todas las anotaciones.
   */
  async saveAll(): Promise<void> {
    const data = await this.plugin.loadData();
    const obj: Record<string, Annotation[]> = {};
    for (const [path, anns] of this.cache.entries()) {
      obj[path] = anns;
    }
    data[ANNOTATIONS_KEY] = obj;
    await this.plugin.saveData(data);
  }

  /** Anotaciones de una nota. */
  get(notePath: string): Annotation[] {
    return this.cache.get(notePath) ?? [];
  }

  /** Añade una anotación. */
  async add(ann: Annotation): Promise<void> {
    const list = this.cache.get(ann.notePath) ?? [];
    list.push(ann);
    list.sort((a, b) => a.zIndex - b.zIndex);
    this.cache.set(ann.notePath, list);
    await this.saveAll();
  }

  /** Actualiza una anotación. */
  async update(id: string, notePath: string, patch: Partial<Annotation>): Promise<void> {
    const list = this.cache.get(notePath) ?? [];
    const idx = list.findIndex((a) => a.id === id);
    if (idx === -1) return;
    list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() } as Annotation;
    this.cache.set(notePath, list);
    await this.saveAll();
  }

  /** Elimina una anotación. */
  async remove(id: string, notePath: string): Promise<void> {
    const list = this.cache.get(notePath) ?? [];
    this.cache.set(notePath, list.filter((a) => a.id !== id));
    await this.saveAll();
  }

  /** Busca anotaciones por tag. */
  findByTag(tag: string): Annotation[] {
    const results: Annotation[] = [];
    for (const list of this.cache.values()) {
      for (const a of list) {
        if (a.tags?.includes(tag)) results.push(a);
      }
    }
    return results;
  }

  /** Busca anotaciones por tipo. */
  findByType(type: AnnotationType): Annotation[] {
    const results: Annotation[] = [];
    for (const list of this.cache.values()) {
      for (const a of list) {
        if (a.type === type) results.push(a);
      }
    }
    return results;
  }

  /** Todas las anotaciones del vault. */
  getAll(): Annotation[] {
    const all: Annotation[] = [];
    for (const list of this.cache.values()) all.push(...list);
    return all;
  }
}

// ─── Utilidades de creación ────────────────────────────────

let _idCounter = 0;
function genId(): string {
  _idCounter++;
  return `ann-${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_STYLES: Record<AnnotationType, AnnotationStyle> = {
  highlight: { color: "#FFEB3B", opacity: 0.4, strokeWidth: 0 },
  underline: { color: "#F44336", opacity: 1, strokeWidth: 2 },
  strike: { color: "#9E9E9E", opacity: 1, strokeWidth: 2 },
  freehand: { color: "#E91E63", opacity: 1, strokeWidth: 3 },
  arrow: { color: "#2196F3", opacity: 1, strokeWidth: 2 },
  rectangle: { color: "#4CAF50", opacity: 1, strokeWidth: 2, fillColor: "transparent" },
  circle: { color: "#9C27B0", opacity: 1, strokeWidth: 2, fillColor: "transparent" },
  text: { color: "#000000", opacity: 1, strokeWidth: 0, fontSize: 14, fontFamily: "sans-serif" },
  sticker: { color: "#FF9800", opacity: 1, strokeWidth: 0, fontSize: 32 },
  comment: { color: "#FFA726", opacity: 0.95, strokeWidth: 0, fontSize: 13 },
  "image-stamp": { color: "#000000", opacity: 1, strokeWidth: 0 },
  link: { color: "#1976D2", opacity: 1, strokeWidth: 2, dashArray: [5, 5] },
};

export function createHighlight(notePath: string, range: { start: number; end: number; text: string }, color = "#FFEB3B", author = "user"): TextRangeAnnotation {
  return {
    id: genId(),
    type: "highlight",
    notePath,
    range,
    style: { ...DEFAULT_STYLES.highlight, color },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 10,
    locked: false,
  };
}

export function createUnderline(notePath: string, range: { start: number; end: number; text: string }, color = "#F44336", author = "user"): TextRangeAnnotation {
  return {
    id: genId(),
    type: "underline",
    notePath,
    range,
    style: { ...DEFAULT_STYLES.underline, color },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 11,
    locked: false,
  };
}

export function createFreehand(notePath: string, points: Array<{ x: number; y: number; pressure?: number }>, color = "#E91E63", author = "user"): SpatialAnnotation {
  return {
    id: genId(),
    type: "freehand",
    notePath,
    position: { x: points[0]?.x ?? 0, y: points[0]?.y ?? 0 },
    points,
    style: { ...DEFAULT_STYLES.freehand, color },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 50,
    locked: false,
  };
}

export function createSticker(notePath: string, x: number, y: number, emoji: string, author = "user"): SpatialAnnotation {
  return {
    id: genId(),
    type: "sticker",
    notePath,
    position: { x, y },
    content: emoji,
    style: { ...DEFAULT_STYLES.sticker },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 100,
    locked: false,
  };
}

export function createComment(notePath: string, range: { start: number; end: number; text: string }, text: string, author = "user"): TextRangeAnnotation {
  return {
    id: genId(),
    type: "comment",
    notePath,
    range,
    text,
    style: { ...DEFAULT_STYLES.comment },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 12,
    locked: false,
  };
}

export function createArrow(notePath: string, from: { x: number; y: number }, to: { x: number; y: number }, color = "#2196F3", author = "user"): SpatialAnnotation {
  return {
    id: genId(),
    type: "arrow",
    notePath,
    position: from,
    endPosition: to,
    style: { ...DEFAULT_STYLES.arrow, color },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 40,
    locked: false,
  };
}

export function createTextNote(notePath: string, x: number, y: number, text: string, author = "user"): SpatialAnnotation {
  return {
    id: genId(),
    type: "text",
    notePath,
    position: { x, y },
    content: text,
    style: { ...DEFAULT_STYLES.text },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 60,
    locked: false,
  };
}

export function createLink(notePath: string, x: number, y: number, target: string, label?: string, author = "user"): SpatialAnnotation {
  return {
    id: genId(),
    type: "link",
    notePath,
    position: { x, y, width: 100, height: 30 },
    content: label ?? target,
    linkTarget: target,
    style: { ...DEFAULT_STYLES.link },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author,
    zIndex: 30,
    locked: false,
  };
}

// ─── Renderizado ───────────────────────────────────────────

/**
   * Renderiza una anotación como SVG path o HTML.
   * Devuelve un HTMLElement que se superpone a la nota (overlay).
   */
export function renderAnnotation(ann: Annotation, scale = 1): HTMLElement | SVGElement | null {
  if ("range" in ann) {
    // TextRangeAnnotation: se renderiza como <mark> overlay (no modifica la nota)
    return renderTextRangeAnnotation(ann);
  } else {
    return renderSpatialAnnotation(ann, scale);
  }
}

function renderTextRangeAnnotation(ann: TextRangeAnnotation): HTMLElement {
  const el = document.createElement("span");
  el.className = `mnexus-annotation mnexus-ann-${ann.type}`;
  el.dataset.annotationId = ann.id;
  el.style.backgroundColor = ann.type === "highlight" ? ann.style.color : "transparent";
  el.style.opacity = String(ann.style.opacity);
  if (ann.type === "underline") {
    el.style.textDecoration = "underline";
    el.style.textDecorationColor = ann.style.color;
    el.style.textDecorationThickness = `${ann.style.strokeWidth}px`;
  } else if (ann.type === "strike") {
    el.style.textDecoration = "line-through";
    el.style.textDecorationColor = ann.style.color;
  }
  el.textContent = ann.range.text;
  if (ann.text) el.title = ann.text;
  return el;
}

function renderSpatialAnnotation(ann: SpatialAnnotation, scale: number): HTMLElement {
  const el = document.createElement("div");
  el.className = `mnexus-annotation mnexus-ann-${ann.type}`;
  el.dataset.annotationId = ann.id;
  el.style.position = "absolute";
  el.style.left = `${ann.position.x * scale}px`;
  el.style.top = `${ann.position.y * scale}px`;
  el.style.zIndex = String(ann.zIndex);
  el.style.opacity = String(ann.style.opacity);

  switch (ann.type) {
    case "freehand": {
      if (ann.points && ann.points.length > 1) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const path = ann.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * scale} ${p.y * scale}`)
          .join(" ");
        svg.innerHTML = `<path d="${path}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
        el.appendChild(svg);
      }
      break;
    }
    case "sticker": {
      el.textContent = ann.content ?? "📌";
      el.style.fontSize = `${ann.style.fontSize}px`;
      el.style.lineHeight = "1";
      el.style.pointerEvents = "all";
      el.style.cursor = "grab";
      break;
    }
    case "text": {
      el.textContent = ann.content ?? "";
      el.style.fontSize = `${ann.style.fontSize}px`;
      el.style.fontFamily = ann.style.fontFamily ?? "sans-serif";
      el.style.color = ann.style.color;
      el.style.background = "#FFFDE7";
      el.style.padding = "4px 8px";
      el.style.borderRadius = "4px";
      el.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
      el.style.maxWidth = "300px";
      el.style.whiteSpace = "pre-wrap";
      break;
    }
    case "arrow": {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const fx = ann.position.x * scale;
      const fy = ann.position.y * scale;
      const tx = (ann.endPosition?.x ?? fx) * scale;
      const ty = (ann.endPosition?.y ?? fy) * scale;
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
      svg.innerHTML = `<rect x="${ann.position.x * scale}" y="${ann.position.y * scale}" width="${(ann.position.width ?? 100) * scale}" height="${(ann.position.height ?? 50) * scale}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="${ann.style.fillColor ?? "transparent"}" />`;
      el.appendChild(svg);
      break;
    }
    case "circle": {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const cx = (ann.position.x + (ann.position.width ?? 50) / 2) * scale;
      const cy = (ann.position.y + (ann.position.height ?? 50) / 2) * scale;
      const rx = ((ann.position.width ?? 50) / 2) * scale;
      const ry = ((ann.position.height ?? 50) / 2) * scale;
      svg.innerHTML = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="${ann.style.fillColor ?? "transparent"}" />`;
      el.appendChild(svg);
      break;
    }
    case "image-stamp": {
      const img = document.createElement("img");
      img.src = ann.imageUrl ?? "";
      img.style.maxWidth = "200px";
      el.appendChild(img);
      break;
    }
    case "link": {
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
  }
  return el;
}

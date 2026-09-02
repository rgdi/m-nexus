// DrawingCanvas: pane lateral con un canvas SVG donde dibujar a mano alzada,
// rectángulos, círculos, flechas y texto. Guarda en un .svg gestionado por DrawingManager.
//
// Features avanzadas del lápiz (v0.4):
//   - Presión variable (Pointer Events API)
//   - Hover indicator: muestra un círculo en la posición del stylus sin tocar
//   - Barrel button: el botón lateral del stylus activa el borrador automáticamente
//   - Twist/tilt: capturados en metadatos de stroke
//   - Palm rejection: descarta touch si el último evento fue del lápiz

import { App, ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { DrawingDocument, DrawingShape, HTRResult, MNexusSettings, PressurePoint } from "../types";
import { DrawingManager } from "./manager";
import { VIEW_TYPE_DRAWING } from "../constants";
import { HTRManager } from "../htr/manager";
import { HTRModal } from "../ui/htrModal";

type Tool = "pen" | "rect" | "circle" | "arrow" | "text" | "eraser" | "highlighter";

export class DrawingCanvasView extends ItemView {
  private svgEl!: SVGSVGElement;
  private hoverIndicator!: SVGCircleElement;
  private doc: DrawingDocument | null = null;
  private svgPath: string | null = null;
  private currentTool: Tool = "pen";
  private stroke = "#1f6feb";
  private strokeWidth = 3;
  private isDrawing = false;
  private currentPoints: PressurePoint[] = [];
  private currentShape: DrawingShape | null = null;
  private lastPointerType: string = "";
  private lastPointerTime = 0;
  // Variables para smoothed rendering con presión
  private rafHandle: number | null = null;
  // Set para evitar palm rejection duplicates
  private ignoredPointerIds = new Set<number>();
  // HTR
  private htrManager: HTRManager | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private manager: DrawingManager,
    private settings: MNexusSettings,
    htrManager?: HTRManager
  ) {
    super(leaf);
    this.htrManager = htrManager ?? null;
  }

  getViewType(): string { return VIEW_TYPE_DRAWING; }
  getDisplayText(): string { return "M-NEXUS — Dibujar"; }
  getIcon(): string { return "edit-3"; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mnexus-panel");
    await this.render(root);
  }

  async onClose() { this.containerEl.children[1].empty(); }

  async setDocument(notePath: string, anchor?: string) {
    const { path, doc } = await this.manager.create(notePath, anchor);
    this.svgPath = path;
    this.doc = doc;
    await this.refresh();
  }

  // ─── UI ───────────────────────────────────────────────────────────────

  private async render(root: HTMLElement) {
    // Toolbar
    const toolbar = root.createDiv({ cls: "mnexus-draw-toolbar" });
    toolbar.style.display = "flex";
    toolbar.style.gap = "4px";
    toolbar.style.flexWrap = "wrap";
    toolbar.style.marginBottom = "6px";

    const tools: { id: Tool; label: string }[] = [
      { id: "pen", label: "✏️ Lápiz" },
      { id: "highlighter", label: "🖊 High" },
      { id: "rect", label: "▭ Rect" },
      { id: "circle", label: "○ Círc" },
      { id: "arrow", label: "↗ Flecha" },
      { id: "text", label: "T Texto" },
      { id: "eraser", label: "🧽 Borrar" },
    ];
    for (const t of tools) {
      const b = toolbar.createEl("button", { text: t.label });
      b.onclick = () => {
        this.currentTool = t.id;
        for (const x of Array.from(toolbar.querySelectorAll("button"))) (x as HTMLButtonElement).style.background = "";
        b.style.background = "var(--interactive-accent)";
      };
    }
    toolbar.createEl("span", { text: "  " });
    const colors = ["#1f6feb", "#d73a49", "#28a745", "#e36209", "#6f42c1", "#000000"];
    for (const c of colors) {
      const sw = toolbar.createEl("button");
      sw.style.cssText = `width:20px;height:20px;border-radius:50%;background:${c};border:2px solid var(--background-modifier-border);cursor:pointer;`;
      sw.onclick = () => (this.stroke = c);
    }
    const widthSel = toolbar.createEl("select");
    for (const w of [1, 2, 3, 5, 8]) {
      const opt = widthSel.createEl("option", { text: `${w}px`, value: String(w) });
      if (w === this.strokeWidth) opt.selected = true;
    }
    widthSel.onchange = () => (this.strokeWidth = Number(widthSel.value));

    const actions = toolbar.createEl("div");
    actions.style.marginLeft = "auto";
    actions.style.display = "flex";
    actions.style.gap = "4px";
    const newBtn = actions.createEl("button", { text: "📄 Nuevo" });
    newBtn.onclick = () => this.promptNewDocument();
    // Insertar después del recognizeBtn si existe, o en actions
    actions.appendChild(newBtn);
    const clearBtn = actions.createEl("button", { text: "🧹 Limpiar" });
    clearBtn.onclick = () => {
      if (this.doc) {
        this.doc.shapes = [];
        this.refresh();
      }
    };
    const saveBtn = actions.createEl("button", { text: "💾 Guardar" });
    saveBtn.onclick = () => this.save();
    const insertBtn = actions.createEl("button", { text: "📥 Insertar en nota" });
    insertBtn.onclick = () => this.insertIntoActive();
    const recognizeBtn = actions.createEl("button", { text: "✍️ Reconocer" });
    recognizeBtn.title = "Convertir handwriting a texto (HTR)";
    recognizeBtn.onclick = () => this.recognizeHandwriting();
    if (!this.htrManager || !this.htrManager.isAvailable()) {
      recognizeBtn.disabled = true;
      recognizeBtn.title = "Configura HTR en Ajustes";
    }

    // Canvas
    const wrap = root.createDiv({ cls: "mnexus-draw-canvas-wrap" });
    wrap.style.cssText =
      "border:1px solid var(--background-modifier-border);border-radius:6px;background:#fff;overflow:hidden;";
    const w = this.settings.drawingDefaultSize.width;
    const h = this.settings.drawingDefaultSize.height;
    this.svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    this.svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svgEl.setAttribute("width", String(w));
    this.svgEl.setAttribute("height", String(h));
    this.svgEl.style.cssText = "display:block;background:#fff;cursor:crosshair;touch-action:none;";
    this.svgEl.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    this.svgEl.addEventListener("pointermove", (e) => this.onPointerMove(e));
    this.svgEl.addEventListener("pointerup", (e) => this.onPointerUp(e));
    this.svgEl.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    this.svgEl.addEventListener("pointerleave", (e) => this.onPointerLeave(e));
    // pointerrawupdate: da eventos hover sin coalescing (donde esté disponible)
    this.svgEl.addEventListener("pointerrawupdate", (e) => this.onPointerHover(e));
    wrap.appendChild(this.svgEl);

    // Hover indicator: círculo que sigue al stylus sin tocar
    this.hoverIndicator = document.createElementNS("http://www.w3.org/2000/svg", "circle") as SVGCircleElement;
    this.hoverIndicator.setAttribute("r", "6");
    this.hoverIndicator.setAttribute("fill", "none");
    this.hoverIndicator.setAttribute("stroke", "#1f6feb");
    this.hoverIndicator.setAttribute("stroke-width", "1");
    this.hoverIndicator.setAttribute("opacity", "0.6");
    this.hoverIndicator.setAttribute("pointer-events", "none");
    this.hoverIndicator.style.display = "none";
    this.svgEl.appendChild(this.hoverIndicator);

    if (this.doc) {
      this.renderShapes();
    } else {
      const help = root.createEl("p", {
        text: "Pulsa 'Nuevo' para crear un dibujo. Se vinculará a la nota que tengas abierta.",
        cls: "mnexus-label",
      });
      help.style.padding = "12px";
    }
  }

  private promptNewDocument() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      alert("Abre una nota primero para anclar el dibujo.");
      return;
    }
    this.setDocument(file.path);
  }

  private async refresh() {
    if (this.doc) this.renderShapes();
  }

  private renderShapes() {
    while (this.svgEl.lastChild) this.svgEl.removeChild(this.svgEl.lastChild);
    if (!this.doc) return;
    const ns = "http://www.w3.org/2000/svg";
    for (const s of this.doc.shapes) {
      const el = this.shapeToElement(s, ns);
      if (el) this.svgEl.appendChild(el);
    }
  }

  private shapeToElement(s: DrawingShape, ns: string): SVGElement | null {
    if (s.type === "path" && s.points.length >= 4) {
      const d = s.points.reduce((acc, n, i) => acc + (i % 2 === 0 ? ` ${i === 0 ? "M" : "L"} ${n}` : ` ${n}`), "").trim();
      const el = document.createElementNS(ns, "path") as SVGPathElement;
      el.setAttribute("d", d);
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", s.stroke ?? "#1f6feb");
      el.setAttribute("stroke-width", String(s.strokeWidth ?? 2));
      return el;
    }
    if (s.type === "rect" && s.points.length >= 4) {
      const [x, y, x2, y2] = s.points;
      const el = document.createElementNS(ns, "rect") as SVGRectElement;
      el.setAttribute("x", String(Math.min(x, x2)));
      el.setAttribute("y", String(Math.min(y, y2)));
      el.setAttribute("width", String(Math.abs(x2 - x)));
      el.setAttribute("height", String(Math.abs(y2 - y)));
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", s.stroke ?? "#1f6feb");
      el.setAttribute("stroke-width", String(s.strokeWidth ?? 2));
      return el;
    }
    if (s.type === "circle" && s.points.length >= 4) {
      const [x, y, x2, y2] = s.points;
      const r = Math.hypot(x2 - x, y2 - y);
      const el = document.createElementNS(ns, "circle") as SVGCircleElement;
      el.setAttribute("cx", String(x));
      el.setAttribute("cy", String(y));
      el.setAttribute("r", String(r));
      el.setAttribute("fill", "none");
      el.setAttribute("stroke", s.stroke ?? "#1f6feb");
      el.setAttribute("stroke-width", String(s.strokeWidth ?? 2));
      return el;
    }
    if (s.type === "arrow" && s.points.length >= 4) {
      const [x1, y1, x2, y2] = s.points;
      const g = document.createElementNS(ns, "g") as SVGGElement;
      const line = document.createElementNS(ns, "line") as SVGLineElement;
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("stroke", s.stroke ?? "#1f6feb");
      line.setAttribute("stroke-width", String(s.strokeWidth ?? 2));
      g.appendChild(line);
      // Punta
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = 10;
      const hx1 = x2 - head * Math.cos(angle - Math.PI / 6);
      const hy1 = y2 - head * Math.sin(angle - Math.PI / 6);
      const hx2 = x2 - head * Math.cos(angle + Math.PI / 6);
      const hy2 = y2 - head * Math.sin(angle + Math.PI / 6);
      const poly = document.createElementNS(ns, "polygon") as SVGPolygonElement;
      poly.setAttribute("points", `${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`);
      poly.setAttribute("fill", s.stroke ?? "#1f6feb");
      g.appendChild(poly);
      return g;
    }
    if (s.type === "text" && s.points.length >= 2) {
      const el = document.createElementNS(ns, "text") as SVGTextElement;
      el.setAttribute("x", String(s.points[0]));
      el.setAttribute("y", String(s.points[1]));
      el.setAttribute("fill", s.stroke ?? "#1f6feb");
      el.setAttribute("font-family", "sans-serif");
      el.setAttribute("font-size", "16");
      el.textContent = s.text ?? "";
      return el;
    }
    return null;
  }

  // ─── Pointer events ──────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent) {
    if (!this.doc) return;
    // Ocultar hover indicator al tocar
    this.hoverIndicator.style.display = "none";

    // Barrel button (botón lateral del stylus) → borrador
    // e.buttons es bitmask: 1=primary, 2=secondary (barrel), 4=aux, etc.
    const barrelPressed = (e.buttons & 2) !== 0;
    if (barrelPressed && e.pointerType === "pen") {
      // Tratar como borrador
      const { x, y } = this.toSvgCoords(e);
      const idx = this.findShapeNear(x, y);
      if (idx >= 0) {
        this.doc.shapes.splice(idx, 1);
        this.refresh();
      }
      this.ignoredPointerIds.add(e.pointerId);
      return;
    }

    // Palm rejection: si el último evento fue de un lápiz hace poco y ahora
    // es touch, probablemente es la palma apoyándose.
    if (e.pointerType === "touch" && this.lastPointerType === "pen" && Date.now() - this.lastPointerTime < 200) {
      this.ignoredPointerIds.add(e.pointerId);
      return;
    }
    this.lastPointerType = e.pointerType;
    this.lastPointerTime = Date.now();
    if (this.ignoredPointerIds.has(e.pointerId)) return;

    const { x, y, pressure } = this.toSvgCoords(e);
    if (this.currentTool === "text") {
      const t = window.prompt("Texto:");
      if (t) {
        const shape: DrawingShape = {
          id: `s${Date.now()}`,
          type: "text",
          points: [x, y],
          stroke: this.stroke,
          text: t,
          createdAt: new Date().toISOString(),
        };
        this.doc.shapes.push(shape);
        this.refresh();
      }
      return;
    }
    if (this.currentTool === "eraser") {
      const idx = this.findShapeNear(x, y);
      if (idx >= 0) {
        this.doc.shapes.splice(idx, 1);
        this.refresh();
      }
      return;
    }
    this.isDrawing = true;
    this.currentPoints = [{ x, y, pressure, tiltX: e.tiltX, tiltY: e.tiltY, t: performance.now() }];
    const shapeType: DrawingShape["type"] =
      this.currentTool === "pen" || this.currentTool === "highlighter"
        ? "path"
        : (this.currentTool as DrawingShape["type"]);
    this.currentShape = {
      id: `s${Date.now()}`,
      type: shapeType,
      points: [x, y], // se convierte abajo
      stroke: this.currentTool === "highlighter" ? this.stroke + "80" : this.stroke, // alpha para highlighter
      strokeWidth: this.currentTool === "highlighter" ? this.strokeWidth * 3 : this.strokeWidth,
      createdAt: new Date().toISOString(),
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent) {
    if (this.ignoredPointerIds.has(e.pointerId)) return;
    if (!this.isDrawing || !this.currentShape || !this.doc) return;
    const { x, y, pressure } = this.toSvgCoords(e);
    if (this.currentTool === "pen" || this.currentTool === "highlighter") {
      this.currentPoints.push({ x, y, pressure, tiltX: e.tiltX, tiltY: e.tiltY, t: performance.now() });
      // Convertir a flat array para guardar
      this.currentShape.points = this.pointsToFlat(this.currentPoints);
      this.currentShape.type = "path";
    } else {
      this.currentShape.points = [
        this.currentPoints[0].x, this.currentPoints[0].y,
        x, y,
      ];
    }
    // Throttle render con requestAnimationFrame
    if (this.rafHandle == null) {
      this.rafHandle = requestAnimationFrame(() => {
        this.rafHandle = null;
        this.refresh();
      });
    }
  }

  private onPointerUp(_e: PointerEvent) {
    if (!this.isDrawing || !this.currentShape || !this.doc) {
      this.isDrawing = false;
      return;
    }
    if (this.currentShape.points.length >= 4 || this.currentShape.type === "text") {
      this.doc.shapes.push(this.currentShape);
    }
    this.currentShape = null;
    this.isDrawing = false;
    this.save();
  }

  /** Hover indicator: muestra dónde está el stylus sin tocar. */
  private onPointerHover(e: Event) {
    if (!(e instanceof PointerEvent)) return;
    if (e.pointerType !== "pen" && e.pointerType !== "mouse") return;
    if (this.isDrawing) return;
    const { x, y } = this.toSvgCoords(e);
    this.hoverIndicator.setAttribute("cx", String(x));
    this.hoverIndicator.setAttribute("cy", String(y));
    this.hoverIndicator.style.display = "";
  }

  private onPointerLeave(_e: PointerEvent) {
    this.hoverIndicator.style.display = "none";
  }

  private async recognizeHandwriting() {
    if (!this.doc) {
      alert("Crea un dibujo primero.");
      return;
    }
    if (!this.htrManager || !this.htrManager.isAvailable()) {
      alert("Configura HTR en Ajustes → M-NEXUS → HTR.");
      return;
    }
    // Convertir shapes actuales a strokes para HTR
    const strokes = this.shapesToStrokes();
    if (strokes.length === 0) {
      alert("El dibujo está vacío.");
      return;
    }
    const modal = new HTRModal(this.app, this.htrManager, strokes, this.settings.htrLanguage, (result) => {
      this.onHtrResult(result);
    });
    modal.open();
  }

  /** Convierte los shapes SVG a formato PressureStroke para HTR. */
  private shapesToStrokes(): import("../types").PressureStroke[] {
    if (!this.doc) return [];
    const out: import("../types").PressureStroke[] = [];
    let id = 0;
    for (const s of this.doc.shapes) {
      if (s.type === "path" && s.points.length >= 4) {
        const pts: PressurePoint[] = [];
        for (let i = 0; i < s.points.length; i += 2) {
          pts.push({ x: s.points[i], y: s.points[i + 1], pressure: 0.5 });
        }
        out.push({
          id: `s${id++}`,
          points: pts,
          stroke: s.stroke ?? "#000",
          strokeWidth: s.strokeWidth ?? 2,
          createdAt: new Date().toISOString(),
        });
      } else if (s.type === "text" && s.points.length >= 2) {
        // Para texto, crear un "stroke" con el texto
        // No se puede renderizar a HTR directamente, lo dejamos fuera
      }
    }
    return out;
  }

  private async onHtrResult(result: HTRResult) {
    if (!result.text.trim()) {
      alert("No se reconoció texto. Prueba mejorar la calidad del trazo.");
      return;
    }
    // Ofrecer acciones: copiar, insertar en nota, reemplazar
    const choice = window.prompt(
      `Texto reconocido (confianza ${(result.confidence * 100).toFixed(0)}%):\n\n${result.text}\n\n[A] Insertar en nota activa\n[R] Reemplazar dibujo por texto\n[C] Solo copiar al portapapeles\n\nEscribe A, R, o C:`
    );
    if (!choice) return;
    const c = choice.toUpperCase().trim();
    if (c === "C") {
      await navigator.clipboard.writeText(result.text);
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      alert("Abre una nota para insertar el texto.");
      return;
    }
    const content = await this.app.vault.read(file);
    if (c === "A") {
      await this.app.vault.modify(file, content.trimEnd() + `\n\n## ✍️ Texto reconocido\n\n${result.text}\n`);
    } else if (c === "R") {
      await this.app.vault.modify(file, content.trimEnd() + `\n\n## ✍️ Texto reconocido\n\n${result.text}\n`);
      if (this.svgPath) {
        const f = this.app.vault.getAbstractFileByPath(this.svgPath);
        if (f instanceof TFile) await this.app.vault.delete(f);
        this.doc = null;
        this.svgPath = null;
        this.refresh();
      }
    }
  }

  private toSvgCoords(e: PointerEvent): { x: number; y: number; pressure: number } {
    const rect = this.svgEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.settings.drawingDefaultSize.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.settings.drawingDefaultSize.height;
    // Pointer Events: pressure 0-1, default 0.5 si no hay
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    return { x, y, pressure };
  }

  private pointsToFlat(points: PressurePoint[]): number[] {
    return points.flatMap((p) => [p.x, p.y]);
  }

  private findShapeNear(x: number, y: number): number {
    if (!this.doc) return -1;
    const tol = 15;
    for (let i = this.doc.shapes.length - 1; i >= 0; i--) {
      const s = this.doc.shapes[i];
      if (s.points.length >= 2) {
        if (s.type === "text" || s.type === "rect" || s.type === "circle" || s.type === "arrow") {
          const xs = s.points.filter((_, idx) => idx % 2 === 0);
          const ys = s.points.filter((_, idx) => idx % 2 === 1);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          if (x >= minX - tol && x <= maxX + tol && y >= minY - tol && y <= maxY + tol) return i;
        } else {
          for (let j = 0; j < s.points.length; j += 2) {
            const dx = s.points[j] - x;
            const dy = s.points[j + 1] - y;
            if (dx * dx + dy * dy < tol * tol) return i;
          }
        }
      }
    }
    return -1;
  }

  // ─── Persist ──────────────────────────────────────────────────────────

  private async save() {
    if (!this.doc || !this.svgPath) return;
    await this.manager.save(this.doc, this.svgPath);
  }

  private async insertIntoActive() {
    if (!this.svgPath) {
      alert("Primero crea un dibujo con 'Nuevo'.");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      alert("Abre una nota donde insertar el dibujo.");
      return;
    }
    await this.save();
    const link = this.manager.embedWikilink(this.svgPath);
    const content = await this.app.vault.read(file);
    const newContent = content.trimEnd() + `\n\n## Dibujo\n\n${link}\n`;
    await this.app.vault.modify(file, newContent);
  }
}

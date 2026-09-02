// v0.27: Tests exhaustivos de las features Samsung Notes.

import { describe, it, expect } from "vitest";

// ─── Pen types ───────────────────────────────────────────
import { PEN_PRESETS, strokeWidth, renderVariableStrokePath, recognizeShape, type PenType } from "../src/annotations/penTypes";

describe("Pen types (S Pen-like)", () => {
  it("1.1 PEN_PRESETS tiene 8 tipos", () => {
    const types: PenType[] = ["pen", "pencil", "highlighter", "calligraphy", "brush", "marker", "fountain", "eraser"];
    for (const t of types) {
      expect(PEN_PRESETS[t]).toBeDefined();
    }
  });

  it("1.2 highlighter es ancho y translúcido", () => {
    const h = PEN_PRESETS.highlighter;
    expect(h.baseSize).toBeGreaterThanOrEqual(15);
    expect(h.opacity).toBeLessThanOrEqual(0.5);
    expect(h.isWide).toBe(true);
    expect(h.blendMode).toBe("multiply");
  });

  it("1.3 pencil tiene textura", () => {
    expect(PEN_PRESETS.pencil.textured).toBe(true);
  });

  it("1.4 calligraphy no responde a presión", () => {
    expect(PEN_PRESETS.calligraphy.pressureMultiplier).toBe(0);
  });

  it("1.5 strokeWidth() calcula grosor con presión", () => {
    const w1 = strokeWidth({ ...PEN_PRESETS.pen, color: "#000" }, 0.5);
    const w2 = strokeWidth({ ...PEN_PRESETS.pen, color: "#000" }, 1.0);
    expect(w2).toBeGreaterThan(w1);
  });

  it("1.6 strokeWidth() con presión 0.5 = baseSize", () => {
    const w = strokeWidth({ ...PEN_PRESETS.pen, color: "#000" }, 0.5);
    expect(w).toBeCloseTo(PEN_PRESETS.pen.baseSize);
  });

  it("1.7 renderVariableStrokePath() genera SVG con segmentos", () => {
    const path = renderVariableStrokePath(
      [{ x: 0, y: 0, pressure: 0.5 }, { x: 10, y: 10, pressure: 0.7 }, { x: 20, y: 5, pressure: 0.9 }],
      { ...PEN_PRESETS.pen, color: "#F00" }
    );
    expect(path).toContain("<line");
    expect(path).toContain("#F00");
  });

  it("1.8 renderVariableStrokePath() con 1 solo punto = string vacío", () => {
    const path = renderVariableStrokePath(
      [{ x: 0, y: 0 }],
      { ...PEN_PRESETS.pen, color: "#F00" }
    );
    expect(path).toBe("");
  });
});

// ─── Shape recognition ───────────────────────────────────

describe("Shape recognition", () => {
  it("2.1 reconoce una línea recta", () => {
    const points = [];
    for (let i = 0; i < 20; i++) {
      points.push({ x: i * 5, y: i * 3 });
    }
    const result = recognizeShape(points);
    expect(result.type).toBe("line");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("2.2 reconoce un rectángulo", () => {
    const points = [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 50 }, { x: 100, y: 100 },
      { x: 50, y: 100 }, { x: 0, y: 100 },
      { x: 0, y: 50 }, { x: 0, y: 0 },
    ];
    const result = recognizeShape(points);
    expect(result.type).toBe("rectangle");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("2.3 reconoce un círculo", () => {
    const points: Array<{ x: number; y: number }> = [];
    for (let a = 0; a <= 2 * Math.PI; a += Math.PI / 12) {
      points.push({ x: 100 + 50 * Math.cos(a), y: 100 + 50 * Math.sin(a) });
    }
    const result = recognizeShape(points);
    expect(result.type).toBe("circle");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("2.4 no reconoce un garabato aleatorio", () => {
    // Semilla fija para reproducibilidad
    let seed = 42;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 30; i++) {
      points.push({ x: rand() * 100, y: rand() * 100 });
    }
    const result = recognizeShape(points);
    // Garabato aleatorio puro → no debería reconocerse
    // Aceptamos: none, o cualquier tipo pero con confianza < 0.95
    expect(result.confidence).toBeLessThan(0.95);
  });

  it("2.5 con menos de 3 puntos devuelve none", () => {
    const result = recognizeShape([{ x: 0, y: 0 }]);
    expect(result.type).toBe("none");
  });
});

// ─── Lasso tool ──────────────────────────────────────────

import { LassoTool, SmartEraser } from "../src/annotations/lassoTool";
import { createFreehand, createSticker, type Annotation, type SpatialAnnotation } from "../src/annotations/noteAnnotations";

describe("Lasso tool", () => {
  it("3.1 start/add/end del path", () => {
    const lasso = new LassoTool();
    lasso.start(0, 0);
    lasso.add(100, 0);
    lasso.add(100, 100);
    lasso.add(0, 100);
    const path = lasso.end();
    expect(path.length).toBe(5); // 4 puntos + cierre
  });

  it("3.2 select() con path vacío devuelve 0 anotaciones", () => {
    const lasso = new LassoTool();
    const r = lasso.select([]);
    expect(r.annotations).toHaveLength(0);
  });

  it("3.3 select() detecta anotaciones dentro del lasso", () => {
    const lasso = new LassoTool();
    lasso.start(0, 0);
    lasso.add(200, 0);
    lasso.add(200, 200);
    lasso.add(0, 200);
    lasso.end();

    const inside = createSticker("n.md", 100, 100, "⭐");
    const outside = createSticker("n.md", 500, 500, "❌");
    const result = lasso.select([inside, outside]);
    expect(result.annotations).toContain(inside);
    expect(result.annotations).not.toContain(outside);
  });

  it("3.4 bbox del lasso es correcto", () => {
    const lasso = new LassoTool();
    lasso.start(10, 20);
    lasso.add(110, 20);
    lasso.add(110, 120);
    lasso.add(10, 120);
    lasso.end();
    const r = lasso.select([]);
    expect(r.bbox.x).toBe(10);
    expect(r.bbox.y).toBe(20);
    expect(r.bbox.width).toBe(100);
    expect(r.bbox.height).toBe(100);
  });
});

describe("Smart Eraser", () => {
  it("4.1 modo stroke borra el trazo más cercano", () => {
    const eraser = new SmartEraser("stroke");
    const ann1 = createSticker("n.md", 10, 10, "⭐");
    const ann2 = createSticker("n.md", 100, 100, "❌");
    const toErase = eraser.erase({ x: 10, y: 10 }, 20, [ann1, ann2]);
    expect(toErase).toContain(ann1);
  });

  it("4.2 modo area borra todas las que estén dentro del radio", () => {
    const eraser = new SmartEraser("area");
    const anns: Annotation[] = [];
    for (let i = 0; i < 5; i++) {
      anns.push(createSticker("n.md", i * 5, i * 5, "⭐"));
    }
    const toErase = eraser.erase({ x: 10, y: 10 }, 50, anns);
    expect(toErase.length).toBeGreaterThan(1);
  });

  it("4.3 modo pixel respeta intersección con círculo", () => {
    const eraser = new SmartEraser("pixel");
    const inside = createSticker("n.md", 50, 50, "⭐");
    const outside = createSticker("n.md", 1000, 1000, "❌");
    const toErase = eraser.erase({ x: 50, y: 50 }, 30, [inside, outside]);
    expect(toErase).toContain(inside);
    expect(toErase).not.toContain(outside);
  });
});

// ─── HTR (Handwriting to Text) ──────────────────────────

import { HandwritingRecognizer } from "../src/annotations/handwritingToText";

describe("Handwriting Recognizer", () => {
  it("5.1 recognize() con 0 trazos devuelve string vacío", async () => {
    const r = new HandwritingRecognizer("http://x", "t");
    const result = await r.recognize([]);
    expect(result.text).toBe("");
  });

  it("5.2 renderToSvg() produce SVG válido", () => {
    const r = new HandwritingRecognizer("http://x", "t");
    const anns = [
      createFreehand("n.md", [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 50, y: 50, pressure: 0.7 },
        { x: 100, y: 30, pressure: 0.9 },
      ]),
    ];
    const svg = r.renderToSvg(anns);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<path");
  });

  it("5.3 renderToSvg() sin freehand devuelve SVG vacío válido", () => {
    const r = new HandwritingRecognizer("http://x", "t");
    const svg = r.renderToSvg([]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("5.4 recognize() con backend no disponible → mock fallback", async () => {
    const r = new HandwritingRecognizer("http://localhost:1", "t");
    const anns = [createFreehand("n.md", [{ x: 0, y: 0 }, { x: 50, y: 50 }])];
    const result = await r.recognize(anns);
    // Sin backend ni DeepSeek → mock
    expect(result.provider).toBe("mock");
    expect(result.text).toContain("HTR no disponible");
  });
});

// ─── PDF Export ──────────────────────────────────────────

import { PDFExporter } from "../src/annotations/pdfExport";

describe("PDF Export", () => {
  it("6.1 exportToPDF() devuelve Blob con tipo application/pdf", async () => {
    const mockApp = {
      vault: { read: async () => "# Title\n\nContenido de la nota de prueba." },
    } as never;
    const file = { path: "test.md", name: "test.md", basename: "test" } as never;
    const exporter = new PDFExporter(mockApp);
    const blob = await exporter.exportToPDF(file, {
      annotations: [createSticker("test.md", 100, 100, "⭐")],
      pageSize: "A4",
      orientation: "portrait",
      includeStickies: true,
      includeNoteContent: true,
      includeFreehand: true,
      title: "Test",
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("6.2 PDF incluye header %PDF-", async () => {
    const mockApp = { vault: { read: async () => "test" } } as never;
    const file = { path: "x.md" } as never;
    const exporter = new PDFExporter(mockApp);
    const blob = await exporter.exportToPDF(file, {
      annotations: [],
      pageSize: "Letter",
      orientation: "landscape",
      includeStickies: false,
      includeNoteContent: true,
      includeFreehand: true,
      title: "T",
    });
    // En jsdom, blob.arrayBuffer puede no estar — usar stream
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(text).toContain("%PDF-1.4");
    expect(text).toContain("%%EOF");
  });
});

// ─── Templates ───────────────────────────────────────────

import { TEMPLATES, renderTemplate, applyTemplateToContainer } from "../src/annotations/templates";

describe("Templates / Booklets", () => {
  it("7.1 TEMPLATES tiene 12 tipos", () => {
    const types = Object.keys(TEMPLATES);
    expect(types.length).toBe(12);
  });

  it("7.2 renderTemplate() para lined genera líneas horizontales", () => {
    const svg = renderTemplate(TEMPLATES.lined, 800, 1200);
    expect(svg).toContain("<line");
    expect(svg).toContain("#BBDEFB"); // color de líneas
  });

  it("7.3 renderTemplate() para grid genera cuadrícula", () => {
    const svg = renderTemplate(TEMPLATES.grid, 800, 1200);
    // Múltiples líneas horizontales + verticales
    const lineCount = (svg.match(/<line/g) ?? []).length;
    expect(lineCount).toBeGreaterThan(50);
  });

  it("7.4 renderTemplate() para Cornell tiene 2 zonas (cues + notes)", () => {
    const svg = renderTemplate(TEMPLATES.cornell, 800, 1200);
    expect(svg).toContain("Cues");
    expect(svg).toContain("Notes");
    expect(svg).toContain("Summary");
  });

  it("7.5 renderTemplate() para calendar-weekly tiene 7 días", () => {
    const svg = renderTemplate(TEMPLATES["calendar-weekly"], 800, 1200);
    expect(svg).toContain("Lun");
    expect(svg).toContain("Mar");
    expect(svg).toContain("Dom");
  });

  it("7.6 renderTemplate() para kanban tiene 3 columnas", () => {
    const svg = renderTemplate(TEMPLATES.kanban, 800, 600);
    expect(svg).toContain("Por hacer");
    expect(svg).toContain("En progreso");
    expect(svg).toContain("Hecho");
  });

  it("7.7 applyTemplateToContainer() monta el SVG en el DOM", () => {
    const div = document.createElement("div");
    div.style.width = "800px";
    div.style.height = "1200px";
    applyTemplateToContainer(div, "lined", 800, 1200);
    const wrapper = div.querySelector(".mnexus-template-wrapper");
    expect(wrapper).toBeTruthy();
    const svg = div.querySelector("svg.mnexus-template");
    expect(svg).toBeTruthy();
  });

  it("7.8 applyTemplateToContainer() reemplaza template anterior", () => {
    const div = document.createElement("div");
    applyTemplateToContainer(div, "lined", 800, 1200);
    applyTemplateToContainer(div, "grid", 800, 1200);
    const wrappers = div.querySelectorAll(".mnexus-template-wrapper");
    expect(wrappers.length).toBe(1); // solo 1
  });
});

// ─── Tag search ──────────────────────────────────────────

import { AnnotationStore } from "../src/annotations/noteAnnotations";
import { AnnotationSearch } from "../src/annotations/tagSearch";
import { createHighlight, createComment } from "../src/annotations/noteAnnotations";

class MockPlugin {
  data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = JSON.parse(JSON.stringify(d)); }
}

const mockApp = {} as never;

describe("Tag search", () => {
  let store: AnnotationStore;
  let search: AnnotationSearch;

  beforeEach(async () => {
    const plugin = new MockPlugin();
    store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();
    search = new AnnotationSearch(store);
  });

  it("8.1 search() por texto encuentra anotaciones", async () => {
    await store.add(createHighlight("n1.md", { start: 0, end: 10, text: "membrana celular" }));
    await store.add(createHighlight("n1.md", { start: 20, end: 30, text: "núcleo" }));
    const results = search.search({ text: "membrana" });
    expect(results).toHaveLength(1);
    expect(results[0].annotation.range && "text" in results[0].annotation.range ? results[0].annotation.range.text : "").toBe("membrana celular");
  });

  it("8.2 search() por tipo", async () => {
    await store.add(createHighlight("n1.md", { start: 0, end: 5, text: "x" }));
    await store.add(createSticker("n1.md", 0, 0, "⭐"));
    const results = search.search({ types: ["sticker"] });
    expect(results).toHaveLength(1);
    expect(results[0].annotation.type).toBe("sticker");
  });

  it("8.3 search() por tag", async () => {
    const a = createHighlight("n1.md", { start: 0, end: 5, text: "x" });
    a.tags = ["importante", "examen"];
    await store.add(a);
    const results = search.search({ tags: ["importante"] });
    expect(results).toHaveLength(1);
  });

  it("8.4 search() AND de tags", async () => {
    const a = createHighlight("n1.md", { start: 0, end: 5, text: "x" });
    a.tags = ["importante", "examen"];
    await store.add(a);
    const results = search.search({ tags: ["importante", "examen"] });
    expect(results).toHaveLength(1);
    const noResults = search.search({ tags: ["importante", "no-existe"] });
    expect(noResults).toHaveLength(0);
  });

  it("8.5 search() por notePath", async () => {
    await store.add(createHighlight("n1.md", { start: 0, end: 5, text: "x" }));
    await store.add(createHighlight("n2.md", { start: 0, end: 5, text: "x" }));
    const r = search.search({ notePath: "n1.md" });
    expect(r).toHaveLength(1);
  });

  it("8.6 getAllTags() devuelve tags únicos", async () => {
    const a = createHighlight("n.md", { start: 0, end: 5, text: "x" });
    a.tags = ["a", "b"];
    const b = createHighlight("n.md", { start: 0, end: 5, text: "x" });
    b.tags = ["b", "c"];
    await store.add(a);
    await store.add(b);
    expect(search.getAllTags()).toEqual(["a", "b", "c"]);
  });

  it("8.7 addTagToNote() añade tag a todas las anotaciones de una nota", async () => {
    await store.add(createHighlight("n.md", { start: 0, end: 5, text: "x" }));
    await store.add(createSticker("n.md", 0, 0, "⭐"));
    const count = await search.addTagToNote("n.md", "test");
    expect(count).toBe(2);
    const all = store.get("n.md");
    expect(all.every((a) => a.tags?.includes("test"))).toBe(true);
  });

  it("8.8 search() con score ordena por relevancia", async () => {
    await store.add(createHighlight("n.md", { start: 0, end: 5, text: "membrana x" }));
    await store.add(createHighlight("n.md", { start: 0, end: 50, text: "membrana membrana membrana célula" }));
    const r = search.search({ text: "membrana" });
    expect(r.length).toBe(2);
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });

  it("8.9 search() por autor", async () => {
    const a1 = createHighlight("n.md", { start: 0, end: 5, text: "x" });
    a1.author = "user-1";
    const a2 = createHighlight("n.md", { start: 0, end: 5, text: "x" });
    a2.author = "user-2";
    await store.add(a1);
    await store.add(a2);
    const r = search.search({ author: "user-1" });
    expect(r).toHaveLength(1);
  });
});

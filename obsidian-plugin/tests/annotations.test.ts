// v0.25: Tests del sistema de anotaciones.

import { describe, it, expect, beforeEach } from "vitest";
import {
  AnnotationStore,
  createHighlight,
  createUnderline,
  createFreehand,
  createSticker,
  createComment,
  createArrow,
  createTextNote,
  createLink,
  type Annotation,
  type TextRangeAnnotation,
  type SpatialAnnotation,
} from "../src/annotations/noteAnnotations";

class MockPlugin {
  data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = JSON.parse(JSON.stringify(d)); }
}

const mockApp = {} as never;

describe("AnnotationStore — persistencia", () => {
  let store: AnnotationStore;
  let plugin: MockPlugin;

  beforeEach(async () => {
    plugin = new MockPlugin();
    store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();
  });

  it("1.1 get() vacío para nota nueva", () => {
    expect(store.get("nueva.md")).toEqual([]);
  });

  it("1.2 add() añade highlight", async () => {
    const ann = createHighlight("n1.md", { start: 0, end: 10, text: "test" });
    await store.add(ann);
    expect(store.get("n1.md")).toHaveLength(1);
  });

  it("1.3 persist() guarda en data.json", async () => {
    const ann = createHighlight("n1.md", { start: 0, end: 10, text: "test" });
    await store.add(ann);
    expect(plugin.data["mnexus:annotations"]).toBeDefined();
    const raw = plugin.data["mnexus:annotations"] as Record<string, unknown[]>;
    expect(raw["n1.md"]).toHaveLength(1);
  });

  it("1.4 loadAll() restaura desde disco", async () => {
    const ann = createHighlight("n1.md", { start: 0, end: 10, text: "test" });
    await store.add(ann);
    // Crear nuevo store que carga desde el mismo plugin
    const store2 = new AnnotationStore(mockApp, plugin as never);
    await store2.loadAll();
    expect(store2.get("n1.md")).toHaveLength(1);
  });

  it("1.5 remove() elimina anotación", async () => {
    const ann = createHighlight("n1.md", { start: 0, end: 10, text: "test" });
    await store.add(ann);
    await store.remove(ann.id, "n1.md");
    expect(store.get("n1.md")).toHaveLength(0);
  });

  it("1.6 update() modifica anotación", async () => {
    const ann = createHighlight("n1.md", { start: 0, end: 10, text: "test" });
    await store.add(ann);
    await store.update(ann.id, "n1.md", { text: "updated" });
    const list = store.get("n1.md");
    expect(list[0].text).toBe("updated");
  });

  it("1.7 findByTag() busca por tag", async () => {
    const ann = createHighlight("n1.md", { start: 0, end: 10, text: "test" });
    ann.tags = ["importante"];
    await store.add(ann);
    const found = store.findByTag("importante");
    expect(found).toHaveLength(1);
  });

  it("1.8 findByType() busca por tipo", async () => {
    await store.add(createHighlight("n1.md", { start: 0, end: 10, text: "t" }));
    await store.add(createUnderline("n1.md", { start: 20, end: 30, text: "u" }));
    await store.add(createUnderline("n2.md", { start: 0, end: 5, text: "u" }));
    expect(store.findByType("highlight")).toHaveLength(1);
    expect(store.findByType("underline")).toHaveLength(2);
  });

  it("1.9 getAll() devuelve todas las anotaciones del vault", async () => {
    await store.add(createHighlight("n1.md", { start: 0, end: 10, text: "t" }));
    await store.add(createHighlight("n2.md", { start: 0, end: 10, text: "t" }));
    expect(store.getAll()).toHaveLength(2);
  });
});

describe("Creators de anotaciones", () => {
  it("2.1 createHighlight() tiene tipo y color", () => {
    const ann = createHighlight("n.md", { start: 0, end: 5, text: "test" });
    expect(ann.type).toBe("highlight");
    expect(ann.style.color).toBe("#FFEB3B");
  });

  it("2.2 createHighlight() color custom", () => {
    const ann = createHighlight("n.md", { start: 0, end: 5, text: "test" }, "#FF0000");
    expect(ann.style.color).toBe("#FF0000");
  });

  it("2.3 createUnderline() tiene tipo underline", () => {
    const ann = createUnderline("n.md", { start: 0, end: 5, text: "test" });
    expect(ann.type).toBe("underline");
  });

  it("2.4 createFreehand() guarda puntos", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }];
    const ann = createFreehand("n.md", points);
    expect(ann.type).toBe("freehand");
    expect(ann.points).toHaveLength(3);
  });

  it("2.5 createSticker() con emoji", () => {
    const ann = createSticker("n.md", 100, 200, "⭐");
    expect(ann.content).toBe("⭐");
    expect(ann.position.x).toBe(100);
  });

  it("2.6 createComment() guarda texto", () => {
    const ann = createComment("n.md", { start: 0, end: 5, text: "test" }, "Mi comentario");
    expect(ann.type).toBe("comment");
    expect(ann.text).toBe("Mi comentario");
  });

  it("2.7 createArrow() tiene posición final", () => {
    const ann = createArrow("n.md", { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(ann.endPosition).toEqual({ x: 100, y: 100 });
  });

  it("2.8 createTextNote() guarda texto", () => {
    const ann = createTextNote("n.md", 50, 50, "Hola");
    expect(ann.content).toBe("Hola");
  });

  it("2.9 createLink() guarda target", () => {
    const ann = createLink("n.md", 0, 0, "OtraNota.md", "Ver nota");
    expect(ann.linkTarget).toBe("OtraNota.md");
    expect(ann.content).toBe("Ver nota");
  });
});

describe("Anotaciones — zIndex y orden", () => {
  let store: AnnotationStore;
  let plugin: MockPlugin;

  beforeEach(async () => {
    plugin = new MockPlugin();
    store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();
  });

  it("3.1 anotaciones se ordenan por zIndex", async () => {
    const low = createHighlight("n.md", { start: 0, end: 5, text: "t" });
    low.zIndex = 5;
    const high = createSticker("n.md", 0, 0, "⭐");
    high.zIndex = 100;
    await store.add(low);
    await store.add(high);
    const list = store.get("n.md");
    expect(list[0].zIndex).toBe(5);
    expect(list[1].zIndex).toBe(100);
  });
});

describe("Anotaciones — tipos y validación", () => {
  it("4.1 highlight es TextRangeAnnotation", () => {
    const ann: TextRangeAnnotation = createHighlight("n.md", { start: 0, end: 5, text: "t" });
    expect(ann.range.text).toBe("t");
    expect(ann.range.start).toBe(0);
    expect(ann.range.end).toBe(5);
  });

  it("4.2 freehand es SpatialAnnotation", () => {
    const ann: SpatialAnnotation = createFreehand("n.md", [{ x: 0, y: 0 }]);
    expect(ann.position.x).toBe(0);
  });

  it("4.3 anotación tiene timestamps", () => {
    const ann = createHighlight("n.md", { start: 0, end: 5, text: "t" });
    expect(ann.createdAt).toBeTruthy();
    expect(ann.updatedAt).toBeTruthy();
  });

  it("4.4 anotación tiene author", () => {
    const ann = createHighlight("n.md", { start: 0, end: 5, text: "t" }, "#FF0000", "user-1");
    expect(ann.author).toBe("user-1");
  });

  it("4.5 anotación tiene id único", () => {
    const a1 = createHighlight("n.md", { start: 0, end: 5, text: "t" });
    const a2 = createHighlight("n.md", { start: 0, end: 5, text: "t" });
    expect(a1.id).not.toBe(a2.id);
  });
});

describe("Anotaciones — uso combinado (estudiante real)", () => {
  it("5.1 flujo: Resaltar texto + agregar comentario", async () => {
    const plugin = new MockPlugin();
    const store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();

    // Estudiante lee nota y resalta una frase importante
    const note = "Anatomía-2026-09-07.md";
    const highlight = createHighlight(note, { start: 100, end: 150, text: "membrana celular" });
    await store.add(highlight);

    // Y agrega un comentario
    const comment = createComment(note, { start: 100, end: 150, text: "membrana celular" }, "¡Importante para el examen!");
    await store.add(comment);

    // Dibuja una flecha apuntando a otro concepto
    const arrow = createArrow(note, { x: 200, y: 300 }, { x: 400, y: 350 }, "#F44336");
    await store.add(arrow);

    // Pone un sticker
    const sticker = createSticker(note, 500, 100, "⚠️");
    await store.add(sticker);

    // Verifica
    const all = store.get(note);
    expect(all).toHaveLength(4);
    expect(all.some((a) => a.type === "highlight")).toBe(true);
    expect(all.some((a) => a.type === "comment")).toBe(true);
    expect(all.some((a) => a.type === "arrow")).toBe(true);
    expect(all.some((a) => a.type === "sticker")).toBe(true);
  });

  it("5.2 flujo: Subrayar referencia y enlazar a clase", async () => {
    const plugin = new MockPlugin();
    const store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();

    const note = "Apuntes-Anatomía.md";
    // Subrayar "modelo del mosaico fluido"
    const underline = createUnderline(note, { start: 200, end: 230, text: "modelo del mosaico fluido" }, "#2196F3");
    await store.add(underline);

    // Enlazar a la nota de la clase original
    const link = createLink(note, 50, 50, "Anatomía-2026-09-07.md", "📚 Ver clase");
    await store.add(link);

    const all = store.get(note);
    expect(all).toHaveLength(2);
  });
});

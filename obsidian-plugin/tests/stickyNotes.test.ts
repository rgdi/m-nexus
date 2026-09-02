// v0.26: Tests del sistema de postits virtuales.

import { describe, it, expect } from "vitest";
import { STICKY_PRESETS, type StickyColor, type StickyStyle } from "../src/annotations/stickyNotes";
import { AnnotationStore, createSticker, createFreehand } from "../src/annotations/noteAnnotations";

class MockPlugin {
  data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = JSON.parse(JSON.stringify(d)); }
}

const mockApp = {} as never;

describe("StickyNote — colores y presets", () => {
  it("1.1 STICKY_PRESETS tiene 7 colores", () => {
    const colors: StickyColor[] = ["yellow", "pink", "blue", "green", "purple", "orange", "white"];
    for (const c of colors) {
      expect(STICKY_PRESETS[c]).toBeDefined();
      expect(STICKY_PRESETS[c].bg).toBeTruthy();
      expect(STICKY_PRESETS[c].border).toBeTruthy();
      expect(STICKY_PRESETS[c].text).toBeTruthy();
    }
  });

  it("1.2 yellow tiene colores válidos", () => {
    expect(STICKY_PRESETS.yellow.bg).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it("1.3 todos los colores son distintos", () => {
    const bgs = new Set(Object.values(STICKY_PRESETS).map((p) => p.bg));
    expect(bgs.size).toBe(7);
  });
});

// ─── StickyNoteManager (lógica sin DOM) ───────────────────

describe("StickyNote — toAnnotation", () => {
  it("2.1 convierte a SpatialAnnotation con metadata", async () => {
    // Verificamos que la clase StickyNote existe y tiene la firma esperada
    const { StickyNote } = await import("../src/annotations/stickyNotes");
    const sn = new StickyNote({
      notePath: "n1.md",
      x: 100,
      y: 200,
      content: "Hola",
      style: { color: "yellow" },
    });
    expect(sn.notePath).toBe("n1.md");
    expect(sn.x).toBe(100);
    expect(sn.y).toBe(200);
    expect(sn.content).toBe("Hola");
    expect(sn.style.color).toBe("yellow");
    expect(sn.id).toBeTruthy();

    const ann = sn.toAnnotation();
    expect(ann.type).toBe("text");
    expect(ann.position.x).toBe(100);
    expect(ann.position.y).toBe(200);
    expect(ann.content).toBe("Hola");
    expect(ann.metadata?.type).toBe("sticky-note");
    expect(ann.metadata?.color).toBe("yellow");
  });
});

describe("StickyNote — persistencia con AnnotationStore", () => {
  it("3.1 crear sticky y verificar que se guarda", async () => {
    const plugin = new MockPlugin();
    const store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();
    const { StickyNote } = await import("../src/annotations/stickyNotes");
    const sn = new StickyNote({ notePath: "n1.md", x: 50, y: 50, content: "test", style: { color: "pink" } });
    await store.add(sn.toAnnotation());
    const anns = store.get("n1.md");
    expect(anns).toHaveLength(1);
    expect(anns[0].metadata?.type).toBe("sticky-note");
  });

  it("3.2 loadAll restaura sticky notes con sus colores", async () => {
    const plugin = new MockPlugin();
    const store1 = new AnnotationStore(mockApp, plugin as never);
    await store1.loadAll();
    const { StickyNote } = await import("../src/annotations/stickyNotes");
    const sn = new StickyNote({ notePath: "n1.md", x: 0, y: 0, style: { color: "blue" } });
    await store1.add(sn.toAnnotation());

    const store2 = new AnnotationStore(mockApp, plugin as never);
    await store2.loadAll();
    const anns = store2.get("n1.md");
    expect(anns).toHaveLength(1);
    expect((anns[0].metadata as Record<string, unknown>)?.color).toBe("blue");
  });
});

describe("Integración — sticky + otras anotaciones", () => {
  it("4.1 sticky + highlight + freehand coexisten", async () => {
    const plugin = new MockPlugin();
    const store = new AnnotationStore(mockApp, plugin as never);
    await store.loadAll();
    const { StickyNote } = await import("../src/annotations/stickyNotes");

    const sticky = new StickyNote({ notePath: "n1.md", x: 10, y: 10, content: "Postit", style: { color: "yellow" } });
    await store.add(sticky.toAnnotation());
    await store.add(createSticker("n1.md", 200, 200, "⭐"));
    await store.add(createFreehand("n1.md", [{ x: 50, y: 50 }, { x: 100, y: 100 }]));

    const anns = store.get("n1.md");
    expect(anns).toHaveLength(3);
    expect(anns.some((a) => a.metadata?.type === "sticky-note")).toBe(true);
    expect(anns.some((a) => a.type === "sticker")).toBe(true);
    expect(anns.some((a) => a.type === "freehand")).toBe(true);
  });
});

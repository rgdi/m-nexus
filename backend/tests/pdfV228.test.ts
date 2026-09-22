// pdfV228.test.ts — v2.28.0 PDF annotation pipeline + atomic card tests.

import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import {
  pdfAnnotationStorage,
  type PdfHighlight,
} from "../src/services/pdfAnnotationStorage.js";
import {
  shapeFromHighlight,
  createAtomicCardFromHighlight,
  batchFromHighlights,
} from "../src/services/pdfAtomicCard.js";

const DATA_DIR = join(process.cwd(), "data");
const FLASHCARDS_FILE = join(DATA_DIR, "flashcards.json");
const HIGHLIGHTS_FILE = join(DATA_DIR, "pdf-highlights.json");

/** Reset both stores + delete files for test isolation. */
async function resetAll() {
  try { await fs.unlink(FLASHCARDS_FILE); } catch {}
  try { await fs.unlink(HIGHLIGHTS_FILE); } catch {}
  await pdfAnnotationStorage._reset();
}

describe("v2.28.0 — pdfAnnotationStorage", () => {
  beforeEach(resetAll);

  it("add + list preserves documentPath grouping", async () => {
    await pdfAnnotationStorage.add({
      id: "hl-1", documentPath: "foo.pdf", page: 1, format: "text", text: "x", color: "#FFEB3B",
    });
    await pdfAnnotationStorage.add({
      id: "hl-2", documentPath: "foo.pdf", page: 2, format: "text", text: "y", color: "#FFEB3B",
    });
    await pdfAnnotationStorage.add({
      id: "hl-3", documentPath: "bar.pdf", page: 1, format: "rect", text: "z", color: "#FFEB3B",
    });
    const foo = await pdfAnnotationStorage.list("foo.pdf");
    const bar = await pdfAnnotationStorage.list("bar.pdf");
    expect(foo.length).toBe(2);
    expect(bar.length).toBe(1);
    expect(foo[0].id).toBe("hl-1");
  });

  it("update changes text + color", async () => {
    await pdfAnnotationStorage.add({
      id: "hl-1", documentPath: "a.pdf", page: 1, format: "text", text: "x", color: "#FFEB3B",
    });
    const u = await pdfAnnotationStorage.update("hl-1", "a.pdf", { text: "y", color: "#ABC123" });
    expect(u?.text).toBe("y");
    expect(u?.color).toBe("#ABC123");
    expect(u?.updatedAt).toBeGreaterThanOrEqual(u!.createdAt);
  });

  it("remove returns false for unknown id", async () => {
    const ok = await pdfAnnotationStorage.remove("nope", "any.pdf");
    expect(ok).toBe(false);
  });

  it("findById returns the highlight across documents", async () => {
    await pdfAnnotationStorage.add({
      id: "hl-1", documentPath: "x.pdf", page: 1, format: "text", text: "a", color: "#FFEB3B",
    });
    await pdfAnnotationStorage.add({
      id: "hl-2", documentPath: "y.pdf", page: 1, format: "text", text: "b", color: "#FFEB3B",
    });
    const found = await pdfAnnotationStorage.findById("hl-2");
    expect(found?.text).toBe("b");
    expect(found?.documentPath).toBe("y.pdf");
  });
});

describe("v2.28.0 — shapeFromHighlight", () => {
  it("cloze with context wraps the highlight with {{c1::...}}", () => {
    const shape = shapeFromHighlight({
      highlight: {
        id: "hl-1",
        documentPath: "x.pdf",
        page: 1,
        format: "text",
        text: "insulina",
        color: "#FFEB3B",
      },
      contextBefore: "El pancreas segrega",
      contextAfter: " y la libera",
    });
    expect(shape.cardType).toBe("cloze");
    expect(shape.front).toBe("El pancreas segrega {{c1::insulina::hint}} y la libera");
    expect(shape.back).toBe("El pancreas segrega insulina y la libera");
  });

  it("plain cloze wraps the text only when preferType=cloze and no context", () => {
    const shape = shapeFromHighlight({
      highlight: {
        id: "hl-1",
        documentPath: "x.pdf",
        page: 1,
        format: "text",
        text: "insulina",
        color: "#FFEB3B",
      },
      preferType: "cloze",
    });
    expect(shape.cardType).toBe("cloze");
    expect(shape.front).toBe("{{c1::insulina::}}");
    expect(shape.back).toBe("insulina");
  });

  it("basic Q/A used as fallback when no context and preferType=basic", () => {
    const shape = shapeFromHighlight({
      highlight: {
        id: "hl-1",
        documentPath: "x.pdf",
        page: 1,
        format: "text",
        text: "insulina",
        color: "#FFEB3B",
      },
      preferType: "basic",
    });
    expect(shape.cardType).toBe("basic");
    expect(shape.front).toContain("PDF");
    expect(shape.back).toBe("insulina");
  });

  it("XSS-safe: back se construye con el highlight text crudo (renderer escapa)", () => {
    const shape = shapeFromHighlight({
      highlight: {
        id: "hl-1",
        documentPath: "x.pdf",
        page: 1,
        format: "text",
        text: "<img src=x onerror=alert(1)>",
        color: "#FFEB3B",
      },
      preferType: "basic",
    });
    // shape carries the text; the renderer/frontend must escape at display time.
    expect(shape.back).toContain("<img");
    // No script tag visible (these were filtered by the shape by the validator's plain-cloze branch)
    expect(shape.front).not.toContain("onerror=alert(1)");
  });
});

describe("v2.28.0 — createAtomicCardFromHighlight", () => {
  beforeEach(resetAll);

  it("creates a card linked to the highlight", async () => {
    const hl: PdfHighlight = {
      id: "hl-1",
      documentPath: "ana.pdf",
      page: 1,
      format: "text",
      text: "insulina",
      color: "#FFEB3B",
      subject: "bio",
      state: "raw",
      createdAt: 0,
      updatedAt: 0,
    };
    await pdfAnnotationStorage.add(hl);
    const r = await createAtomicCardFromHighlight({
      highlight: hl,
      contextBefore: "El pancreas segrega",
      contextAfter: " y la libera",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cardType).toBe("cloze");
      expect(r.persisted).toBe(true);
      expect(r.duplicatesSkipped).toBe(0);
      expect(r.front).toBe("El pancreas segrega {{c1::insulina::hint}} y la libera");
    }
    // Verify highlight now has cardId linked.
    const updated = await pdfAnnotationStorage.findById("hl-1");
    expect(updated?.cardId).toBeDefined();
    expect(updated?.state).toBe("card-created");
  });

  it("returns the existing card on duplicate (idempotencia)", async () => {
    const hl = {
      id: "hl-1",
      documentPath: "x.pdf",
      page: 1,
      format: "text" as const,
      text: "insulina",
      color: "#FFEB3B",
      subject: "bio",
      state: "raw" as const,
      createdAt: 0,
      updatedAt: 0,
    };
    await pdfAnnotationStorage.add(hl);
    const r1 = await createAtomicCardFromHighlight({ highlight: hl, contextBefore: "ctx B", contextAfter: "ctx A" });
    const r2 = await createAtomicCardFromHighlight({ highlight: hl, contextBefore: "ctx B", contextAfter: "ctx A" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.cardId).toBe(r2.cardId);
      expect(r1.persisted).toBe(true);
      expect(r2.persisted).toBe(false);
      expect(r2.duplicatesSkipped).toBeGreaterThanOrEqual(1);
    }
  });

  it("subject del highlight se convierte en subject + tag de la flashcard", async () => {
    const hl: PdfHighlight = {
      id: "hl-1",
      documentPath: "ana.pdf",
      page: 1,
      format: "text",
      text: "vena cava",
      color: "#FFEB3B",
      subject: "anat",
      state: "raw",
      createdAt: 0,
      updatedAt: 0,
    };
    await pdfAnnotationStorage.add(hl);
    const r = await createAtomicCardFromHighlight({ highlight: hl });
    expect(r.ok).toBe(true);
    const all = JSON.parse(await fs.readFile(FLASHCARDS_FILE, "utf-8")) as any[];
    const created = all.find((c) => c.id === (r as any).cardId);
    expect(created.subject).toBe("anat");
    expect(created.tags).toContain("anat");
    expect(created.sourceNoteId).toContain("ana.pdf");
  });
});

describe("v2.28.0 — batchFromHighlights", () => {
  beforeEach(resetAll);

  it("creates multiple cards in one go", async () => {
    const inputs: PdfHighlight[] = [
      { id: "hl-1", documentPath: "x.pdf", page: 1, format: "text", text: "a", color: "#FFEB3B", subject: "s1", state: "raw", createdAt: 0, updatedAt: 0 },
      { id: "hl-2", documentPath: "x.pdf", page: 2, format: "text", text: "b", color: "#FFEB3B", subject: "s1", state: "raw", createdAt: 0, updatedAt: 0 },
      { id: "hl-3", documentPath: "x.pdf", page: 3, format: "text", text: "c", color: "#FFEB3B", subject: "s1", state: "raw", createdAt: 0, updatedAt: 0 },
    ];
    for (const h of inputs) await pdfAnnotationStorage.add(h);
    const result = await batchFromHighlights(inputs);
    expect(result.total).toBe(3);
    expect(result.ok).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.persisted).toBe(3);
  });

  it("returns 0 when highlights list is empty", async () => {
    const result = await batchFromHighlights([]);
    expect(result.total).toBe(0);
    expect(result.ok).toBe(0);
  });
});

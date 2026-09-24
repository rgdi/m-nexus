// v233.test.js — v2.33.0 Print features tests.
// - printNote exports
// - printNotesBatch exports
// - PDF viewer has print button
// - print.css is linked in index.html
// - icons.js has print icon

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe("v2.33.0 — Notes print API", () => {
  it("exports printNote and printNotesBatch", async () => {
    const mod = await import("../src/screens/notes.js");
    expect(typeof mod.printNote).toBe("function");
    expect(typeof mod.printNotesBatch).toBe("function");
  });
});

describe("v2.33.0 — PDF viewer print button", () => {
  it("openPdfViewer is exported", async () => {
    const mod = await import("../src/widgets/pdf_viewer.js");
    expect(typeof mod.openPdfViewer).toBe("function");
  });

  it("PDF viewer source contains print button + handler", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/pdf_viewer.js"),
      "utf-8",
    );
    expect(src).toMatch(/data-action="print"/);
    expect(src).toMatch(/buildPdfPrintHTML/);
    expect(src).toMatch(/pdf-print/);
  });
});

describe("v2.33.0 — print.css exists and is shared", () => {
  it("print.css file exists", () => {
    const path = join(process.cwd(), "src/styles/print.css");
    expect(existsSync(path)).toBe(true);
  });

  it("print.css has note-print and pdf-print rules", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/print.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.note-print/);
    expect(css).toMatch(/\.pdf-print/);
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/atomic-flashcard/);
    expect(css).toMatch(/pdf-highlight/);
    expect(css).toMatch(/occlusion-mask/);
  });

  it("print.css is referenced from index.html", () => {
    const html = readFileSync(join(process.cwd(), "index.html"), "utf-8");
    expect(html).toMatch(/styles\/print\.css/);
  });
});

describe("v2.33.0 — icons.js has print icon", () => {
  it("icons module includes 'print'", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/icons.js"),
      "utf-8",
    );
    expect(src).toMatch(/print:/);
  });
});

describe("v2.33.0 — Notes toolbar print button", () => {
  it("notes.js wires #print-note to printNote()", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/notes.js"),
      "utf-8",
    );
    expect(src).toMatch(/#print-note/);
    expect(src).toMatch(/printNote\(note/);
    expect(src).toMatch(/#print-note-mobile/);
  });
});

describe("v2.33.0 — i18n key", () => {
  it("i18n.js has common.print", () => {
    const src = readFileSync(
      join(process.cwd(), "src/services/i18n.js"),
      "utf-8",
    );
    expect(src).toMatch(/"common\.print":/);
  });
});

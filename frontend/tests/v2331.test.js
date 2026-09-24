// v2331.test.js — v2.33.1 frontend tests.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe("v2.33.1 — Print preview widget", () => {
  it("print_preview.js exists and exports openPrintPreview", async () => {
    const path = join(process.cwd(), "src/widgets/print_preview.js");
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, "utf-8");
    expect(src).toMatch(/export async function openPrintPreview/);
  });

  it("print_preview source includes live controls (size, orient, zoom, print-media)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/print_preview.js"),
      "utf-8",
    );
    expect(src).toMatch(/data-pp-size/);
    expect(src).toMatch(/data-pp-orient/);
    expect(src).toMatch(/data-pp-zoom/);
    expect(src).toMatch(/data-pp-print-media/);
    expect(src).toMatch(/data-pp-print/);
    expect(src).toMatch(/data-pp-download-pdf/);
  });

  it("print_preview source bridges iframe print emulation", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/print_preview.js"),
      "utf-8",
    );
    expect(src).toMatch(/__emulatePrint/);
    expect(src).toMatch(/print-emulated/);
  });
});

describe("v2.33.1 — Print config modal", () => {
  it("print_config_modal.js exists", () => {
    const path = join(process.cwd(), "src/widgets/print_config_modal.js");
    expect(existsSync(path)).toBe(true);
  });

  it("exports openPrintConfigModal", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/print_config_modal.js"),
      "utf-8",
    );
    expect(src).toMatch(/export async function openPrintConfigModal/);
  });

  it("covers all configurable fields (author, footer, size, orient, watermark, etc)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/print_config_modal.js"),
      "utf-8",
    );
    expect(src).toMatch(/customAuthor/);
    expect(src).toMatch(/customFooter/);
    expect(src).toMatch(/customSubject/);
    expect(src).toMatch(/pageSize/);
    expect(src).toMatch(/orientation/);
    expect(src).toMatch(/pageNumbering/);
    expect(src).toMatch(/watermark/);
    expect(src).toMatch(/watermarkOpacity/);
    expect(src).toMatch(/showHeader/);
    expect(src).toMatch(/showFooter/);
    expect(src).toMatch(/showFlashcards/);
    expect(src).toMatch(/showHighlights/);
  });
});

describe("v2.33.1 — notes.js wiring", () => {
  it("printNote opens preview modal instead of native print", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/notes.js"),
      "utf-8",
    );
    expect(src).toMatch(/openPrintPreview/);
    expect(src).toMatch(/loadPrintConfig/);
  });

  it("notes toolbar has #print-config gear button", () => {
    const src = readFileSync(
      join(process.cwd(), "src/screens/notes.js"),
      "utf-8",
    );
    expect(src).toMatch(/#print-config/);
    expect(src).toMatch(/openPrintConfigModal/);
  });
});

describe("v2.33.1 — pdf_viewer.js wiring", () => {
  it("print action opens preview modal", () => {
    const src = readFileSync(
      join(process.cwd(), "src/widgets/pdf_viewer.js"),
      "utf-8",
    );
    expect(src).toMatch(/buildPdfPrintHTML/);
    expect(src).toMatch(/openPrintPreview/);
  });
});

describe("v2.33.1 — print.css has preview + config styles", () => {
  it("includes print-preview styles", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/print.css"),
      "utf-8",
    );
    expect(css).toMatch(/\.print-preview/);
    expect(css).toMatch(/\.print-config-form/);
    expect(css).toMatch(/--page-w/);
  });
});

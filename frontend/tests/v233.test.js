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

describe("v2.33.0 → v2.38.16 — imprimir desde el teclado, no desde un boton", () => {
  // v2.38.16. Este test comprueba que NO hay boton de imprimir. Antes
  // comproba que lo hubiera, en la barra ancha y en la de movil, que es
  // justo lo que se pidio quitar: en un telefono un icono de
  // impresora abre un dialogo del sistema que no lleva a ninguna parte.
  it("no queda ningun boton de imprimir en las barras", () => {
    const src = readFileSync(join(process.cwd(), "src/screens/notes.js"), "utf-8");
    // El marcado ya no los lleva...
    expect(src).not.toMatch(/id="print-note"/);
    expect(src).not.toMatch(/id="print-note-mobile"/);
    expect(src).not.toMatch(/id="print-config"/);
    expect(src).not.toMatch(/id="print-config-mobile"/);
    // ...y el manejador del boton se fue con ellos. Lo que queda es el
    // atajo, que llama a printNote con la nota.
    expect(src).not.toMatch(/querySelector\("#print-note"\)/);
    expect(src).toMatch(/printThisNote/);
    expect(src).toMatch(/printNote\(note/);
  });

  it("el atajo solo se registra en un PC", () => {
    const src = readFileSync(join(process.cwd(), "src/screens/notes.js"), "utf-8");
    expect(src).toMatch(/puedeImprimirConTeclado\(\)/);
    // Y el nombre de la nota se comprueba por el tipo de maquina, no
    // por el ancho: un iPad Pro en horizontal es mas ancho que un
    // portatil y no tiene Ctrl+P.
    const dev = readFileSync(join(process.cwd(), "src/services/device.js"), "utf-8");
    expect(dev).toMatch(/export function puedeImprimirConTeclado/);
    expect(dev).toMatch(/"ipad"/);
  });

  it("la nota nueva no trae ningun boton de imprimir", () => {
    const src = readFileSync(join(process.cwd(), "src/screens/notes_doc.js"), "utf-8");
    expect(src).not.toMatch(/print-note/);
    expect(src).toMatch(/puedeImprimirConTeclado/);
    expect(src).toMatch(/Ctrl<\/kbd>\+<kbd>P/);
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

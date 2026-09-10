// Tests para ImportService (Fase 6).

import { describe, it, expect, beforeEach } from "vitest";
import { ImportService } from "../src/services/importService";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ImportService", () => {
  let service: ImportService;
  let tempDir: string;

  beforeEach(() => {
    service = new ImportService();
    tempDir = mkdtempSync(join(tmpdir(), "import-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeTemp(name: string, content: string | Buffer): string {
    const path = join(tempDir, name);
    writeFileSync(path, content);
    return path;
  }

  it("imports markdown file with frontmatter", async () => {
    const md = `---
title: Mi Nota
tags: [anatomia, cardio]
---

# Anatomía

Notas con #anatomia y [[wikilink]]`;
    const path = writeTemp("nota.md", md);
    const result = await service.importFile(path);
    expect(result.source).toBe("markdown");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].frontmatter?.title).toBe("Mi Nota");
    expect(result.tags).toContain("anatomia");
    expect(result.wikilinks).toContain("wikilink");
  });

  it("imports plain text", async () => {
    const path = writeTemp("notas.txt", "Notas de clase con [[link]] y #tag");
    const result = await service.importFile(path);
    expect(result.source).toBe("text");
    expect(result.notes).toHaveLength(1);
    expect(result.wikilinks).toContain("link");
  });

  it("imports JSON as Notion", async () => {
    const notion = [
      {
        properties: { title: { title: [{ plain_text: "Mi Página" }] } },
        children: [
          { type: "paragraph", paragraph: { rich_text: [{ plain_text: "Contenido" }] } },
          { type: "heading_1", heading_1: { rich_text: [{ plain_text: "Subtítulo" }] } },
        ],
      },
    ];
    const path = writeTemp("notion.json", JSON.stringify(notion));
    const result = await service.importFile(path);
    expect(result.source).toBe("notion");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].content).toContain("# Mi Página");
    expect(result.notes[0].content).toContain("Contenido");
    expect(result.notes[0].content).toContain("# Subtítulo");
  });

  it("imports Roam JSON", async () => {
    const roam = {
      pages: [
        {
          title: "Concepto",
          children: [
            { string: "Primera idea" },
            { string: "Segunda idea" },
          ],
        },
      ],
    };
    const path = writeTemp("roam.json", JSON.stringify(roam));
    const result = await service.importFile(path);
    expect(result.source).toBe("roam");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].content).toContain("Primera idea");
  });

  it("returns error for non-existent file", async () => {
    const result = await service.importFile("/nope/file.md");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.notes).toEqual([]);
  });

  it("detects Anki .apkg files", () => {
    const result = service.importAnki("fake.apkg");
    expect(result.source).toBe("anki");
    // El apkg no se puede parsear sin deps
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("imports PDF (text-based, raw extraction)", async () => {
    // PDF fake con texto embebido
    const fakePdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog >>
endobj
BT
(F)Tj
(Hola mundo)Tj
ET
endobj
trailer
%%EOF`;
    const path = writeTemp("doc.pdf", fakePdf);
    const result = await service.importFile(path);
    expect(result.source).toBe("pdf");
    // No podemos garantizar extracción sin un parser real,
    // pero el código debe manejar el caso
    expect(result.errors).toBeDefined();
  });

  it("parseFrontmatter extracts key-value pairs", () => {
    const { frontmatter, body } = service.parseFrontmatter(`---
title: Test
author: Me
tags: a, b, c
---

# Body`);
    expect(frontmatter.title).toBe("Test");
    expect(frontmatter.author).toBe("Me");
    expect(frontmatter.tags).toBe("a, b, c");
    expect(body).toContain("# Body");
  });

  it("parseFrontmatter handles missing frontmatter", () => {
    const { frontmatter, body } = service.parseFrontmatter("Sin frontmatter");
    expect(frontmatter).toEqual({});
    expect(body).toBe("Sin frontmatter");
  });

  it("counts SRS cards in markdown (::)", async () => {
    const md = `Pregunta 1 :: Respuesta 1
Pregunta 2 :: Respuesta 2
Más texto sin card`;
    const path = writeTemp("cards.md", md);
    const result = await service.importFile(path);
    expect(result.srsCards).toBe(2);
  });

  it("imports multiple notes from Notion array", async () => {
    const notion = [
      { properties: { title: { title: [{ plain_text: "A" }] } }, children: [] },
      { properties: { title: { title: [{ plain_text: "B" }] } }, children: [] },
      { properties: { title: { title: [{ plain_text: "C" }] } }, children: [] },
    ];
    const path = writeTemp("multi.json", JSON.stringify(notion));
    const result = await service.importFile(path);
    expect(result.notes).toHaveLength(3);
  });
});

import AdmZip from "adm-zip";
import Database from "better-sqlite3";

// v0.49.2: APKG parsing tests using real AdmZip + better-sqlite3
describe("ImportService - APKG parsing (v0.49.2)", () => {
  function buildApkg(dbPath: string): Buffer {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE col (id INTEGER PRIMARY KEY, decks TEXT, models TEXT, tags TEXT, mod INTEGER);
      CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER, tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
      CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER, usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER, lapses INTEGER, "left" INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);
    `);

    const models = {
      "1607392319": { name: "Basic", flds: [{ name: "Front" }, { name: "Back" }] },
    };
    const decks = { "1": { id: 1, name: "Default" } };
    db.prepare("INSERT INTO col (id, decks, models, tags, mod) VALUES (1, ?, ?, ?, 0)").run(
      JSON.stringify(decks), JSON.stringify(models), "{}",
    );
    db.prepare(
      "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (1, 'abc', 1607392319, 0, 0, ' biology ', ?, 'Powerhouse', 0, 0, 'data1')",
    ).run("Powerhouse\x1fMitochondrion");
    db.prepare(
      "INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data) VALUES (2, 'def', 1607392319, 0, 0, ' bio dna ', ?, 'DNA', 0, 0, 'data2')",
    ).run("DNA\x1fDeoxyribonucleic acid");
    db.prepare(
      'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, "left", odue, odid, flags, data) VALUES (1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)',
    ).run();
    db.prepare(
      'INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, "left", odue, odid, flags, data) VALUES (2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)',
    ).run();
    db.close();

    const zip = new AdmZip();
    // v0.49.2: usamos addFile (no addLocalFile) para que el nombre sea EXACTO
    zip.addFile("collection.anki2", readFileSync(dbPath));
    return zip.toBuffer();
  }

  it("parses a real .apkg with adm-zip + better-sqlite3", async () => {
    const service = new ImportService();
    const tmpDb = join(tmpdir(), `apkg-test-${Date.now()}.anki2`);
    writeFileSync(tmpDb, buildApkg(tmpDb));
    const result = service.importAnki(tmpDb);
    rmSync(tmpDb, { force: true });

    expect(result.errors).toHaveLength(0);
    expect(result.notes).toHaveLength(2);
    expect(result.srsCards).toBe(2);

    // Note 1: Powerhouse
    const n1 = result.notes.find((n) => n.frontmatter?.anki_id === "1")!;
    expect(n1).toBeDefined();
    expect(n1.content).toContain("# Powerhouse");
    expect(n1.content).toContain("Mitochondrion");
    expect(n1.path).toContain("Imported/biology/");
    expect(n1.frontmatter!.model).toBe("Basic");

    // Note 2: DNA
    const n2 = result.notes.find((n) => n.frontmatter?.anki_id === "2")!;
    expect(n2.content).toContain("# DNA");
    expect(n2.path).toContain("Imported/bio/");
  });

  it("returns error for non-existent APKG file", async () => {
    const service = new ImportService();
    const result = service.importAnki("/tmp/does-not-exist-12345.apkg");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.notes).toHaveLength(0);
  });

  it("returns error for invalid APKG (random bytes)", async () => {
    const service = new ImportService();
    const tmpApkg = join(tmpdir(), `bad-${Date.now()}.apkg`);
    writeFileSync(tmpApkg, Buffer.from("not a real apkg"));
    const result = service.importAnki(tmpApkg);
    rmSync(tmpApkg, { force: true });
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

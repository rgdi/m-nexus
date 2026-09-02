// Tests del ScopeResolver con vault mock.

import { describe, it, expect, beforeEach } from "vitest";
import { ScopeResolver } from "../src/exams/scopeResolver";

// Construimos un vault mock mínimo con jerarquía de carpetas
class MockTFile {
  constructor(public path: string, public extension: string, public parent: MockTFolder) {
    parent.children.push(this);
  }
}
class MockTFolder {
  children: (MockTFile | MockTFolder)[] = [];
  constructor(public path: string, public parent: MockTFolder | null) {
    if (parent) parent.children.push(this);
  }
}

class MockVault {
  root: MockTFolder;
  files: Map<string, MockTFile> = new Map();
  folders: Map<string, MockTFolder> = new Map();

  constructor() {
    this.root = new MockTFolder("", null);
    this.folders.set("", this.root);
  }

  getRoot(): MockTFolder { return this.root; }

  addFolder(path: string): MockTFolder {
    if (this.folders.has(path)) return this.folders.get(path)!;
    const parent = this.addFolder(dirname(path));
    const f = new MockTFolder(path, parent);
    this.folders.set(path, f);
    return f;
  }

  addFile(path: string, ext = "md"): MockTFile {
    const parent = this.addFolder(dirname(path));
    const file = new MockTFile(path, ext, parent);
    this.files.set(path, file);
    return file;
  }

  getAbstractFileByPath(path: string): MockTFile | MockTFolder | null {
    if (this.files.has(path)) return this.files.get(path)!;
    if (this.folders.has(path)) return this.folders.get(path)!;
    return null;
  }

  getMarkdownFiles(): MockTFile[] {
    return Array.from(this.files.values()).filter((f) => f.extension === "md");
  }
}

class MockMetadataCache {
  tags = new Map<string, string[]>();
  subjects = new Map<string, string>();
  getFileCache(file: { path: string }) {
    return {
      frontmatter: {
        subject: this.subjects.get(file.path),
        tags: this.tags.get(file.path) ?? [],
      },
    };
  }
}

class MockApp {
  vault: MockVault;
  metadataCache: MockMetadataCache;
  constructor() {
    this.vault = new MockVault();
    this.metadataCache = new MockMetadataCache();
  }
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function setupVault() {
  const app = new MockApp();
  // Bioquímica/
  app.vault.addFile("Bioquímica/Glucólisis.md");
  app.vault.addFile("Bioquímica/Ciclo de Krebs.md");
  app.vault.addFile("Bioquímica/Glucogenólisis.md");
  app.vault.addFolder("Bioquímica/Subtema");
  app.vault.addFile("Bioquímica/Subtema/Detalle.md");
  // Anatomía/
  app.vault.addFile("Anatomía/Corazón.md");
  app.vault.addFile("Anatomía/Pulmón.md");
  // tags
  app.metadataCache.tags.set("Bioquímica/Glucólisis.md", ["bioquímica", "metabolismo"]);
  app.metadataCache.tags.set("Anatomía/Corazón.md", ["anatomía", "cardio"]);
  app.metadataCache.subjects.set("Bioquímica/Glucólisis.md", "Bioquímica");
  app.metadataCache.subjects.set("Anatomía/Corazón.md", "Anatomía");
  return app;
}

describe("ScopeResolver", () => {
  let app: MockApp;
  let resolver: ScopeResolver;

  beforeEach(() => {
    app = setupVault();
    resolver = new ScopeResolver(app as unknown as import("obsidian").App);
  });

  it("resuelve una nota individual", () => {
    const r = resolver.resolve({ type: "note", path: "Bioquímica/Glucólisis.md" });
    expect(r).toHaveLength(1);
    expect(r[0].path).toBe("Bioquímica/Glucólisis.md");
    expect(r[0].source).toBe("note");
  });

  it("resuelve una carpeta sin subcarpetas", () => {
    const r = resolver.resolve({ type: "folder", path: "Bioquímica", includeSubfolders: false });
    // Solo los .md directos, no la subcarpeta
    expect(r.map((x) => x.path).sort()).toEqual([
      "Bioquímica/Ciclo de Krebs.md",
      "Bioquímica/Glucogenólisis.md",
      "Bioquímica/Glucólisis.md",
    ]);
  });

  it("resuelve una carpeta con subcarpetas", () => {
    const r = resolver.resolve({ type: "folder", path: "Bioquímica", includeSubfolders: true });
    expect(r.map((x) => x.path).sort()).toEqual([
      "Bioquímica/Ciclo de Krebs.md",
      "Bioquímica/Glucogenólisis.md",
      "Bioquímica/Glucólisis.md",
      "Bioquímica/Subtema/Detalle.md",
    ]);
  });

  it("resuelve por tag", () => {
    const r = resolver.resolve({ type: "tag", tag: "anatomía" });
    expect(r.map((x) => x.path)).toEqual(["Anatomía/Corazón.md"]);
  });

  it("resuelve por subject", () => {
    const r = resolver.resolve({ type: "subject", subject: "Bioquímica" });
    expect(r.map((x) => x.path)).toEqual(["Bioquímica/Glucólisis.md"]);
  });

  it("resolveMany deduplica", () => {
    const r = resolver.resolveMany([
      { type: "note", path: "Bioquímica/Glucólisis.md" },
      { type: "folder", path: "Bioquímica", includeSubfolders: false },
    ]);
    // Glucólisis aparece en ambos
    const paths = r.map((x) => x.path);
    expect(paths.filter((p) => p === "Bioquímica/Glucólisis.md")).toHaveLength(1);
  });

  it("count devuelve el número correcto", () => {
    expect(resolver.count({ type: "folder", path: "Bioquímica", includeSubfolders: true })).toBe(4);
  });

  it("devuelve [] para path inexistente", () => {
    const r = resolver.resolve({ type: "note", path: "NoExiste.md" });
    expect(r).toEqual([]);
  });

  it("listFolders devuelve las carpetas", () => {
    const folders = resolver.listFolders();
    expect(folders).toContain("Bioquímica");
    expect(folders).toContain("Bioquímica/Subtema");
    expect(folders).toContain("Anatomía");
  });

  it("listTags devuelve los tags únicos normalizados", () => {
    const tags = resolver.listTags();
    expect(tags).toContain("bioquímica");
    expect(tags).toContain("metabolismo");
    expect(tags).toContain("cardio");
  });

  it("listSubjects devuelve los subjects únicos", () => {
    const subjects = resolver.listSubjects();
    expect(subjects).toContain("Bioquímica");
    expect(subjects).toContain("Anatomía");
  });

  it("searchPrefix busca en notas, carpetas y tags", () => {
    const r = resolver.searchPrefix("bioq");
    expect(r.folders.length + r.notes.length).toBeGreaterThan(0);
  });

  it("scope folder respeta excludeFolders", () => {
    const r = resolver.resolve(
      { type: "folder", path: "Bioquímica", includeSubfolders: true },
      { excludeFolders: ["Bioquímica/Subtema"] }
    );
    expect(r.map((x) => x.path)).not.toContain("Bioquímica/Subtema/Detalle.md");
  });
});

import { describe, it, expect } from "vitest";
import {
  normalizePath,
  joinPath,
  sanitizeFilename,
  pathEquals,
  isWindowsPath,
  pathToFileUrl,
  fileUrlToPath,
  safeId,
  truncatePath,
  buildFilename,
} from "../src/utils/paths";

describe("path utilities (multi-platform)", () => {
  it("normalizePath: convierte backslashes a slashes", () => {
    expect(normalizePath("C:\\Users\\foo\\bar.md")).toBe("C:/Users/foo/bar.md");
    expect(normalizePath("a//b///c")).toBe("a/b/c");
  });

  it("normalizePath: maneja path vacío", () => {
    expect(normalizePath("")).toBe("");
  });

  it("joinPath: une paths sin duplicar separadores", () => {
    expect(joinPath("_M-NEXUS", "Photos", "img.png")).toBe("_M-NEXUS/Photos/img.png");
    expect(joinPath("_M-NEXUS/", "/Photos/", "/img.png")).toBe("_M-NEXUS/Photos/img.png");
  });

  it("sanitizeFilename: elimina caracteres prohibidos", () => {
    expect(sanitizeFilename('hola:mundo/file*?.md')).not.toContain(":");
    expect(sanitizeFilename('hola:mundo/file*?.md')).not.toContain("/");
    expect(sanitizeFilename('hola:mundo/file*?.md')).not.toContain("*");
  });

  it("sanitizeFilename: limita longitud", () => {
    const long = sanitizeFilename("a".repeat(500));
    expect(long.length).toBeLessThanOrEqual(200);
  });

  it("pathEquals: case-insensitive en mac/Windows", () => {
    expect(pathEquals("Foo.MD", "foo.md")).toBe(true);
    expect(pathEquals("Foo.MD", "foo.md", false)).toBe(false);
  });

  it("isWindowsPath: detecta paths Windows", () => {
    expect(isWindowsPath("C:\\Users")).toBe(true);
    expect(isWindowsPath("\\\\server\\share")).toBe(true);
    expect(isWindowsPath("/Users/foo")).toBe(false);
  });

  it("pathToFileUrl: Windows", () => {
    expect(pathToFileUrl("C:/Users/foo.md")).toBe("file:///C:/Users/foo.md");
  });

  it("pathToFileUrl: Unix", () => {
    expect(pathToFileUrl("/home/user/foo.md")).toBe("file:///home/user/foo.md");
  });

  it("fileUrlToPath: Windows", () => {
    expect(fileUrlToPath("file:///C:/Users/foo.md")).toBe("C:\\Users\\foo.md");
  });

  it("fileUrlToPath: Unix", () => {
    expect(fileUrlToPath("file:///home/user/foo.md")).toBe("/home/user/foo.md");
  });

  it("safeId: genera IDs únicos", () => {
    const ids = new Set(Array.from({ length: 100 }, () => safeId()));
    expect(ids.size).toBe(100);
  });

  it("truncatePath: paths cortos no se modifican", () => {
    expect(truncatePath("a/b/c.md", 50)).toBe("a/b/c.md");
  });

  it("truncatePath: paths largos se acortan", () => {
    const long = "very/long/path/to/deeply/nested/file.md";
    const t = truncatePath(long, 30);
    expect(t.length).toBeLessThanOrEqual(30);
  });

  it("buildFilename: genera nombre con timestamp", () => {
    const f = buildFilename("mi nota", "png");
    expect(f).toMatch(/^mi-nota-\d{4}-\d{2}-\d{2}T.*\.png$/);
  });
});

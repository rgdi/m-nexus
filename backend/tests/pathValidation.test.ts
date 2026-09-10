// pathValidation.test.ts: tests de path validation (v0.60 P3.1)
import { describe, it, expect } from "vitest";
import { safePath, safeName, relativeSafePath } from "../src/utils/pathValidation.js";

describe("safePath (P3.1)", () => {
  const root = "/tmp/vault";

  it("acepta path absoluto dentro del root", () => {
    const p = safePath(root, "/tmp/vault/a.md");
    expect(p).toBe("/tmp/vault/a.md");
  });
  it("acepta path relativo dentro del root", () => {
    const p = safePath(root, "a/b/c.md");
    expect(p).toBe("/tmp/vault/a/b/c.md");
  });
  it("rechaza path traversal con ../", () => {
    expect(() => safePath(root, "../../etc/passwd")).toThrow();
  });
  it("rechaza path absoluto fuera del root", () => {
    expect(() => safePath(root, "/etc/passwd")).toThrow();
  });
  it("rechaza null bytes", () => {
    expect(() => safePath(root, "a\0b")).toThrow();
  });
  it("acepta root mismo", () => {
    const p = safePath(root, root);
    expect(p).toBe(root);
  });
  it("acepta subdir profundo", () => {
    const p = safePath(root, "a/b/c/d/e.md");
    expect(p).toBe("/tmp/vault/a/b/c/d/e.md");
  });
});

describe("safeName (P3.1)", () => {
  it("acepta nombre simple", () => {
    expect(safeName("a.md")).toBe("a.md");
  });
  it("rechaza nombre con /", () => {
    expect(() => safeName("a/b")).toThrow();
  });
  it("rechaza nombre con ..", () => {
    expect(() => safeName("..")).toThrow();
  });
  it("rechaza nombre vacio", () => {
    expect(() => safeName("")).toThrow();
  });
  it("rechaza nombre >255 chars", () => {
    expect(() => safeName("a".repeat(256))).toThrow();
  });
  it("rechaza null bytes", () => {
    expect(() => safeName("a\0b")).toThrow();
  });
});

describe("relativeSafePath (P3.1)", () => {
  it("convierte absoluto a relativo", () => {
    expect(relativeSafePath("/tmp/vault", "/tmp/vault/a/b.md")).toBe("a/b.md");
  });
  it("devuelve ../ si esta fuera", () => {
    expect(relativeSafePath("/tmp/vault", "/etc/passwd")).toContain("..");
  });
});

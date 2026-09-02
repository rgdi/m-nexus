// Tests del cache local de embeddings.

import { describe, it, expect } from "vitest";
import { LocalEmbeddingCache } from "../src/utils/embeddingCache";

describe("LocalEmbeddingCache", () => {
  it("get/set básico", () => {
    const c = new LocalEmbeddingCache("model-a");
    expect(c.get("hola")).toBeNull();
    c.set("hola", [0.1, 0.2]);
    expect(c.get("hola")).toEqual([0.1, 0.2]);
  });

  it("case-insensitive y trim", () => {
    const c = new LocalEmbeddingCache("m");
    c.set("Hola Mundo", [1]);
    expect(c.get("  hola mundo  ")).toEqual([1]);
  });

  it("diferentes modelos no colisionan", () => {
    const c1 = new LocalEmbeddingCache("m1");
    const c2 = new LocalEmbeddingCache("m2");
    c1.set("x", [1]);
    c2.set("x", [2]);
    expect(c1.get("x")).toEqual([1]);
    expect(c2.get("x")).toEqual([2]);
  });

  it("hit/miss tracking", () => {
    const c = new LocalEmbeddingCache("m");
    c.set("a", [1]);
    c.get("a"); // hit
    c.get("a"); // hit
    c.get("b"); // miss
    const s = c.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3);
  });

  it("invalidateModel cambia modelo y borra cache", () => {
    const c = new LocalEmbeddingCache("m1");
    c.set("x", [1]);
    c.invalidateModel("m2");
    expect(c.get("x")).toBeNull();
    c.set("x", [2]);
    expect(c.get("x")).toEqual([2]);
  });

  it("clear resetea hits/misses", () => {
    const c = new LocalEmbeddingCache("m");
    c.set("a", [1]);
    c.get("a");
    c.clear();
    const s = c.stats();
    expect(s.size).toBe(0);
    expect(s.hits).toBe(0);
  });

  it("toJSON / fromJSON roundtrip", () => {
    const c = new LocalEmbeddingCache("m");
    c.set("a", [0.1, 0.2]);
    c.set("b", [0.3, 0.4]);
    const json = c.toJSON();
    const c2 = LocalEmbeddingCache.fromJSON(json, "m");
    expect(c2.get("a")).toEqual([0.1, 0.2]);
    expect(c2.get("b")).toEqual([0.3, 0.4]);
  });

  it("memoria estimada coherente con nº de dimensiones", () => {
    const c = new LocalEmbeddingCache("m");
    c.set("x", new Array(1024).fill(0.5));
    expect(c.stats().estimatedMemoryBytes).toBe(1024 * 8);
  });
});

// Tests del EmbeddingCache y la integración con LLM/embed endpoint.

import { describe, it, expect, beforeEach } from "vitest";
import { EmbeddingCache } from "../src/services/embeddingCache";
import { EmbeddingsService } from "../src/services/embeddings";

describe("EmbeddingCache", () => {
  it("key es determinista y case-insensitive", () => {
    const a = EmbeddingCache.key("Hola Mundo", "nomic-embed-text");
    const b = EmbeddingCache.key("  hola mundo  ", "nomic-embed-text");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("key difiere entre modelos", () => {
    const a = EmbeddingCache.key("hola", "model-a");
    const b = EmbeddingCache.key("hola", "model-b");
    expect(a).not.toBe(b);
  });

  it("get/set básico", () => {
    const c = new EmbeddingCache({ maxSize: 10 });
    expect(c.get("hola", "m")).toBeNull();
    c.set("hola", "m", [0.1, 0.2, 0.3]);
    expect(c.get("hola", "m")).toEqual([0.1, 0.2, 0.3]);
  });

  it("hit/miss tracking", () => {
    const c = new EmbeddingCache({ maxSize: 10 });
    c.set("a", "m", [1]);
    c.get("a", "m"); // hit
    c.get("a", "m"); // hit
    c.get("b", "m"); // miss
    const s = c.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3);
  });

  it("LRU eviction al exceder maxSize", () => {
    const c = new EmbeddingCache({ maxSize: 2 });
    c.set("a", "m", [1]);
    c.set("b", "m", [2]);
    c.set("c", "m", [3]); // evict "a"
    expect(c.get("a", "m")).toBeNull();
    expect(c.get("b", "m")).toEqual([2]);
    expect(c.get("c", "m")).toEqual([3]);
    expect(c.stats().evictions).toBe(1);
  });

  it("LRU reordering: get promueve la entry", () => {
    const c = new EmbeddingCache({ maxSize: 2 });
    c.set("a", "m", [1]);
    c.set("b", "m", [2]);
    c.get("a", "m"); // "a" ahora es más reciente
    c.set("c", "m", [3]); // debería evictar "b", no "a"
    expect(c.get("a", "m")).toEqual([1]);
    expect(c.get("b", "m")).toBeNull();
    expect(c.get("c", "m")).toEqual([3]);
  });

  it("invalidateModel borra solo del modelo", () => {
    const c = new EmbeddingCache({ maxSize: 10 });
    c.set("a", "m1", [1]);
    c.set("b", "m1", [2]);
    c.set("c", "m2", [3]);
    const removed = c.invalidateModel("m1");
    expect(removed).toBe(2);
    expect(c.get("a", "m1")).toBeNull();
    expect(c.get("c", "m2")).toEqual([3]);
  });

  it("clear resetea todo", () => {
    const c = new EmbeddingCache({ maxSize: 10 });
    c.set("a", "m", [1]);
    c.clear();
    expect(c.get("a", "m")).toBeNull();
    expect(c.stats().size).toBe(0);
    expect(c.stats().hits).toBe(0);
  });

  it("embeddings grandes se calculan en totalMemoryBytes", () => {
    const c = new EmbeddingCache({ maxSize: 10 });
    const big = new Array(1024).fill(0.5);
    c.set("hola", "m", big);
    expect(c.stats().totalMemoryBytes).toBeGreaterThan(1024 * 8);
  });
});

describe("EmbeddingsService con cache", () => {
  beforeEach(() => {
    EmbeddingsService.resetCache();
  });

  it("primer embed es miss, segundo es hit", async () => {
    const svc = new EmbeddingsService();
    const r1 = await svc.embed(["hola mundo", "adios"], "test-model");
    expect(r1.cacheStats?.misses).toBe(2);
    expect(r1.cacheStats?.hits).toBe(0);
    const r2 = await svc.embed(["hola mundo", "adios"], "test-model");
    expect(r2.cacheStats?.hits).toBe(2);
    expect(r2.cacheStats?.misses).toBe(0);
  });

  it("embeddings cacheados son idénticos a originales", async () => {
    const svc = new EmbeddingsService();
    const r1 = await svc.embed(["x"], "test-model");
    const r2 = await svc.embed(["x"], "test-model");
    expect(r1.embeddings[0]).toEqual(r2.embeddings[0]);
  });

  it("invalidar modelo fuerza re-cálculo", async () => {
    const svc = new EmbeddingsService();
    await svc.embed(["x"], "modelA");
    expect(svc.getCacheStats().size).toBe(1);
    svc.invalidateCache("modelA");
    expect(svc.getCacheStats().size).toBe(0);
  });

  it("hitRate se calcula correctamente", async () => {
    const svc = new EmbeddingsService();
    await svc.embed(["a"], "m"); // 1 miss
    await svc.embed(["a", "b"], "m"); // 1 hit, 1 miss
    await svc.embed(["a", "b"], "m"); // 2 hits
    const stats = svc.getCacheStats();
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBeCloseTo(0.6);
  });
});

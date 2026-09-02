import { describe, it, expect, beforeEach } from "vitest";
import { VectorStore } from "../src/rag/vectorStore";
import { makeMockApp, MockApp } from "./mockObsidian";
import { RAGChunk } from "../src/types";

describe("VectorStore", () => {
  let app: MockApp;
  let store: VectorStore;

  beforeEach(() => {
    app = makeMockApp();
    store = new VectorStore(app as any, { info: () => {}, warn: () => {}, error: () => {} } as any);
  });

  it("empieza vacío", () => {
    expect(store.size()).toBe(0);
  });

  it("añadir chunks funciona", () => {
    const c: RAGChunk = {
      id: "a",
      notePath: "x.md",
      noteTitle: "X",
      chunkIndex: 0,
      text: "hola",
      embedding: [1, 0, 0],
      createdAt: new Date().toISOString(),
      hash: "abc",
    };
    store.add(c);
    expect(store.size()).toBe(1);
    expect(store.get("a")).toEqual(c);
  });

  it("removeByNote elimina solo los de esa nota", () => {
    store.add({ id: "a", notePath: "x.md", noteTitle: "X", chunkIndex: 0, text: "t1", embedding: [1, 0], createdAt: "", hash: "" });
    store.add({ id: "b", notePath: "y.md", noteTitle: "Y", chunkIndex: 0, text: "t2", embedding: [0, 1], createdAt: "", hash: "" });
    store.add({ id: "c", notePath: "x.md", noteTitle: "X", chunkIndex: 1, text: "t3", embedding: [1, 1], createdAt: "", hash: "" });
    const removed = store.removeByNote("x.md");
    expect(removed).toBe(2);
    expect(store.size()).toBe(1);
    expect(store.get("b")).toBeTruthy();
  });

  it("pruneStale elimina los que no están en currentHashes", () => {
    store.add({ id: "a", notePath: "x.md", noteTitle: "X", chunkIndex: 0, text: "t1", embedding: [1, 0], createdAt: "", hash: "" });
    store.add({ id: "b", notePath: "x.md", noteTitle: "X", chunkIndex: 1, text: "t2", embedding: [0, 1], createdAt: "", hash: "" });
    const removed = store.pruneStale(new Set(["a"]));
    expect(removed).toBe(1);
    expect(store.size()).toBe(1);
  });

  it("search devuelve resultados ordenados por score desc", () => {
    store.add({ id: "a", notePath: "x.md", noteTitle: "X", chunkIndex: 0, text: "a", embedding: [1, 0, 0], createdAt: "", hash: "" });
    store.add({ id: "b", notePath: "x.md", noteTitle: "Y", chunkIndex: 0, text: "b", embedding: [0, 1, 0], createdAt: "", hash: "" });
    store.add({ id: "c", notePath: "x.md", noteTitle: "Z", chunkIndex: 0, text: "c", embedding: [0.9, 0.1, 0], createdAt: "", hash: "" });
    const results = store.search([1, 0, 0], 3);
    expect(results[0].chunk.id).toBe("a"); // exacto
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("search respeta filter", () => {
    store.add({ id: "a", notePath: "x.md", noteTitle: "X", chunkIndex: 0, text: "a", embedding: [1, 0, 0], createdAt: "", hash: "" });
    store.add({ id: "b", notePath: "y.md", noteTitle: "Y", chunkIndex: 0, text: "b", embedding: [1, 0, 0], createdAt: "", hash: "" });
    const results = store.search([1, 0, 0], 10, (c) => c.notePath === "x.md");
    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe("a");
  });

  it("idFor es determinista", () => {
    const id1 = VectorStore.idFor("x.md", 0, "hola");
    const id2 = VectorStore.idFor("x.md", 0, "hola");
    expect(id1).toBe(id2);
  });

  it("idFor cambia con el contenido", () => {
    expect( VectorStore.idFor("x.md", 0, "a")).not.toBe(VectorStore.idFor("x.md", 0, "b"));
  });
});

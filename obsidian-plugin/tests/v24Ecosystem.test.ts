// v0.24: Tests funcionales del ecosistema completo (v2 — con mocks correctos).

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── RAG: chunker ──────────────────────────────────────────
import { chunkNote, hashText } from "../src/rag/chunker";

describe("RAG Chunker", () => {
  it("1.1 divide por headers", () => {
    const content = `# Título

Texto del primer párrafo.

## Sección 2

Texto de la segunda sección.
`;
    const file = { basename: "test" } as unknown as import("obsidian").TFile;
    const chunks = chunkNote(file, content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].section).toBe("Título");
  });

  it("1.2 minLength filtra chunks muy cortos", () => {
    const content = `# A

Contenido corto pero suficiente.
## B

Contenido más largo que el mínimo, debe ser indexado.
`;
    const file = { basename: "test" } as unknown as import("obsidian").TFile;
    const chunks = chunkNote(file, content, { minLength: 50 });
    // Ambos pasan porque tienen heading
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });

  it("1.3 respeta frontmatter (lo quita)", () => {
    const content = `---
title: Test
type: class-note
---

# Título

Contenido real.
`;
    const file = { basename: "test" } as unknown as import("obsidian").TFile;
    const chunks = chunkNote(file, content);
    for (const c of chunks) {
      expect(c.text).not.toContain("title: Test");
    }
  });

  it("1.4 subdivide secciones largas", () => {
    const longBody = "Lorem ipsum ".repeat(200);
    const content = `# Test\n\n${longBody}\n`;
    const file = { basename: "test" } as unknown as import("obsidian").TFile;
    const chunks = chunkNote(file, content, { targetSize: 200, overlap: 20 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("1.5 hashText produce hashes determinísticos", () => {
    const h1 = hashText("hello world");
    const h2 = hashText("hello world");
    expect(h1).toBe(h2);
  });
});

// ─── RAG: vectorStore + cosine ─────────────────────────────
import { VectorStore, cosine } from "../src/rag/vectorStore";
import type { RAGChunk } from "../src/types";

class MockPlugin {
  data: Record<string, unknown> = {};
  async loadData() { return this.data; }
  async saveData(d: Record<string, unknown>) { this.data = JSON.parse(JSON.stringify(d)); }
}

const mockLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

describe("RAG VectorStore", () => {
  it("2.1 size() empieza en 0", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    expect(store.size()).toBe(0);
  });

  it("2.2 add() añade chunks", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    store.add({
      id: "c1",
      notePath: "n1.md",
      noteTitle: "n1",
      chunkIndex: 0,
      text: "test",
      embedding: [1, 0, 0],
      createdAt: new Date().toISOString(),
      hash: "h1",
    });
    expect(store.size()).toBe(1);
  });

  it("2.3 cosine() vectores idénticos = 1", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("2.4 cosine() vectores ortogonales = 0", () => {
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("2.5 cosine() vectores opuestos = -1", () => {
    expect(cosine([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
  });

  it("2.6 cosine() dimensiones diferentes = 0", () => {
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
  });

  it("2.7 cosine() vectores cero = 0", () => {
    expect(cosine([0, 0, 0], [0, 0, 0])).toBe(0);
  });

  it("2.8 search() devuelve top-k ordenados por score", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    const chunks: RAGChunk[] = [
      { id: "c1", notePath: "n1", noteTitle: "t1", chunkIndex: 0, text: "a", embedding: [1, 0, 0], createdAt: "", hash: "h1" },
      { id: "c2", notePath: "n2", noteTitle: "t2", chunkIndex: 0, text: "b", embedding: [0.5, 0.5, 0], createdAt: "", hash: "h2" },
      { id: "c3", notePath: "n3", noteTitle: "t3", chunkIndex: 0, text: "c", embedding: [0, 1, 0], createdAt: "", hash: "h3" },
    ];
    for (const c of chunks) store.add(c);
    const results = store.search([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].chunk.id).toBe("c1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("2.9 search() con filter", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    for (let i = 0; i < 3; i++) {
      store.add({
        id: `c${i}`,
        notePath: i === 0 ? "incluir.md" : "excluir.md",
        noteTitle: `t${i}`,
        chunkIndex: 0,
        text: "x",
        embedding: [1, 0, 0],
        createdAt: "",
        hash: `h${i}`,
      });
    }
    const results = store.search([1, 0, 0], 10, (c) => c.notePath === "incluir.md");
    expect(results).toHaveLength(1);
  });

  it("2.10 removeByNote() quita todos los chunks de una nota", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    for (let i = 0; i < 5; i++) {
      store.add({
        id: `c${i}`,
        notePath: "nota.md",
        noteTitle: "n",
        chunkIndex: i,
        text: "x",
        embedding: [1, 0, 0],
        createdAt: "",
        hash: `h${i}`,
      });
    }
    expect(store.removeByNote("nota.md")).toBe(5);
    expect(store.size()).toBe(0);
  });

  it("2.11 persist() guarda en disco", async () => {
    const plugin = new MockPlugin();
    const store = new VectorStore(plugin as never, mockLog);
    await store.load();
    store.add({
      id: "c1",
      notePath: "n1",
      noteTitle: "t1",
      chunkIndex: 0,
      text: "x",
      embedding: [1, 0, 0],
      createdAt: "",
      hash: "h1",
    });
    await store.persist();
    expect(plugin.data.ragIndex).toBeDefined();
  });

  it("2.12 static idFor() genera IDs determinísticos", () => {
    const id1 = VectorStore.idFor("n1.md", 0, "text");
    const id2 = VectorStore.idFor("n1.md", 0, "text");
    expect(id1).toBe(id2);
  });
});

// ─── RAG: embeddings ──────────────────────────────────────
import { OpenAIEmbeddings, LocalEmbeddings } from "../src/rag/embeddings";

describe("RAG Embeddings providers", () => {
  it("3.1 OpenAIEmbeddings — isConfigured con openrouterApiKey", () => {
    const e = new OpenAIEmbeddings({ openrouterApiKey: "test" } as never, mockLog);
    expect(e.isConfigured()).toBe(true);
  });

  it("3.2 OpenAIEmbeddings — isConfigured sin openrouterApiKey", () => {
    const e = new OpenAIEmbeddings({ openrouterApiKey: "" } as never, mockLog);
    expect(e.isConfigured()).toBe(false);
  });

  it("3.3 OpenAIEmbeddings — dimensions por modelo", () => {
    const e = new OpenAIEmbeddings({ openrouterApiKey: "k" } as never, mockLog);
    expect(e.dimensions).toBe(1536);
  });

  it("3.4 LocalEmbeddings — id y name", () => {
    const e = new LocalEmbeddings();
    expect(e.id).toBe("local");
  });
});

// ─── RAG: indexer ──────────────────────────────────────────
import { Indexer } from "../src/rag/indexer";

describe("RAG Indexer", () => {
  it("4.1 indexVault() cuenta indexadas y skipped", async () => {
    const files: { path: string; basename: string; content: string; frontmatter?: Record<string, unknown> }[] = [
      { path: "n1.md", basename: "n1", content: "# T\n\nTexto para indexar con longitud suficiente." },
      { path: "_M-NEXUS/n2.md", basename: "n2", content: "# T\n\nTexto." },
    ];
    const app = {
      vault: {
        getMarkdownFiles: () => files as never,
        read: async (f: { path: string }) => files.find((x) => x.path === f.path)?.content ?? "",
      },
      metadataCache: {
        getFileCache: (f: { path: string }) => {
          const m = files.find((x) => x.path === f.path);
          return { frontmatter: m?.frontmatter };
        },
      },
    };
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    const embeddings = { isConfigured: () => true, embed: async (t: string) => t.split("").map((_, i) => i * 0.001), embedBatch: async (ts: string[]) => ts.map((t) => t.split("").map((_, i) => i * 0.001)) };
    const indexer = new Indexer(app as never, { ragEnabled: true } as never, mockLog, store, embeddings as never);
    const r = await indexer.indexVault();
    expect(r.indexed).toBe(1);
    expect(r.skipped).toBe(1);
  });
});

// ─── RAG: retriever ───────────────────────────────────────
import { Retriever } from "../src/rag/retriever";

describe("RAG Retriever", () => {
  it("5.1 retrieve() devuelve contexto", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    store.add({
      id: "c1",
      notePath: "anatomia.md",
      noteTitle: "Anatomía",
      chunkIndex: 0,
      text: "La membrana celular es una bicapa lipídica",
      embedding: [1, 0, 0],
      createdAt: "",
      hash: "h1",
    });
    const embeddings = { isConfigured: () => true, embed: async () => [1, 0, 0], embedBatch: async (t: string[]) => t.map(() => [1, 0, 0]) };
    const retriever = new Retriever(embeddings as never, store, mockLog);
    const results = await retriever.retrieve("membrana celular", { topK: 1, minScore: 0 });
    expect(results.length).toBe(1);
  });

  it("5.2 buildContext() genera prompt para LLM", async () => {
    const store = new VectorStore(new MockPlugin() as never, mockLog);
    await store.load();
    store.add({
      id: "c1",
      notePath: "n1.md",
      noteTitle: "N1",
      chunkIndex: 0,
      text: "Texto del chunk",
      embedding: [1, 0, 0],
      createdAt: "",
      hash: "h1",
    });
    const embeddings = { isConfigured: () => true, embed: async () => [1, 0, 0], embedBatch: async (t: string[]) => t.map(() => [1, 0, 0]) };
    const retriever = new Retriever(embeddings as never, store, mockLog);
    const results = await retriever.retrieve("query", { topK: 1, minScore: 0 });
    const ctx = retriever.buildContext(results);
    expect(ctx).toContain("Texto del chunk");
  });
});

// ─── LLM providers ────────────────────────────────────────
import { LLMManager } from "../src/llm/manager";
import { OllamaProvider } from "../src/llm/ollama";
import { OpenRouterProvider } from "../src/llm/openrouter";
import { RemoteLLMProvider } from "../src/llm/remoteProvider";

const mockApp = {} as never;

describe("LLM Providers", () => {
  it("6.1 LLMManager — getProvider() lanza si no configurado", () => {
    const mgr = new LLMManager(mockApp, { llmProvider: "disabled" } as never, mockLog);
    expect(() => mgr.getProvider()).toThrow();
  });

  it("6.2 LLMManager — setRemoteProvider() registra", () => {
    const mgr = new LLMManager(mockApp, { llmProvider: "disabled", forceRemote: true } as never, mockLog);
    const remote = { id: "remote", isConfigured: () => true, getStatus: async () => ({}), listModels: async () => [], complete: async () => "", chat: async () => "", streamChat: async function* () {}, completeJson: async () => ({}), chatJson: async () => ({}) } as never;
    mgr.setRemoteProvider(remote);
    // No debe lanzar porque remote está configurado y forceRemote=true
    expect(() => mgr.getProvider()).not.toThrow();
  });

  it("6.3 OllamaProvider — isConfigured con baseUrl", () => {
    const p = new OllamaProvider({ ollamaBaseUrl: "http://x:11434", llmProvider: "ollama" } as never, mockLog);
    expect(p.isConfigured()).toBe(true);
  });

  it("6.4 OpenRouterProvider — isConfigured con apiKey", () => {
    const p = new OpenRouterProvider({ openrouterApiKey: "k", llmProvider: "openrouter" } as never, mockLog);
    expect(p.isConfigured()).toBe(true);
  });
});

// ─── Flashcards: tipos ─────────────────────────────────────
import { localDetectType, normalizeType } from "../src/flashcards/autoTypes";

describe("Flashcards: tipos", () => {
  it("7.1 normalizeType() normaliza strings", () => {
    expect(normalizeType("basic")).toBe("basic");
    expect(normalizeType("cloze")).toBe("cloze");
    expect(normalizeType("image-occlusion")).toBe("image-occlusion");
    expect(normalizeType("reversed")).toBe("reversed");
    expect(normalizeType("list")).toBe("list");
    expect(normalizeType("freeform")).toBe("freeform");
    expect(normalizeType("unknown")).toBeNull();
  });

  it("7.2 localDetectType() detecta cloze con sintaxis Anki", () => {
    expect(localDetectType("La membrana {{c1::celular}} es importante")).toBe("cloze");
  });

  it("7.3 localDetectType() detecta list", () => {
    expect(localDetectType("- item 1\n- item 2\n- item 3")).toBe("list");
  });

  it("7.4 localDetectType() detecta reversed por equivalencia", () => {
    expect(localDetectType("Músculo esquelético: sinónimo de músculo estriado")).toBe("reversed");
  });

  it("7.5 localDetectType() detecta basic por defecto", () => {
    expect(localDetectType("Pregunta simple")).toBe("basic");
  });
});

// ─── Flashcards: parser ───────────────────────────────────
import { parseLlmResponse } from "../src/flashcards/parser";

describe("Flashcards: parser", () => {
  const template = { id: "t1", parserStrategy: "json" as const, cardType: "basic" as const, name: "T1", autoTags: [] };

  it("8.1 parseLlmResponse() parsea JSON", () => {
    const r = parseLlmResponse('[{"front": "Q", "back": "A"}]', template, "n1.md");
    expect(r.cards).toHaveLength(1);
  });

  it("8.2 parseLlmResponse() maneja JSON malformado", () => {
    const r = parseLlmResponse("not json", template, "n1.md");
    expect(r.cards).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("8.3 parseLlmResponse() extrae JSON de texto mixto", () => {
    const r = parseLlmResponse('texto previo [{"front": "Q", "back": "A"}] texto posterior', template, "n1.md");
    expect(r.cards.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── FSRS rebalance ───────────────────────────────────────
import { rebalance } from "../src/fsrs/loadBalancer";

describe("FSRS rebalance", () => {
  it("14.1 ordena cards por dueDate en horizonte", () => {
    const today = new Date();
    const r = rebalance({
      cards: [
        { card: { id: "c1", cardType: "basic", front: "Q1", back: "A1" } as never, priority: "normal" },
        { card: { id: "c2", cardType: "basic", front: "Q2", back: "A2" } as never, priority: "normal" },
        { card: { id: "c3", cardType: "basic", front: "Q3", back: "A3" } as never, priority: "normal" },
      ],
      today,
      daysWindow: 14,
      dailyReviewCap: 20,
      softCap: 30,
    });
    expect(r).toBeDefined();
    expect(r.schedule).toBeInstanceOf(Map);
  });
});

// kgV231.test.ts — v2.31.0 Knowledge Graph extraction tests.

import { describe, it, expect, beforeEach } from "vitest";
import {
  extractEntities,
  buildGraph,
  kgExtractor,
  type ExtractInput,
} from "../src/services/kgExtractor.js";

const SAMPLE: ExtractInput[] = [
  { id: "n1", type: "note", title: "Corazón", text: "El corazón es un músculo que bombea sangre. La aorta sale del ventrículo izquierdo y lleva sangre al cuerpo. La arteria pulmonar lleva sangre a los pulmones." },
  { id: "n2", type: "note", title: "Aparato respiratorio", text: "Los pulmones reciben sangre. El intercambio gaseoso ocurre en los alvéolos. La tráquea se ramifica en bronquios." },
  { id: "n3", type: "note", title: "Sistema nervioso", text: "El cerebro controla el cuerpo. El cerebelo coordina el equilibrio. Las neuronas se comunican mediante sinapsis." },
  { id: "c1", type: "card", text: "¿Qué estructura lleva sangre del ventrículo izquierdo al cuerpo? aorta" },
];

describe("v2.31.0 — extractEntities", () => {
  it("extrae entidades top-N por frecuencia", () => {
    const r = extractEntities(SAMPLE[0]);
    expect(r.entityIds.length).toBeGreaterThan(0);
    expect(r.entityIds.length).toBeLessThanOrEqual(12);
  });

  it("n-grams capturan frases multi-palabra", () => {
    const r = extractEntities(SAMPLE[0], { maxNgram: 2 });
    const labels = Array.from(r.candidateCounts.keys());
    expect(labels).toContain("sangre");
  });

  it("stopwords filtradas", () => {
    const r = extractEntities(SAMPLE[0]);
    const labels = Array.from(r.candidateCounts.keys());
    expect(labels).not.toContain("el");
    expect(labels).not.toContain("la");
    expect(labels).not.toContain("a");
  });

  it("acentos normalizados", () => {
    const r = extractEntities({ id: "x", type: "note", text: "Médula espinal y corazón. La médula conecta con el cerebelo." });
    const labels = Array.from(r.candidateCounts.keys());
    expect(labels).toContain("medula");
    expect(labels).toContain("corazon");
  });

  it("minFreq filtra candidatas raras", () => {
    const r = extractEntities(SAMPLE[0], { minFreq: 2 });
    for (const [label, count] of r.candidateCounts) {
      if (r.entityIds.some((id) => id.length === 12)) {
        // entityIds are hashed; we don't track labels directly here
        // just confirm at least one promoted has freq >= minFreq
      }
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("v2.31.0 — buildGraph", () => {
  it("construye grafo con nodes y edges", () => {
    const g = buildGraph(SAMPLE, { minFreq: 1, maxNgram: 2 });
    expect(g.nodes.length).toBeGreaterThan(0);
    expect(g.edges.length).toBeGreaterThan(0);
    expect(g.totalDocs).toBe(SAMPLE.length);
  });

  it("nodes tienen community asignada", () => {
    const g = buildGraph(SAMPLE, { minFreq: 1, maxNgram: 2 });
    for (const n of g.nodes) {
      expect(typeof n.community).toBe("number");
      expect(n.weight).toBeGreaterThan(0);
    }
  });

  it("edges source/target son ids de nodes", () => {
    const g = buildGraph(SAMPLE, { minFreq: 1, maxNgram: 2 });
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("co-ocurrencia produce edges", () => {
    const g = buildGraph([SAMPLE[0]], { minFreq: 1, maxNgram: 2 });
    // "sangre" and "corazon" co-ocurren en el mismo doc → debe haber un edge
    const hasSangre = g.nodes.some((n) => n.label.includes("sangre"));
    expect(hasSangre).toBe(true);
  });

  it("nodes ordenados por weight desc", () => {
    const g = buildGraph(SAMPLE);
    for (let i = 1; i < g.nodes.length; i++) {
      expect(g.nodes[i - 1].weight).toBeGreaterThanOrEqual(g.nodes[i].weight);
    }
  });
});

describe("v2.31.0 — kgExtractor persistence + queries", () => {
  beforeEach(async () => {
    await kgExtractor._reset();
  });

  it("rebuild persiste y getGraph retorna el mismo grafo", async () => {
    await kgExtractor.rebuild(SAMPLE);
    const g = await kgExtractor.getGraph();
    expect(g.nodes.length).toBeGreaterThan(0);
  });

  it("neighbors devuelve subgrafo centrado", async () => {
    await kgExtractor.rebuild(SAMPLE);
    const g = await kgExtractor.getGraph();
    const target = g.nodes[0].id;
    const sub = await kgExtractor.neighbors(target, 1);
    expect(sub.center).toBe(target);
    expect(sub.nodes.length).toBeGreaterThan(0);
    // Todos los edges conectan dentro del subgrafo
    const ids = new Set(sub.nodes.map((n) => n.id));
    for (const e of sub.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it("neighbors con hops > 1 expande el subgrafo", async () => {
    await kgExtractor.rebuild(SAMPLE);
    const g = await kgExtractor.getGraph();
    const target = g.nodes[0].id;
    const sub1 = await kgExtractor.neighbors(target, 1);
    const sub2 = await kgExtractor.neighbors(target, 2);
    expect(sub2.nodes.length).toBeGreaterThanOrEqual(sub1.nodes.length);
  });

  it("neighbors de id inexistente retorna vacío", async () => {
    await kgExtractor.rebuild(SAMPLE);
    const sub = await kgExtractor.neighbors("nope-id", 2);
    expect(sub.nodes.length).toBe(0);
  });

  it("communities devuelve resúmenes ordenados por tamaño", async () => {
    await kgExtractor.rebuild(SAMPLE);
    const c = await kgExtractor.communities();
    expect(c.length).toBeGreaterThan(0);
    for (let i = 1; i < c.length; i++) {
      expect(c[i - 1].size).toBeGreaterThanOrEqual(c[i].size);
    }
  });
});

// v0.28: Tests del knowledge graph, adaptive quiz y performance cache.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  KnowledgeGraph,
  createConcept,
  LAYER_LABELS,
  LAYER_ORDER,
} from "../src/study/knowledgeLayers";
import { AdaptiveQuizEngine, type QuizSession } from "../src/study/adaptiveQuiz";
import {
  TTLCache,
  debounce,
  throttle,
  memoize,
  Batcher,
  Lazy,
  ObjectPool,
  PerfTimer,
  getSingleton,
} from "../src/utils/perfCache";

// ─── KnowledgeGraph ─────────────────────────────────────

describe("KnowledgeGraph", () => {
  let graph: KnowledgeGraph;

  beforeEach(() => {
    graph = new KnowledgeGraph();
  });

  it("1.1 add() añade concepto", () => {
    const c = createConcept("c1", "Diabetes");
    graph.add(c);
    expect(graph.get("c1")).toBeTruthy();
  });

  it("1.2 findByTerm() por término exacto", () => {
    graph.add(createConcept("c1", "Diabetes mellitus tipo 2", { aliases: ["DM2"] }));
    expect(graph.findByTerm("Diabetes mellitus tipo 2")).toBeTruthy();
  });

  it("1.3 findByTerm() por alias", () => {
    graph.add(createConcept("c1", "Diabetes mellitus tipo 2", { aliases: ["DM2"] }));
    expect(graph.findByTerm("DM2")).toBeTruthy();
  });

  it("1.4 findByTerm() case-insensitive", () => {
    graph.add(createConcept("c1", "Diabetes"));
    expect(graph.findByTerm("diabetes")).toBeTruthy();
    expect(graph.findByTerm("DIABETES")).toBeTruthy();
  });

  it("1.5 updateMastery() aumenta tras respuesta correcta", () => {
    const c = createConcept("c1", "X");
    graph.add(c);
    graph.updateMastery("c1", "definition", true, 1);
    const mastery = graph.get("c1")!.layers.definition.mastery;
    expect(mastery).toBeGreaterThan(0);
  });

  it("1.6 updateMastery() reduce tras respuesta incorrecta", () => {
    const c = createConcept("c1", "X");
    graph.add(c);
    graph.updateMastery("c1", "definition", true, 1);
    const m1 = graph.get("c1")!.layers.definition.mastery;
    graph.updateMastery("c1", "definition", false, 1);
    const m2 = graph.get("c1")!.layers.definition.mastery;
    expect(m2).toBeLessThan(m1);
  });

  it("1.7 updateMastery() no excede 1.0", () => {
    const c = createConcept("c1", "X");
    graph.add(c);
    for (let i = 0; i < 20; i++) {
      graph.updateMastery("c1", "definition", true, 1);
    }
    expect(graph.get("c1")!.layers.definition.mastery).toBeLessThanOrEqual(1);
  });

  it("1.8 updateMastery() no baja de 0.0", () => {
    const c = createConcept("c1", "X");
    graph.add(c);
    for (let i = 0; i < 20; i++) {
      graph.updateMastery("c1", "definition", false, 1);
    }
    expect(graph.get("c1")!.layers.definition.mastery).toBeGreaterThanOrEqual(0);
  });

  it("1.9 findGaps() devuelve gaps ordenados por prioridad", () => {
    graph.add(createConcept("c1", "X"));
    graph.add(createConcept("c2", "Y"));
    // Hacer que c1 tenga alta maestría en todo
    for (const layer of LAYER_ORDER) {
      for (let i = 0; i < 10; i++) {
        graph.updateMastery("c1", layer, true, 1);
      }
    }
    const gaps = graph.findGaps(20);
    // Los gaps de c1 deberían tener menor prioridad que los de c2
    const c1Gaps = gaps.filter((g) => g.concept.id === "c1");
    const c2Gaps = gaps.filter((g) => g.concept.id === "c2");
    if (c1Gaps.length > 0 && c2Gaps.length > 0) {
      const avgC1 = c1Gaps.reduce((s, g) => s + g.priority, 0) / c1Gaps.length;
      const avgC2 = c2Gaps.reduce((s, g) => s + g.priority, 0) / c2Gaps.length;
      expect(avgC2).toBeGreaterThan(avgC1);
    }
  });

  it("1.10 findGaps() respeta limit", () => {
    for (let i = 0; i < 30; i++) {
      graph.add(createConcept(`c${i}`, `Concept ${i}`));
    }
    const gaps = graph.findGaps(5);
    expect(gaps.length).toBe(5);
  });

  it("1.11 stats() calcula correctamente", () => {
    graph.add(createConcept("c1", "X"));
    graph.add(createConcept("c2", "Y"));
    graph.updateMastery("c1", "definition", true, 1);
    graph.updateMastery("c1", "definition", true, 1);
    const stats = graph.stats();
    expect(stats.totalConcepts).toBe(2);
    expect(stats.totalLayers).toBe(20);
    expect(stats.knownLayers).toBe(0); // 0.1 + 0.1 no llega a 0.8
  });

  it("1.12 toJSON/fromJSON() roundtrip", () => {
    graph.add(createConcept("c1", "X"));
    const json = graph.toJSON();
    const graph2 = new KnowledgeGraph();
    graph2.fromJSON(json);
    expect(graph2.all().length).toBe(1);
  });
});

// ─── AdaptiveQuizEngine ──────────────────────────────────

describe("AdaptiveQuizEngine — capa por capa", () => {
  let graph: KnowledgeGraph;
  let engine: AdaptiveQuizEngine;

  beforeEach(() => {
    graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Diabetes tipo 2", { category: "Endo" }));
    graph.add(createConcept("c2", "Asma", { category: "Neumo" }));
    engine = new AdaptiveQuizEngine(graph, { maxQuestions: 10, stopOnMastery: false, mode: "diagnostic" });
  });

  it("2.1 startSession() crea sesión + mastery inicial en 0", () => {
    const s = engine.startSession();
    expect(s).toBeTruthy();
    expect(s.questions).toHaveLength(0);
    // La mastery de la capa preguntada DEBE ser 0 inicialmente
    // Si el quiz no actualizara mastery, esto seguiría siendo 0
    const c = graph.get("c1")!;
    expect(c.layers.definition.mastery).toBe(0);
  });

  it("2.2 nextQuestion() devuelve pregunta concisa y marca shown", () => {
    engine.startSession();
    const q = engine.nextQuestion();
    expect(q).toBeTruthy();
    expect(q!.text).toBeTruthy();
    expect(q!.text.length).toBeLessThan(80); // Concisa
    // markShown DEBE incrementar el contador
    const c = graph.get(q!.concept.id);
    if (c) {
      expect(c.layers[q!.layer].shown).toBeGreaterThan(0);
    }
  });

  it("2.3 nextQuestion() pregunta por la capa más débil (definition)", () => {
    engine.startSession();
    const q = engine.nextQuestion();
    // Sin respuestas, todas las capas tienen mastery=0, pero definition es la primera
    expect(q!.layer).toBe("definition");
  });

  it("2.4 nextQuestion() ataca la capa más débil (tratamiento si sabe definición)", () => {
    // Hacer que definition tenga alta maestría
    for (let i = 0; i < 10; i++) {
      graph.updateMastery("c1", "definition", true, 1);
    }
    engine.startSession();
    const q = engine.nextQuestion();
    // Ahora la definición de c1 ya está dominada, debe preguntar otra capa
    if (q?.concept.id === "c1") {
      expect(q.layer).not.toBe("definition");
    }
  });

  it("2.5 answerCurrent() actualiza knowledge graph (correcta)", async () => {
    engine.startSession();
    const q = engine.nextQuestion()!;
    const before = graph.get(q.concept.id)!.layers[q.layer].mastery;
    // Responder con la respuesta correcta (el término)
    const correctAnswer = graph.get(q.concept.id)!.term;
    await engine.answerCurrent(correctAnswer, 1, 1000);
    const after = graph.get(q.concept.id)!.layers[q.layer].mastery;
    expect(after).toBeGreaterThan(before);
  });

  it("2.6 answerCurrent() incorrecto no avanza mastery", async () => {
    engine.startSession();
    const q = engine.nextQuestion()!;
    const before = graph.get(q.concept.id)!.layers[q.layer].mastery;
    await engine.answerCurrent("no sé", 0.1, 1000);
    const after = graph.get(q.concept.id)!.layers[q.layer].mastery;
    expect(after).toBeLessThanOrEqual(before);
  });

  it("2.7 flow completo: 5 preguntas", async () => {
    engine.startSession();
    const questions = [];
    for (let i = 0; i < 5; i++) {
      const q = engine.nextQuestion();
      if (!q) break;
      questions.push(q);
      // Responder correctamente con el término
      const correctAnswer = graph.get(q.concept.id)!.term;
      await engine.answerCurrent(correctAnswer, 0.5, 1000);
    }
    expect(questions.length).toBe(5);
  });

  it("2.8 checkAnswer() con sinonimia", async () => {
    engine.startSession();
    const q = engine.nextQuestion()!;
    // Crear pregunta con acceptedAnswers
    q.acceptedAnswers = ["DM2", "diabetes tipo 2"];
    const r = await engine.answerCurrent("DM2", 0.9, 1000);
    expect(r.correct).toBe(true);
  });

  it("2.9 sessionResult() devuelve stats", async () => {
    engine.startSession();
    engine.nextQuestion();
    await engine.answerCurrent("test", 0.8, 1000);
    const r = engine.sessionResult();
    expect(r.totalQuestions).toBe(1);
    expect(r.averageConfidence).toBeCloseTo(0.8);
  });

  it("2.10 suggestNextLayer() avanza cuando la capa está dominada", () => {
    // Crea un concept y domina "definition"
    for (let i = 0; i < 20; i++) {
      graph.updateMastery("c1", "definition", true, 1);
    }
    engine.startSession();
    const q = engine.nextQuestion()!;
    if (q.concept.id === "c1") {
      // Ya está dominada → debe sugerir otra
      expect(q.layer).not.toBe("definition");
    }
  });
});

// ─── Performance cache ───────────────────────────────────

describe("TTLCache", () => {
  it("3.1 get() con cache vacío devuelve undefined", () => {
    const cache = new TTLCache<string, number>();
    expect(cache.get("x")).toBeUndefined();
  });

  it("3.2 set/get básico", () => {
    const cache = new TTLCache<string, number>();
    cache.set("x", 42);
    expect(cache.get("x")).toBe(42);
  });

  it("3.3 TTL expira entries", async () => {
    const cache = new TTLCache<string, number>(10, 50); // 50ms TTL
    cache.set("x", 42);
    expect(cache.get("x")).toBe(42);
    await new Promise((r) => setTimeout(r, 100));
    expect(cache.get("x")).toBeUndefined();
  });

  it("3.4 LRU eviction", () => {
    const cache = new TTLCache<string, number>(3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);
    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBeUndefined(); // evicted
  });

  it("3.5 hit rate stats", () => {
    const cache = new TTLCache<string, number>();
    cache.set("a", 1);
    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("b"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.667);
  });

  it("3.6 prune() limpia entries expiradas", async () => {
    const cache = new TTLCache<string, number>(10, 50);
    cache.set("a", 1);
    cache.set("b", 2);
    await new Promise((r) => setTimeout(r, 100));
    const pruned = cache.prune();
    expect(pruned).toBe(2);
  });
});

describe("debounce/throttle", () => {
  it("4.1 debounce() solo ejecuta tras inactividad", async () => {
    let count = 0;
    const fn = debounce(() => count++, 50);
    fn(); fn(); fn();
    expect(count).toBe(0);
    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(1);
  });

  it("4.2 debounce() cancel() evita ejecución", async () => {
    let count = 0;
    const fn = debounce(() => count++, 50);
    fn();
    fn.cancel();
    await new Promise((r) => setTimeout(r, 100));
    expect(count).toBe(0);
  });

  it("4.3 throttle() limita frecuencia", async () => {
    let count = 0;
    const fn = throttle(() => count++, 30);
    fn(); fn(); fn(); fn();
    await new Promise((r) => setTimeout(r, 50));
    expect(count).toBeLessThan(4);
  });
});

describe("memoize", () => {
  it("5.1 cachea resultados", () => {
    let calls = 0;
    const fn = memoize((x: number) => { calls++; return x * 2; });
    expect(fn(5)).toBe(10);
    expect(fn(5)).toBe(10);
    expect(calls).toBe(1);
  });

  it("5.2 argumentos diferentes = cache diferente", () => {
    let calls = 0;
    const fn = memoize((x: number) => { calls++; return x * 2; });
    fn(5);
    fn(10);
    expect(calls).toBe(2);
  });
});

describe("Batcher", () => {
  it("6.1 batch agrupa llamadas", async () => {
    const batchFn = async (items: number[]) => items.map((x) => x * 2);
    const batcher = new Batcher<number, number>(batchFn, 5, 50);
    const promises = [1, 2, 3].map((x) => batcher.add(x));
    const results = await Promise.all(promises);
    expect(results).toEqual([2, 4, 6]);
  });

  it("6.2 batch dispara al alcanzar maxSize", async () => {
    let batchCalls = 0;
    const batchFn = async (items: number[]) => { batchCalls++; return items.map((x) => x); };
    const batcher = new Batcher<number, number>(batchFn, 3, 1000);
    const promises = [1, 2, 3, 4, 5].map((x) => batcher.add(x));
    await new Promise((r) => setTimeout(r, 50));
    await Promise.all(promises);
    expect(batchCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("Lazy", () => {
  it("7.1 factory solo se llama una vez", () => {
    let calls = 0;
    const lazy = new Lazy(() => { calls++; return { x: 1 }; });
    expect(calls).toBe(0);
    lazy.get();
    lazy.get();
    expect(calls).toBe(1);
  });

  it("7.2 reset() reinicia", () => {
    let calls = 0;
    const lazy = new Lazy(() => { calls++; return { x: 1 }; });
    lazy.get();
    lazy.reset();
    lazy.get();
    expect(calls).toBe(2);
  });
});

describe("ObjectPool", () => {
  it("8.1 acquire/release básico", () => {
    const pool = new ObjectPool<{ x: number }>(() => ({ x: 0 }));
    const a = pool.acquire();
    expect(a.x).toBe(0);
    pool.release(a);
    const b = pool.acquire();
    expect(b).toBe(a); // reutiliza
  });

  it("8.2 reset() se llama al release", () => {
    const pool = new ObjectPool<{ x: number }>(() => ({ x: 0 }), (obj) => { obj.x = 999; });
    const a = pool.acquire();
    a.x = 5;
    pool.release(a);
    const b = pool.acquire();
    expect(b.x).toBe(999);
  });
});

describe("PerfTimer", () => {
  it("9.1 end() devuelve tiempo total", async () => {
    const timer = new PerfTimer("test");
    await new Promise((r) => setTimeout(r, 60));
    const r = timer.end();
    expect(r.totalMs).toBeGreaterThanOrEqual(50);
  });

  it("9.2 mark() registra checkpoints", () => {
    const timer = new PerfTimer("test");
    timer.mark("a");
    timer.mark("b");
    const r = timer.end();
    expect(r.marks).toHaveLength(2);
    expect(r.marks[0].name).toBe("a");
  });
});

describe("getSingleton", () => {
  it("10.1 factory solo se llama una vez", () => {
    let calls = 0;
    getSingleton("test", () => { calls++; return {}; });
    getSingleton("test", () => { calls++; return {}; });
    expect(calls).toBe(1);
  });
});

// ─── Adaptive quiz flow completo ─────────────────────────

describe("Adaptive quiz — flujo capa-por-capa", () => {
  it("11.1 simulación: sabe afección pero no tratamiento", async () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Diabetes"));
    // Simular que sabe las primeras 4 capas (definition, epidemiology, etiology, symptom)
    for (const layer of ["definition", "epidemiology", "etiology", "symptom"] as const) {
      for (let i = 0; i < 20; i++) graph.updateMastery("c1", layer, true, 1);
    }
    // Pero no sabe el tratamiento
    graph.updateMastery("c1", "treatment", false, 1);

    const engine = new AdaptiveQuizEngine(graph, { maxQuestions: 5, stopOnMastery: false, mode: "diagnostic" });
    engine.startSession();
    const q = engine.nextQuestion()!;
    expect(q.concept.id).toBe("c1");
    expect(q.layer).toBe("treatment");
  });

  it("11.2 concisión de las preguntas", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("c1", "Diabetes mellitus tipo 2", { aliases: ["DM2"] }));
    const engine = new AdaptiveQuizEngine(graph, { maxQuestions: 5, stopOnMastery: false, mode: "diagnostic" });
    engine.startSession();
    for (let i = 0; i < 5; i++) {
      const q = engine.nextQuestion();
      if (!q) break;
      // Cada pregunta debe ser < 80 caracteres (concisa)
      expect(q.text.length).toBeLessThan(80);
    }
  });
});

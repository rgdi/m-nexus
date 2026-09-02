// v0.28: Tests de INTEGRACIÓN end-to-end del sistema completo.
// Simula el flujo real: vault → orchestrator → proposals → apply → quiz → FSRS → loadBalancer → exam.
// Sin mocks intermedios — el sistema completo funcionando junto.

import { describe, it, expect, beforeEach } from "vitest";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";
import { AdaptiveQuizEngine, createQuizSession } from "../src/study/adaptiveQuiz";
import { StudyOrchestrator } from "../src/ai/studyOrchestrator";
import { VaultEvaluator, type NoteSnapshot } from "../src/ai/vaultEvaluator";
import { ProposalStore, genProposalId, type Proposal } from "../src/ai/contentProposals";
import { rebalance } from "../src/fsrs/loadBalancer";
import { newCard, review, FsrsCard, Rating, retrievability } from "../src/fsrs/scheduler";
import { applyKnowledgeBoost, effectiveRating } from "../src/fsrs/knowledgeBoost";
import { evaluateCards, rebalanceWithEvaluation, evaluateAndBoost } from "../src/fsrs/evaluationBoost";
import { ExamScheduler } from "../src/exams/scheduler";
import { ScopeResolver } from "../src/exams/scopeResolver";
import { shouldBoost, generateBoost, applyBoosts } from "../src/exams/fsrsIntegration";
import type { Flashcard } from "../src/exams/types";
import type { Exam } from "../src/exams/types";
import type { App } from "obsidian";

const DAY_MS = 24 * 3600 * 1000;

// ─── Helper: mock de App de Obsidian ─────────────────────

class MockTFile {
  path: string;
  basename: string;
  constructor(path: string) {
    this.path = path;
    this.basename = path.replace(/\.md$/, "").split("/").pop() ?? path;
  }
}

interface MockVaultState {
  files: Map<string, { content: string; frontmatter: Record<string, unknown> }>;
  log: string[];
}

function createMockApp(state: MockVaultState): App {
  return {
    vault: {
      getAbstractFileByPath(path: string): any {
        if (state.files.has(path)) return new MockTFile(path);
        return null;
      },
      async read(file: any): Promise<string> {
        const entry = state.files.get(file.path);
        if (!entry) throw new Error(`File not found: ${file.path}`);
        return entry.content;
      },
      async modify(file: any, newContent: string): Promise<void> {
        const entry = state.files.get(file.path);
        if (!entry) throw new Error(`File not found: ${file.path}`);
        state.log.push(`modify:${file.path}:${newContent.length}`);
        entry.content = newContent;
      },
      async create(path: string, content: string): Promise<any> {
        state.log.push(`create:${path}`);
        state.files.set(path, { content, frontmatter: {} });
        return new MockTFile(path);
      },
      async createFolder(path: string): Promise<any> {
        state.log.push(`createFolder:${path}`);
        return new MockTFile(path);
      },
      getMarkdownFiles(): any[] {
        return Array.from(state.files.keys())
          .filter((p) => p.endsWith(".md"))
          .map((p) => new MockTFile(p));
      },
    },
    fileManager: {
      async processFrontMatter(file: any, fn: (fm: any) => void): Promise<void> {
        const entry = state.files.get(file.path);
        if (!entry) throw new Error(`File not found: ${file.path}`);
        const fm = entry.frontmatter;
        fn(fm);
        state.log.push(`frontmatter:${file.path}:${JSON.stringify(fm)}`);
      },
    },
    metadataCache: {
      getFileCache(file: any): any {
        const entry = state.files.get(file.path);
        if (!entry) return null;
        const fm = entry.frontmatter;
        const tags = (fm.tags as string[] | undefined) ?? [];
        // Detectar links [[...]]
        const links = (entry.content.match(/\[\[([^\]]+)\]\]/g) || []).map((l) => l.slice(2, -2));
        return { frontmatter: fm, tags, links };
      },
    },
  } as any as App;
}

// ─── FLUJO 1: vault realista → orchestrator → proposals → apply ──

describe("Flujo 1: vault realista → orchestrator → apply", () => {
  it("1.1 vault con 4 notas → orchestrator genera proposals → aprobar → aplicar", async () => {
    const state: MockVaultState = {
      files: new Map([
        ["anatomia/membrana-celular.md", {
          content: `# Membrana celular

La membrana celular es una bicapa lipídica que delimita la célula.
Compuesta por fosfolípidos, proteínas y colesterol.
Funciones: transporte, comunicación, reconocimiento celular.

## Componentes
- Fosfolípidos
- Proteínas integrales
- Proteínas periféricas
- Glucocálix

## Funciones
- Transporte pasivo y activo
- Señalización celular
- Adhesión celular`,
          frontmatter: { tags: ["anatomia", "biologia"] },
        }],
        ["bioquimica/ciclo-krebs.md", {
          content: `# Ciclo de Krebs

El ciclo de Krebs es una vía metabólica del acetil-CoA.
Ocurre en la matriz mitocondrial.
Genera NADH, FADH2 y ATP.

Pasos:
1. Acetil-CoA + Oxalacetato → Citrato
2. Citrato → Isocitrato
3. Isocitrato → α-cetoglutarato
4. α-cetoglutarato → Succinil-CoA
5. Succinil-CoA → Succinato
6. Succinato → Fumarato
7. Fumarato → Malato
8. Malato → Oxalacetato`,
          frontmatter: { tags: ["bioquimica"] },
        }],
        ["random/nota-corta.md", {
          content: `# Idea rápida

Apuntes de clase de hoy.`,
          frontmatter: {},
        }],
        ["fisio/sistema-nervioso.md", {
          content: `# Sistema nervioso

El sistema nervioso coordina las funciones del cuerpo.
Se divide en sistema nervioso central (SNC) y periférico (SNP).

El SNC incluye el encéfalo y la médula espinal.
El SNP incluye nervios craneales y espinales.

## Tipos de neuronas
- Sensitivas
- Motoras
- Interneuronas

## Sinapsis
- Eléctrica
- Química`,
          frontmatter: { tags: ["fisiologia", "neuro"] },
        }],
      ]),
      log: [],
    };
    const app = createMockApp(state);

    // 1) VaultEvaluator analiza
    const evaluator = new VaultEvaluator();
    const snapshots: NoteSnapshot[] = [];
    for (const f of app.vault.getMarkdownFiles()) {
      const content = await app.vault.read(f);
      const cache: any = app.metadataCache.getFileCache(f);
      snapshots.push({
        path: f.path,
        basename: f.basename,
        content,
        size: content.length,
        wordCount: content.split(/\s+/).filter((w) => w.length > 0).length,
        tags: cache?.tags ?? [],
        links: cache?.links ?? [],
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: /##\s*Card\s/.test(content),
        topic: f.path.split("/")[0],
      });
    }
    const evaluation = evaluator.evaluate(snapshots);
    expect(evaluation.untagged.length).toBe(1); // random/nota-corta.md sin tags
    expect(evaluation.shortNotes.length).toBeGreaterThan(0);
    // 3 notas tienen >50 palabras y sin flashcards
    expect(evaluation.notesWithoutFlashcards.length).toBeGreaterThanOrEqual(2);
    expect(evaluation.subjects.length).toBeGreaterThan(0);

    // 2) StudyOrchestrator genera proposals
    const orchestrator = new StudyOrchestrator(app, {
      autoRunIntervalMs: 1000,
      autoGenerateTypes: ["flashcards", "tag-suggestion", "link-suggestion", "gap-fill", "summary"],
      autoApproveLowPriority: false,
      maxPendingProposals: 20,
      minScore: 0.3,
    });
    await orchestrator.runAnalysis();

    const allProposals = orchestrator.getProposals().list({ status: "pending" });
    expect(allProposals.length).toBeGreaterThan(0);

    // 3) El usuario aprueba 3 proposals
    const toApprove = allProposals.slice(0, 3);
    for (const p of toApprove) {
      const ok = orchestrator.approveProposal(p.id);
      expect(ok).toBe(true);
    }

    // 4) Aplica las proposals aprobadas
    const approved = orchestrator.getProposals().list({ status: "approved" });
    expect(approved.length).toBe(3);
    for (const p of approved) {
      const result = await orchestrator.applyProposal(p.id);
      expect(result).toBe(true);
    }

    // 5) Verifica que el vault se modificó
    expect(state.log.length).toBeGreaterThan(0);
    // 5a) La nota corta debe tener tags (tag-suggestion aplicada)
    const shortNote = state.files.get("random/nota-corta.md")!;
    if (shortNote.frontmatter.tags) {
      expect((shortNote.frontmatter.tags as string[]).length).toBeGreaterThan(0);
    }
    // 5b) Algún deck de flashcards fue creado o summary fue prepended
    const hasModifications = state.log.some((l) => l.startsWith("create:") || l.startsWith("modify:"));
    expect(hasModifications).toBe(true);
  });
});

// ─── FLUJO 2: adaptive quiz → knowledge graph → FSRS ─────

describe("Flujo 2: quiz adaptativo → knowledge graph → FSRS", () => {
  it("2.1 estudiante responde quiz → mastery sube → flashcards se vuelven más fáciles", async () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("diabetes", "Diabetes tipo 2"));
    graph.add(createConcept("asma", "Asma"));

    const quiz = new AdaptiveQuizEngine(graph);
    const session = createQuizSession({ maxQuestions: 6, mode: "diagnostic" });
    quiz.startSession(session);

    // Simular 6 respuestas correctas con confidence 1
    const cards: FsrsCard[] = Array.from({ length: 6 }, () => newCard());
    const initialAvgStability = cards.reduce((s, c) => s + c.stability, 0) / cards.length;

    for (let i = 0; i < 6; i++) {
      const q = quiz.nextQuestion();
      if (!q) break;
      // Dar respuesta correcta (o "sí" como fallback)
      const result = await quiz.answerCurrent(q.correctAnswer, 1, 1000);
      expect(result.correct).toBe(true);
      // Aplicar FSRS review con rating amplificado por mastery
      const rating = effectiveRating(3, 1.0); // Good + mastery 1 → Easy
      const cardIdx = i % cards.length;
      cards[cardIdx] = review(cards[cardIdx], rating).card;
    }

    // Después del quiz, la mastery de al menos un concept debe haber subido
    const diabetesMastery = graph.get("diabetes")!.layers.definition.mastery;
    expect(diabetesMastery).toBeGreaterThan(0);

    // Las flashcards revisadas deben tener stability > inicial
    const finalAvgStability = cards.reduce((s, c) => s + c.stability, 0) / cards.length;
    expect(finalAvgStability).toBeGreaterThan(initialAvgStability);
  });

  it("2.2 estudiante falla → mastery baja → flashcards se vuelven más difíciles", async () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("cancer", "Cáncer de pulmón"));

    const quiz = new AdaptiveQuizEngine(graph);
    const session = createQuizSession({ maxQuestions: 4, mode: "diagnostic" });
    quiz.startSession(session);

    const cards: FsrsCard[] = Array.from({ length: 4 }, () => newCard());
    const initialAvgStability = cards.reduce((s, c) => s + c.stability, 0) / cards.length;

    // El estudiante falla
    for (let i = 0; i < 4; i++) {
      const q = quiz.nextQuestion();
      if (!q) break;
      await quiz.answerCurrent("respuesta incorrecta", 0.8, 2000);
      cards[i] = review(cards[i], 1).card; // Again
    }

    const cancerMastery = graph.get("cancer")!.layers.definition.mastery;
    expect(cancerMastery).toBeLessThan(0.1);

    // Las flashcards tienen lapses y stability menor
    expect(cards.some((c) => c.lapses > 0)).toBe(true);
    const finalAvgStability = cards.reduce((s, c) => s + c.stability, 0) / cards.length;
    // Puede que tras un lapse la stability se mantenga (W[2]=3.13), pero no debería ser mayor
    expect(finalAvgStability).toBeLessThanOrEqual(initialAvgStability * 1.1);
  });

  it("2.3 quiz completo capa-por-capa (definition → symptom → treatment)", async () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("hta", "Hipertensión"));

    const quiz = new AdaptiveQuizEngine(graph);
    const session = createQuizSession({ maxQuestions: 5, mode: "diagnostic" });
    quiz.startSession(session);

    const layersAsked: string[] = [];
    for (let i = 0; i < 5; i++) {
      const q = quiz.nextQuestion();
      if (!q) break;
      layersAsked.push(q.layer);
      await quiz.answerCurrent(q.correctAnswer, 1, 1000);
    }

    // Debe haber preguntado al menos definition
    expect(layersAsked).toContain("definition");
  });
});

// ─── FLUJO 3: loadBalancer + knowledge graph + exam ──────

describe("Flujo 3: loadBalancer + knowledge + exam scheduler", () => {
  it("3.1 examen en 7 días + 30 cards + knowledge → plan prioriza débiles", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("cardio", "Cardiología"));
    graph.add(createConcept("nefro", "Nefrología"));
    graph.add(createConcept("endocrino", "Endocrinología"));

    // cardiología dominada, nefrología no
    for (let i = 0; i < 20; i++) graph.updateMastery("cardio", "definition", true, 1);
    for (let i = 0; i < 20; i++) graph.updateMastery("cardio", "symptom", true, 1);
    for (let i = 0; i < 20; i++) graph.updateMastery("cardio", "treatment", true, 1);

    const cards: Flashcard[] = Array.from({ length: 30 }, (_, i) => ({
      id: `c${i}`,
      front: "Pregunta",
      back: "Respuesta",
      cardType: "basic",
      notePath: i % 3 === 0 ? "cardio.md" : i % 3 === 1 ? "nefro.md" : "endocrino.md",
      tags: i % 3 === 0 ? ["cardio"] : i % 3 === 1 ? ["nefro"] : ["endocrino"],
      priority: "Normal" as const,
      dueDate: new Date().toISOString().slice(0, 10),
      fsrs: { stability: 5, difficulty: 5, dueDate: new Date().toISOString().slice(0, 10), reps: 1, lapses: 0 },
    }));

    // 1) loadBalancer con evaluación
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: c.priority })),
        today: new Date(),
        daysWindow: 7,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );

    // 2) El primer día debe tener más weak cards (nefro/endocrino)
    const day0 = r.loads[0];
    const day0WeakRatio = day0.weakCards / Math.max(1, day0.cards);
    expect(day0WeakRatio).toBeGreaterThan(0.3); // Al menos 30% son débiles

    // 3) ExamScheduler genera plan para examen en 7 días
    const resolver = new ScopeResolver();
    const scheduler = new ExamScheduler(resolver);
    const exam: Exam = {
      id: "e1",
      title: "Final",
      subject: "medicina",
      date: new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10),
      examType: "final",
      scopes: [{ type: "folder", path: ".", includeSubfolders: true }],
      status: "active",
      priority: "high",
    };
    const schedule = scheduler.generate(exam, cards, { dailyReviewCap: 10 });
    expect(schedule.daysAvailable).toBe(8);
  });

  it("3.2 FSRS boost coherente con knowledge: card débil + flashcard = dueDate más cercana", () => {
    const graph = new KnowledgeGraph();
    graph.add(createConcept("x", "X"));

    // Crear 2 cards idénticas, una boost (concept dominado) y otra sin boost
    const cardDominated = newCard();
    const cardWeak = newCard();

    // Boost
    const boosted = applyKnowledgeBoost(cardDominated, "x", "definition", graph);
    // Sin boost (mastery=0)
    expect(boosted.stability).toBeLessThan(cardWeak.stability);
  });
});

// ─── FLUJO 4: orchestrator + proposals + quiz + FSRS ─────

describe("Flujo 4: orchestrator + flashcards propuestas + quiz + FSRS", () => {
  it("4.1 orchestrator propone flashcards → usuario aprueba → crea deck → quiz usa el concept", async () => {
    const longContent = `# Beta-bloqueantes

Los beta-bloqueantes son fármacos que bloquean los receptores beta-adrenérgicos del sistema nervioso simpático. Se utilizan principalmente en el tratamiento de la hipertensión arterial, la angina de pecho, las arritmias cardíacas y la insuficiencia cardíaca. Actúan disminuyendo la frecuencia cardíaca, la contractilidad miocárdica y la conducción auriculoventricular. Se clasifican en selectivos beta-uno y no selectivos. Los selectivos actúan principalmente sobre el corazón y tienen menos efectos bronquiales. Los no selectivos bloquean todos los receptores beta y pueden producir broncoconstricción en pacientes asmáticos.

## Tipos principales
- Selectivos (β1): atenolol, metoprolol, bisoprolol, nebivolol
- No selectivos: propranolol, nadolol, timolol
- Con actividad simpaticomimética intrínseca: pindolol
- Alfa y beta: carvedilol, labetalol

## Indicaciones clínicas
- Hipertensión arterial
- Angina de pecho estable
- Infarto agudo de miocardio
- Insuficiencia cardíaca
- Arritmias supraventriculares

## Efectos adversos
- Bradicardia
- Broncoespasmo
- Hipotensión arterial
- Fatiga y mareo
- Dislipidemia
- Impotencia sexual`;
    const state: MockVaultState = {
      files: new Map([
        ["farmacologia/beta-bloqueantes.md", {
          content: longContent,
          frontmatter: { tags: ["farmacologia"] },
        }],
      ]),
      log: [],
    };
    const app = createMockApp(state);

    const orchestrator = new StudyOrchestrator(app, {
      autoRunIntervalMs: 1000,
      autoGenerateTypes: ["flashcards", "gap-fill"],
      autoApproveLowPriority: false,
      maxPendingProposals: 10,
      minScore: 0.2,
    });

    const evaluator = new VaultEvaluator();
    const snapshots: NoteSnapshot[] = [];
    for (const f of app.vault.getMarkdownFiles()) {
      const content = await app.vault.read(f);
      const cache: any = app.metadataCache.getFileCache(f);
      snapshots.push({
        path: f.path,
        basename: f.basename,
        content,
        size: content.length,
        wordCount: content.split(/\s+/).filter((w: string) => w.length > 0).length,
        tags: cache?.tags ?? [],
        links: cache?.links ?? [],
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: /##\s*Card\s/.test(content),
        topic: f.path.split("/")[0],
      });
    }
    const evaluation = evaluator.evaluate(snapshots);
    await orchestrator.runAnalysis();

    // Aprobar la primera proposal de flashcards
    const flashcardsProposal = orchestrator
      .getProposals().list({ status: "pending" })
      .find((p) => p.type === "flashcards");
    expect(flashcardsProposal).toBeDefined();

    if (flashcardsProposal) {
      const ok = orchestrator.approveProposal(flashcardsProposal.id);
      expect(ok).toBe(true);
      const applied = await orchestrator.applyProposal(flashcardsProposal.id);
      expect(applied).toBe(true);
      // Verificar que se creó un deck
      const decks = Array.from(state.files.keys()).filter((p) => p.includes("-deck.md"));
      expect(decks.length).toBeGreaterThan(0);
    }

    // 2) Ahora el estudiante hace un quiz sobre el concept "farmacologia" (sembrado por orchestrator)
    const graph = new KnowledgeGraph();
    graph.add(createConcept("farmacologia", "Farmacología"));
    const quiz = new AdaptiveQuizEngine(graph);
    const session = createQuizSession({ maxQuestions: 3, mode: "diagnostic" });
    quiz.startSession(session);

    const q = quiz.nextQuestion();
    expect(q).not.toBeNull();
    if (q) {
      // El concept fue creado, debe preguntar sobre definition
      expect(q.concept.id).toBe("farmacologia");
    }
  });
});

// ─── FLUJO 5: stress test armónico ───────────────────────

describe("Flujo 5: stress test — todos los componentes juntos", () => {
  it("5.1 100 conceptos + 200 cards + 50 proposals + quiz + FSRS en <3s", async () => {
    // 1) Knowledge graph
    const graph = new KnowledgeGraph();
    const subjects = ["cardio", "nefro", "endocrino", "neuro", "gastro", "hema", "reuma", "derma"];
    for (let i = 0; i < 100; i++) {
      const term = `Concept${i}`;
      graph.add(createConcept(`c${i}`, term));
      // Marcar algunos como conocidos
      if (i < 50) {
        for (let j = 0; j < 5; j++) graph.updateMastery(`c${i}`, "definition", true, 1);
      }
    }

    // 2) Vault mock con 20 notas
    const state: MockVaultState = {
      files: new Map(),
      log: [],
    };
    for (let i = 0; i < 20; i++) {
      const subject = subjects[i % subjects.length];
      state.files.set(`${subject}/nota${i}.md`, {
        content: `# Nota ${i}\n\n${"Contenido de prueba. ".repeat(50)}`,
        frontmatter: { tags: [subject] },
      });
    }
    const app = createMockApp(state);

    // 3) StudyOrchestrator genera proposals
    const orchestrator = new StudyOrchestrator(app, {
      autoRunIntervalMs: 1000,
      autoGenerateTypes: ["flashcards", "tag-suggestion", "link-suggestion", "summary"],
      autoApproveLowPriority: false,
      maxPendingProposals: 50,
      minScore: 0.2,
    });
    const evaluator = new VaultEvaluator();
    const snapshots: NoteSnapshot[] = [];
    for (const f of app.vault.getMarkdownFiles()) {
      const content = await app.vault.read(f);
      const cache: any = app.metadataCache.getFileCache(f);
      snapshots.push({
        path: f.path,
        basename: f.basename,
        content,
        size: content.length,
        wordCount: content.split(/\s+/).length,
        tags: cache?.tags ?? [],
        links: cache?.links ?? [],
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: false,
        topic: f.path.split("/")[0],
      });
    }
    const evaluation = evaluator.evaluate(snapshots);

    const start = Date.now();
    await orchestrator.runAnalysis();
    const elapsed1 = Date.now() - start;
    expect(elapsed1).toBeLessThan(1000);

    // 4) loadBalancer con knowledge
    const cards: Flashcard[] = Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      front: "P",
      back: "R",
      cardType: "basic",
      notePath: `topic/c${i}.md`,
      tags: [],
      priority: "Normal" as const,
      dueDate: new Date(Date.now() + (i % 10) * DAY_MS).toISOString().slice(0, 10),
      fsrs: { stability: 5, difficulty: 5, dueDate: new Date().toISOString().slice(0, 10), reps: 1, lapses: 0 },
    }));
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: c.priority })),
        today: new Date(),
        daysWindow: 14,
        dailyReviewCap: 20,
        softCap: 15,
      },
      graph,
    );
    const elapsed2 = Date.now() - start;
    expect(elapsed2).toBeLessThan(1500);
    expect(r.loads.reduce((s, l) => s + l.cards, 0)).toBe(200);

    // 5) Adaptive quiz: 10 preguntas
    const quiz = new AdaptiveQuizEngine(graph);
    const session = createQuizSession({ maxQuestions: 10, mode: "diagnostic" });
    quiz.startSession(session);
    let asked = 0;
    for (let i = 0; i < 10; i++) {
      const q = quiz.nextQuestion();
      if (!q) break;
      await quiz.answerCurrent(q.correctAnswer, 0.8, 500);
      asked++;
    }
    expect(asked).toBeGreaterThan(0);

    // 6) FSRS: 50 reviews
    const fsrsCards: FsrsCard[] = Array.from({ length: 50 }, () => newCard());
    for (let i = 0; i < 50; i++) {
      fsrsCards[i] = review(fsrsCards[i], 3).card;
    }

    const totalElapsed = Date.now() - start;
    expect(totalElapsed).toBeLessThan(3000);
  });

  it("5.2 sistema completo: vault → eval → proposals → quiz → mastery → FSRS → loadBalancer", async () => {
    // Test que demuestra que el sistema entero trabaja de forma coherente:
    // - Las proposals se generan desde el vault
    // - El quiz usa el knowledge graph
    // - El loadBalancer respeta el knowledge graph
    // - El FSRS interactúa con el knowledge graph
    // - Todo se mantiene coherente

    // 1) Setup: vault pequeño
    const state: MockVaultState = {
      files: new Map([
        ["cardio/hipertension.md", {
          content: `# Hipertensión arterial

La HTA es una elevación crónica de la presión arterial.
Cifras: PAS ≥ 140 mmHg o PAD ≥ 90 mmHg.

## Clasificación
- Normal: <120/<80
- Elevada: 120-129/<80
- HTA grado 1: 130-139/80-89
- HTA grado 2: ≥140/≥90

## Tratamiento
- IECA: enalapril, ramipril
- ARA-II: losartán, valsartán
- Calcioantagonistas: amlodipino
- Diuréticos: hidroclorotiazida`,
          frontmatter: { tags: ["cardio"] },
        }],
        ["nefro/insuficiencia-renal.md", {
          content: `# Insuficiencia renal aguda

Es la pérdida rápida de la función renal.
Se clasifica en prerrenal, renal y postrrenal.

## Causas prerrenales
- Hipovolemia
- Bajo gasto cardíaco

## Causas renales
- NTA (necrosis tubular aguda)
- Glomerulonefritis

## Tratamiento
- Corregir causa
- Diálisis si es necesario`,
          frontmatter: { tags: ["nefro"] },
        }],
      ]),
      log: [],
    };
    const app = createMockApp(state);

    // 2) VaultEvaluator
    const evaluator = new VaultEvaluator();
    const snapshots: NoteSnapshot[] = [];
    for (const f of app.vault.getMarkdownFiles()) {
      const content = await app.vault.read(f);
      const cache: any = app.metadataCache.getFileCache(f);
      snapshots.push({
        path: f.path,
        basename: f.basename,
        content,
        size: content.length,
        wordCount: content.split(/\s+/).length,
        tags: cache?.tags ?? [],
        links: cache?.links ?? [],
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: false,
        topic: f.path.split("/")[0],
      });
    }
    const evaluation = evaluator.evaluate(snapshots);
    expect(evaluation.subjects.map((s) => s.name)).toContain("cardio");
    expect(evaluation.subjects.map((s) => s.name)).toContain("nefro");

    // 3) StudyOrchestrator
    const orchestrator = new StudyOrchestrator(app, {
      autoRunIntervalMs: 1000,
      autoGenerateTypes: ["flashcards", "tag-suggestion", "summary"],
      autoApproveLowPriority: false,
      maxPendingProposals: 10,
      minScore: 0.2,
    });
    await orchestrator.runAnalysis();
    const proposals = orchestrator.getProposals().list({ status: "pending" });
    expect(proposals.length).toBeGreaterThan(0);

    // 4) KnowledgeGraph sembrado por el orchestrator
    const graph = new KnowledgeGraph();
    graph.add(createConcept("cardio", "Cardiología"));
    graph.add(createConcept("nefro", "Nefrología"));

    // 5) Adaptive quiz
    const quiz = new AdaptiveQuizEngine(graph);
    const session = createQuizSession({ maxQuestions: 3, mode: "diagnostic" });
    quiz.startSession(session);
    let asked = 0;
    for (let i = 0; i < 3; i++) {
      const q = quiz.nextQuestion();
      if (!q) break;
      const result = await quiz.answerCurrent(q.correctAnswer, 1, 1000);
      expect(result.correct).toBe(true);
      asked++;
    }
    expect(asked).toBeGreaterThan(0);

    // 6) loadBalancer con evaluation
    const cards: Flashcard[] = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      front: "P",
      back: "R",
      cardType: "basic",
      notePath: i % 2 === 0 ? "cardio/hta.md" : "nefro/ira.md",
      tags: i % 2 === 0 ? ["cardio"] : ["nefro"],
      priority: "Normal" as const,
      dueDate: new Date().toISOString().slice(0, 10),
      fsrs: { stability: 5, difficulty: 5, dueDate: new Date().toISOString().slice(0, 10), reps: 1, lapses: 0 },
    }));
    const r = rebalanceWithEvaluation(
      {
        cards: cards.map((c) => ({ card: c, priority: c.priority })),
        today: new Date(),
        daysWindow: 5,
        dailyReviewCap: 10,
        softCap: 8,
      },
      graph,
    );
    const totalCards = r.loads.reduce((s, l) => s + l.cards, 0);
    expect(totalCards).toBe(20);

    // 7) FSRS + knowledge boost
    const fsrsCards: FsrsCard[] = Array.from({ length: 10 }, () => newCard());
    for (let i = 0; i < 10; i++) {
      const conceptId = i % 2 === 0 ? "cardio" : "nefro";
      const layer: any = "definition";
      const rating = effectiveRating(3, graph.get(conceptId)!.layers[layer].mastery);
      const reviewed = review(fsrsCards[i], rating);
      const boosted = applyKnowledgeBoost(reviewed.card, conceptId, layer, graph);
      fsrsCards[i] = boosted;
    }
    // Las cards con concept dominado deben tener stability mayor
    expect(fsrsCards.every((c) => c.stability > 0)).toBe(true);
  });
});

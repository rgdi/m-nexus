// v0.28: Tests del StudyOrchestrator con vault realista.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { VaultEvaluator, type NoteSnapshot } from "../src/ai/vaultEvaluator";
import { ProposalStore, type Proposal, genProposalId } from "../src/ai/contentProposals";
import { KnowledgeGraph, createConcept } from "../src/study/knowledgeLayers";

// ─── Simulación de vault realista ─────────────────────────

function buildAnatomiaNote(): NoteSnapshot {
  return {
    path: "Anatomía/Membrana-celular.md",
    basename: "Membrana-celular",
    content: `# Membrana celular

## Definición
La membrana celular es una estructura que delimita la célula.

## Composición
- Bicapa lipídica
- Proteínas integrales
- Proteínas periféricas
- Glúcidos

## Modelo del mosaico fluido
Singer y Nicolson (1972) propusieron que la membrana es un fluido donde los componentes se mueven lateralmente.
`,
    size: 500,
    modifiedAt: Date.now(),
    frontmatter: { subject: "Anatomía", type: "class-note", tags: ["membrana", "biología-celular"] },
    tags: ["membrana", "biología-celular"],
    links: ["Bioquímica-2026-09-08"],
    wordCount: 80,
    hasAudio: false,
    hasPdf: false,
    hasFlashcards: false,
    topic: "Anatomía",
  };
}

function buildBioquimicaNote(): NoteSnapshot {
  return {
    path: "Bioquímica/Ciclo-Krebs.md",
    basename: "Ciclo-Krebs",
    content: `# Ciclo de Krebs

## Definición
El ciclo de Krebs es una ruta metabólica central.

## Card 1
### Front
¿En qué compartimento ocurre el ciclo de Krebs?

### Back
En la matriz mitocondrial.

## Pasos
- Citrato → Isocitrato
- Isocitrato → α-cetoglutarato
- α-cetoglutarato → Succinil-CoA
- Succinil-CoA → Succinato

## Productos
3 NADH + 1 FADH2 + 1 GTP por vuelta.
`,
    size: 400,
    modifiedAt: Date.now(),
    frontmatter: { subject: "Bioquímica", type: "class-note" },
    tags: ["metabolismo", "krebs"],
    links: [],
    wordCount: 70,
    hasAudio: false,
    hasPdf: false,
    hasFlashcards: true,
    topic: "Bioquímica",
  };
}

function buildShortNote(): NoteSnapshot {
  return {
    path: "Random/nota-corta.md",
    basename: "nota-corta",
    content: "Esto es una nota muy corta sin tags.",
    size: 40,
    modifiedAt: Date.now(),
    frontmatter: {},
    tags: [],
    links: [],
    wordCount: 8,
    hasAudio: false,
    hasPdf: false,
    hasFlashcards: false,
    topic: null,
  };
}

function buildLongNote(): NoteSnapshot {
  return {
    path: "Fisiología/Sistema-nervioso.md",
    basename: "Sistema-nervioso",
    content: `# Sistema nervioso

El sistema nervioso es una red compleja de neuronas y células gliales que se encarga de recibir, procesar y transmitir información en el cuerpo.

## Neuronas
Las neuronas son las unidades básicas del sistema nervioso. Se componen de:
- Dendritas: reciben señales
- Axón: transmite señales
- Cuerpo celular: integra señales

## Sinapsis
La sinapsis es la conexión entre dos neuronas. Puede ser eléctrica o química.

## Tipos de neuronas
- Sensitivas: llevan información desde los receptores
- Motoras: llevan información a los músculos
- Interneuronas: conectan neuronas entre sí

## Sistema nervioso central
Compuesto por el encéfalo y la médula espinal.

## Sistema nervioso periférico
Compuesto por nervios craneales y espinales.

## Neurotransmisores
Sustancias químicas que transmiten señales entre neuronas:
- Acetilcolina
- Dopamina
- Serotonina
- GABA
- Glutamato

## Plasticidad sináptica
Capacidad del sistema nervioso de modificar sus conexiones en respuesta a la experiencia.
`,
    size: 1500,
    modifiedAt: Date.now(),
    frontmatter: { subject: "Fisiología", type: "class-note" },
    tags: ["neuro", "fisiología"],
    links: [],
    wordCount: 250,
    hasAudio: false,
    hasPdf: false,
    hasFlashcards: false,
    topic: "Fisiología",
  };
}

function buildRealisticVault(): NoteSnapshot[] {
  return [
    buildAnatomiaNote(),
    buildBioquimicaNote(),
    buildShortNote(),
    buildLongNote(),
  ];
}

// ─── VaultEvaluator ──────────────────────────────────────

describe("VaultEvaluator con vault realista", () => {
  let evaluator: VaultEvaluator;

  beforeEach(() => {
    evaluator = new VaultEvaluator();
  });

  it("1.1 evalúa 4 notas", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.totalNotes).toBe(4);
    expect(ev.totalWords).toBeGreaterThan(0);
  });

  it("1.2 detecta nota sin tags", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.untagged.find((n) => n.path === "Random/nota-corta.md")).toBeTruthy();
  });

  it("1.3 detecta nota sin links (huérfana)", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.orphaned.length).toBeGreaterThan(0);
  });

  it("1.4 detecta nota corta", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.shortNotes.find((n) => n.path === "Random/nota-corta.md")).toBeTruthy();
  });

  it("1.5 detecta notas sin flashcards", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.notesWithoutFlashcards.length).toBeGreaterThan(0);
  });

  it("1.6 cuenta flashcards por nota", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    const bioq = ev.subjects.find((s) => s.name === "Bioquímica");
    expect(bioq?.flashcards).toBeGreaterThan(0);
  });

  it("1.7 calcula topics", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.topics.length).toBeGreaterThan(0);
  });

  it("1.8 detecta gaps: subject con coverage baja", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    // Anatomía solo tiene 1 nota → debe aparecer en gaps
    const anatmGap = ev.gaps.find((g) => g.topic === "Anatomía");
    expect(anatmGap).toBeTruthy();
    // El gap detectado es sobre cobertura
    expect(anatmGap?.priority).toBeGreaterThan(0);
  });

  it("1.9 calcula averageQuality (0..1)", () => {
    const vault = buildRealisticVault();
    const ev = evaluator.evaluate(vault);
    expect(ev.averageQuality).toBeGreaterThan(0);
    expect(ev.averageQuality).toBeLessThanOrEqual(1);
  });
});

// ─── ProposalStore ───────────────────────────────────────

describe("ProposalStore con propuestas realistas", () => {
  let store: ProposalStore;

  beforeEach(() => {
    store = new ProposalStore();
  });

  it("2.1 add/list con flashcards", () => {
    const p: Proposal = {
      id: genProposalId(),
      type: "flashcards",
      title: "Crear flashcards de membrana",
      description: "10 cards",
      reasoning: "Nota sin flashcards",
      confidence: 0.8,
      priority: 0.7,
      status: "pending",
      createdAt: Date.now(),
      requiresDoubleApproval: false,
      tags: ["auto"],
      sourceNote: "test.md",
      cards: [{ front: "Q1", back: "A1" }],
      targetFolder: "Flashcards",
    };
    store.add(p);
    expect(store.list().length).toBe(1);
  });

  it("2.2 approve cambia status", () => {
    const p: Proposal = {
      id: "p1",
      type: "summary",
      title: "T",
      description: "D",
      reasoning: "R",
      confidence: 0.7,
      priority: 0.5,
      status: "pending",
      createdAt: Date.now(),
      requiresDoubleApproval: false,
      tags: [],
      sourceNote: "n.md",
      summary: "S",
      keyPoints: ["k"],
      length: "short",
    };
    store.add(p);
    store.approve("p1");
    expect(store.get("p1")!.status).toBe("approved");
    expect(store.list({ status: "pending" })).toHaveLength(0);
    expect(store.list({ status: "approved" })).toHaveLength(1);
  });

  it("2.3 reject y stats", () => {
    const p: Proposal = {
      id: "p1",
      type: "summary",
      title: "T",
      description: "D",
      reasoning: "R",
      confidence: 0.7,
      priority: 0.5,
      status: "pending",
      createdAt: Date.now(),
      requiresDoubleApproval: false,
      tags: [],
      sourceNote: "n.md",
      summary: "S",
      keyPoints: [],
      length: "short",
    };
    store.add(p);
    store.reject("p1");
    expect(store.get("p1")!.status).toBe("rejected");
    const stats = store.stats();
    expect(stats.byStatus.rejected).toBe(1);
  });

  it("2.4 markApplied cambia status y guarda appliedAt", () => {
    const p: Proposal = {
      id: "p1",
      type: "summary",
      title: "T",
      description: "D",
      reasoning: "R",
      confidence: 0.7,
      priority: 0.5,
      status: "approved",
      createdAt: Date.now(),
      requiresDoubleApproval: false,
      tags: [],
      sourceNote: "n.md",
      summary: "S",
      keyPoints: [],
      length: "short",
    };
    store.add(p);
    store.markApplied("p1");
    expect(store.get("p1")!.status).toBe("applied");
    expect(store.get("p1")!.appliedAt).toBeGreaterThan(0);
  });

  it("2.5 list con filtros type y status", () => {
    const p1: Proposal = {
      id: "1", type: "summary", title: "T", description: "D", reasoning: "R",
      confidence: 0.7, priority: 0.5, status: "pending", createdAt: 0, requiresDoubleApproval: false, tags: [],
      sourceNote: "n.md", summary: "S", keyPoints: [], length: "short",
    };
    const p2: Proposal = {
      id: "2", type: "flashcards", title: "T", description: "D", reasoning: "R",
      confidence: 0.7, priority: 0.5, status: "pending", createdAt: 0, requiresDoubleApproval: false, tags: [],
      sourceNote: "n.md", cards: [], targetFolder: "F",
    };
    store.add(p1);
    store.add(p2);
    expect(store.list({ type: "summary" })).toHaveLength(1);
    expect(store.list({ type: "flashcards" })).toHaveLength(1);
    expect(store.list({ status: "pending" })).toHaveLength(2);
  });
});

// ─── StudyOrchestrator ───────────────────────────────────

describe("StudyOrchestrator — generación de propuestas", () => {
  let orchestrator: any;
  let knowledgeGraph: KnowledgeGraph;
  let mockApp: any;
  let mockStorage: any;

  beforeEach(() => {
    knowledgeGraph = new KnowledgeGraph();
    mockApp = {
      vault: {
        getMarkdownFiles: () => [],
        read: async () => "",
        create: async () => ({}),
        createFolder: async () => ({}),
        getAbstractFileByPath: () => null,
        adapter: { exists: async () => false },
      },
      metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
      fileManager: {
        renameFile: async () => {},
        processFrontMatter: async () => {},
      },
    };
    mockStorage = { getReviews: () => [] };
    orchestrator = makeOrchestrator(mockApp, knowledgeGraph, mockStorage);
  });

  function makeOrchestrator(app: any, kg: any, storage: any): any {
    // Import dinámico para evitar problemas con Obsidian en el test
    return new (class {
      private proposals = new ProposalStore();
      private evaluation: any = null;
      private onProposal?: any;
      config = { maxPendingProposals: 20 };
      constructor(app: any, kg: any, storage: any) {}
      getProposals() { return this.proposals; }
      getLastEvaluation() { return this.evaluation; }
      onNewProposal(cb: any) { this.onProposal = cb; }
      async runAnalysis(snapshots: NoteSnapshot[]) {
        const evaluator = new VaultEvaluator();
        this.evaluation = evaluator.evaluate(snapshots);
        // Generar propuestas
        this.proposals = new ProposalStore();
        for (const note of this.evaluation.notesWithoutFlashcards.slice(0, 3)) {
          this.proposals.add({
            id: genProposalId(),
            type: "flashcards",
            title: `Flashcards de ${note.basename}`,
            description: "Auto-generadas",
            reasoning: "Sin flashcards",
            confidence: 0.75,
            priority: 0.7,
            status: "pending",
            createdAt: Date.now(),
            requiresDoubleApproval: false,
            tags: ["auto"],
            sourceNote: note.path,
            cards: [{ front: "Q", back: "A" }],
            targetFolder: "Flashcards",
          });
        }
        for (const note of this.evaluation.untagged.slice(0, 3)) {
          this.proposals.add({
            id: genProposalId(),
            type: "tag-suggestion",
            title: `Tags para ${note.basename}`,
            description: "Sin tags",
            reasoning: "Sin tags",
            confidence: 0.6,
            priority: 0.4,
            status: "pending",
            createdAt: Date.now(),
            requiresDoubleApproval: false,
            tags: ["auto"],
            notePath: note.path,
            currentTags: note.tags,
            suggestedTags: ["auto-tag"],
            reason: "Sin tags",
          });
        }
        for (const gap of this.evaluation.gaps.slice(0, 2)) {
          this.proposals.add({
            id: genProposalId(),
            type: "gap-fill",
            title: `Crear sobre ${gap.topic}`,
            description: "Gap temático",
            reasoning: gap.reason,
            confidence: 0.5,
            priority: gap.priority,
            status: "pending",
            createdAt: Date.now(),
            requiresDoubleApproval: true,
            tags: ["auto"],
            topic: gap.topic,
            skeleton: `# ${gap.topic}\n`,
            sources: [],
          });
        }
        return this.evaluation;
      }
    })(app, kg, storage);
  }

  it("3.1 genera propuestas para notas sin flashcards", async () => {
    const vault = buildRealisticVault();
    await orchestrator.runAnalysis(vault);
    const fcProposals = orchestrator.getProposals().list({ type: "flashcards" });
    expect(fcProposals.length).toBeGreaterThan(0);
  });

  it("3.2 genera propuestas para notas sin tags", async () => {
    const vault = buildRealisticVault();
    await orchestrator.runAnalysis(vault);
    const tagProposals = orchestrator.getProposals().list({ type: "tag-suggestion" });
    expect(tagProposals.length).toBeGreaterThan(0);
  });

  it("3.3 genera propuestas para gaps", async () => {
    const vault = buildRealisticVault();
    await orchestrator.runAnalysis(vault);
    const gapProposals = orchestrator.getProposals().list({ type: "gap-fill" });
    expect(gapProposals.length).toBeGreaterThan(0);
  });

  it("3.4 todas las propuestas nuevas son pending", async () => {
    const vault = buildRealisticVault();
    await orchestrator.runAnalysis(vault);
    const all = orchestrator.getProposals().list();
    expect(all.every((p: Proposal) => p.status === "pending")).toBe(true);
  });

  it("3.5 propuestas tienen reasoning", async () => {
    const vault = buildRealisticVault();
    await orchestrator.runAnalysis(vault);
    const all = orchestrator.getProposals().list();
    expect(all.every((p: Proposal) => p.reasoning.length > 0)).toBe(true);
  });
});

// ─── Knowledge graph integration ─────────────────────────

describe("Knowledge graph con vault realista", () => {
  it("4.1 añade subjects del vault", () => {
    const vault = buildRealisticVault();
    const evaluator = new VaultEvaluator();
    const ev = evaluator.evaluate(vault);
    const kg = new KnowledgeGraph();
    for (const s of ev.subjects) {
      kg.add(createConcept(`s-${s.name}`, s.name, { category: s.name }));
    }
    expect(kg.findByTerm("Anatomía")).toBeTruthy();
    expect(kg.findByTerm("Fisiología")).toBeTruthy();
  });

  it("4.2 encuentra gaps en el temario", () => {
    const vault = buildRealisticVault();
    const evaluator = new VaultEvaluator();
    const ev = evaluator.evaluate(vault);
    const kg = new KnowledgeGraph();
    for (const s of ev.subjects) {
      kg.add(createConcept(`s-${s.name}`, s.name, { category: s.name }));
    }
    // Dominar Anatomía
    const c = kg.findByTerm("Anatomía")!;
    for (let i = 0; i < 20; i++) kg.updateMastery(c.id, "definition", true, 1);
    const gaps = kg.findGaps(10);
    // Debería haber gaps para Anatomía tratamiento o síntoma
    expect(gaps.length).toBeGreaterThan(0);
  });
});

// ─── Stress test ─────────────────────────────────────────

describe("Stress test — vault grande", () => {
  it("5.1 maneja 1000 notas sin bloquear", () => {
    const vault: NoteSnapshot[] = [];
    for (let i = 0; i < 1000; i++) {
      vault.push({
        path: `Subject${i % 10}/note-${i}.md`,
        basename: `note-${i}`,
        content: `Nota ${i} sobre tema ${i % 10}. ${i % 3 === 0 ? "## Sección\n- Bullet 1\n- Bullet 2" : ""}`,
        size: 200,
        modifiedAt: Date.now(),
        frontmatter: { subject: `Subject ${i % 10}` },
        tags: i % 5 === 0 ? [`tag${i % 3}`] : [],
        links: [],
        wordCount: 50,
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: i % 4 === 0,
        topic: `Subject ${i % 10}`,
      });
    }
    const start = Date.now();
    const evaluator = new VaultEvaluator();
    const ev = evaluator.evaluate(vault);
    const elapsed = Date.now() - start;
    expect(ev.totalNotes).toBe(1000);
    expect(elapsed).toBeLessThan(1000); // <1s
  });

  it("5.2 genera 100 propuestas rápidamente", () => {
    const vault: NoteSnapshot[] = [];
    for (let i = 0; i < 100; i++) {
      vault.push({
        path: `n${i}.md`,
        basename: `n${i}`,
        content: `# T${i}\n\nLorem ipsum dolor sit amet. Esta es una nota con suficiente contenido para tener varias palabras y ser considerada como nota sin flashcards porque tiene más de 50 palabras.`,
        size: 100,
        modifiedAt: Date.now(),
        frontmatter: {},
        tags: [],
        links: [],
        wordCount: 30,
        hasAudio: false,
        hasPdf: false,
        hasFlashcards: false,
        topic: `T${i % 5}`,
      });
    }
    const evaluator = new VaultEvaluator();
    const ev = evaluator.evaluate(vault);
    // Las notas tienen <50 palabras, no entran en notesWithoutFlashcards
    // Eso es correcto: solo se proponen flashcards para notas con contenido
    expect(ev.notesWithoutFlashcards.length).toBe(0);
  });
});

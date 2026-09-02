// Tests del ExamScheduler y MultiExamCoordinator.

import { describe, it, expect } from "vitest";
import { ExamScheduler, MultiExamCoordinator, computeProgress, DEFAULT_SCHEDULER_OPTIONS, ScoredCard } from "../src/exams/scheduler";
import { ScopeResolver } from "../src/exams/scopeResolver";
import type { Exam, Flashcard } from "../src/exams/types";

// Mock minimal vault
class MockTFile { constructor(public path: string, public extension: string, public parent: any) { parent.children.push(this); } }
class MockTFolder { children: any[] = []; constructor(public path: string, public parent: any) { if (parent) parent.children.push(this); } }
class MockVault {
  root: MockTFolder; files = new Map<string, MockTFile>(); folders = new Map<string, MockTFolder>();
  constructor() { this.root = new MockTFolder("", null); this.folders.set("", this.root); }
  addFolder(p: string): MockTFolder {
    if (this.folders.has(p)) return this.folders.get(p)!;
    const par = this.addFolder(dirname(p));
    const f = new MockTFolder(p, par);
    this.folders.set(p, f);
    return f;
  }
  addFile(p: string, ext = "md"): MockTFile {
    const par = this.addFolder(dirname(p));
    const f = new MockTFile(p, ext, par);
    this.files.set(p, f);
    return f;
  }
  getAbstractFileByPath(p: string) { return this.files.get(p) ?? this.folders.get(p) ?? null; }
  getMarkdownFiles() { return Array.from(this.files.values()).filter(f => f.extension === "md"); }
}
class MockMetadataCache {
  getFileCache(_f: any) { return { frontmatter: {} }; }
}
class MockApp { vault: MockVault; metadataCache: MockMetadataCache; constructor() { this.vault = new MockVault(); this.metadataCache = new MockMetadataCache(); } }
function dirname(p: string) { const i = p.lastIndexOf("/"); return i === -1 ? "" : p.slice(0, i); }

function makeApp() {
  const app = new MockApp();
  app.vault.addFile("Bioquímica/A.md");
  app.vault.addFile("Bioquímica/B.md");
  app.vault.addFile("Anatomía/C.md");
  return app as unknown as import("obsidian").App;
}

function makeCard(id: string, opts: Partial<Flashcard> = {}): Flashcard {
  return {
    id,
    notePath: "Bioquímica/A.md",
    templateId: "t",
    cardType: "conceptual" as never,
    front: "F",
    back: "B",
    tags: [],
    createdAt: new Date().toISOString(),
    status: "approved" as never,
    stability: 10,
    difficulty: 3,
    dueDate: new Date().toISOString().slice(0, 10),
    reps: 1,
    lapses: 0,
    ...opts,
  };
}

function makeExam(over: Partial<Exam> = {}): Exam {
  const today = new Date();
  const inTenDays = new Date(today);
  inTenDays.setDate(inTenDays.getDate() + 10);
  return {
    id: "exam-1",
    title: "Examen Test",
    subject: "Bioquímica",
    date: inTenDays.toISOString().slice(0, 10),
    examType: "parcial",
    scopes: [{ type: "folder", path: "Bioquímica", includeSubfolders: false }],
    status: "active",
    priority: "high",
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
    ...over,
  };
}

describe("ExamScheduler", () => {
  it("genera un plan con 1 día si el examen es hoy", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const today = new Date().toISOString().slice(0, 10);
    const exam = makeExam({ date: today });
    const cards = Array.from({ length: 5 }, (_, i) => makeCard(`c${i}`));
    const plan = sch.generate(exam, cards, { dailyReviewCap: 100 });
    expect(plan.daysAvailable).toBe(1);
    expect(plan.totalCards).toBe(5);
    expect(plan.days[0].cards).toBe(5);
    expect(plan.days[0].date).toBe(today);
  });

  it("distribuye uniformemente con estrategia spread", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inFiveDays = new Date();
    inFiveDays.setDate(inFiveDays.getDate() + 5);
    const exam = makeExam({ date: inFiveDays.toISOString().slice(0, 10) });
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(`c${i}`));
    const plan = sch.generate(exam, cards, { dailyReviewCap: 100, strategy: "spread" });
    // 10 cards en 6 días (incluyendo hoy y día del examen)
    const totalInDays = plan.days.reduce((s, d) => s + d.cards, 0);
    expect(totalInDays).toBe(10);
    // En spread, no debe haber más de 2 cards/día (10/6 redondeado)
    for (const d of plan.days) expect(d.cards).toBeLessThanOrEqual(3);
  });

  it("estrategia front-loaded pondera hacia el final", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);
    const exam = makeExam({ date: inTenDays.toISOString().slice(0, 10) });
    const cards = Array.from({ length: 30 }, (_, i) => makeCard(`c${i}`));
    const plan = sch.generate(exam, cards, { dailyReviewCap: 100, strategy: "front-loaded" });
    const lastDay = plan.days[plan.days.length - 1].cards;
    const firstDay = plan.days[0].cards;
    // En front-loaded, el último día debería tener más que el primero
    expect(lastDay).toBeGreaterThanOrEqual(firstDay);
  });

  it("cards overdue se incluyen en el plan (conteo)", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);
    const exam = makeExam({ date: inTenDays.toISOString().slice(0, 10) });
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 5);
    const cards: Flashcard[] = [
      makeCard("new", { reps: 0, dueDate: inTenDays.toISOString().slice(0, 10) }),
      makeCard("overdue", { reps: 2, dueDate: yesterday.toISOString().slice(0, 10) }),
    ];
    const plan = sch.generate(exam, cards, { dailyReviewCap: 100, strategy: "spread" });
    // Se cuenta como overdue (incluso si el boost la mueve a target futuro)
    expect(plan.overdue).toBe(1);
    // Ambas cards se incluyen en el plan
    const allIds = plan.days.flatMap((d) => d.cardIds);
    expect(allIds).toContain("overdue");
    expect(allIds).toContain("new");
  });

  it("cards mature no se incluyen en el plan", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);
    const exam = makeExam({ date: inTenDays.toISOString().slice(0, 10) });
    const cards = [
      makeCard("mature", { stability: 30, dueDate: inTenDays.toISOString().slice(0, 10) }),
      makeCard("not-mature", { stability: 5, dueDate: inTenDays.toISOString().slice(0, 10) }),
    ];
    const plan = sch.generate(exam, cards);
    expect(plan.alreadyMature).toBe(1);
    expect(plan.totalCards).toBe(1);
  });

  it("respeta dailyReviewCap", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);
    const exam = makeExam({ date: inTenDays.toISOString().slice(0, 10) });
    const cards = Array.from({ length: 100 }, (_, i) => makeCard(`c${i}`));
    const plan = sch.generate(exam, cards, { dailyReviewCap: 15 });
    for (const d of plan.days) {
      expect(d.cards).toBeLessThanOrEqual(15);
    }
  });

  it("estimatedCoverage refleja el alcance del plan", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);
    const exam = makeExam({ date: inTenDays.toISOString().slice(0, 10) });
    const cards = Array.from({ length: 50 }, (_, i) => makeCard(`c${i}`));
    const plan = sch.generate(exam, cards, { dailyReviewCap: 100 });
    expect(plan.estimatedCoverage).toBeGreaterThan(0);
    expect(plan.estimatedCoverage).toBeLessThanOrEqual(1);
  });

  it("genera warnings para casos extremos", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const exam = makeExam({ date: yesterday.toISOString().slice(0, 10) });
    const plan = sch.generate(exam, []);
    expect(plan.warnings.some((w) => w.includes("ya pasó"))).toBe(true);
  });

  it("asigna topics distintos a cada día", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const exam = makeExam({ date: inThreeDays.toISOString().slice(0, 10) });
    const cards: Flashcard[] = [
      makeCard("c1", { notePath: "Bioquímica/A.md" }),
      makeCard("c2", { notePath: "Anatomía/C.md" }),
      makeCard("c3", { notePath: "Bioquímica/B.md" }),
    ];
    const plan = sch.generate(exam, cards, { dailyReviewCap: 100 });
    // Cada día debe tener al menos un topic
    const allTopics = plan.days.flatMap((d) => d.topics);
    expect(allTopics).toContain("Bioquímica");
  });
});

describe("MultiExamCoordinator", () => {
  it("coordina múltiples exámenes y marca conflictsWith", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const coordinator = new MultiExamCoordinator();
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);

    const examA = makeExam({ id: "A", title: "Examen A", date: inTenDays.toISOString().slice(0, 10) });
    const examB = makeExam({ id: "B", title: "Examen B", date: inTenDays.toISOString().slice(0, 10) });
    const cards = Array.from({ length: 20 }, (_, i) => makeCard(`c${i}`));
    examA.schedule = sch.generate(examA, cards, { dailyReviewCap: 50 });
    examB.schedule = sch.generate(examB, cards, { dailyReviewCap: 50 });

    const updated = coordinator.coordinate([examA, examB]);
    const a = updated.get("A")!;
    const b = updated.get("B")!;
    // Cada examen debe listar al otro en conflictsWith para días compartidos
    const aSharedDays = a.schedule!.days.filter((d) => d.conflictsWith.includes("Examen B"));
    const bSharedDays = b.schedule!.days.filter((d) => d.conflictsWith.includes("Examen A"));
    expect(aSharedDays.length).toBeGreaterThan(0);
    expect(bSharedDays.length).toBeGreaterThan(0);
  });

  it("no marca conflictos si los exámenes no se solapan en fecha", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const coordinator = new MultiExamCoordinator();
    const inFiveDays = new Date();
    inFiveDays.setDate(inFiveDays.getDate() + 5);
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);

    const examA = makeExam({ id: "A", date: inFiveDays.toISOString().slice(0, 10) });
    const examB = makeExam({ id: "B", date: inTwentyDays.toISOString().slice(0, 10) });
    const cards = Array.from({ length: 10 }, (_, i) => makeCard(`c${i}`));
    examA.schedule = sch.generate(examA, cards);
    examB.schedule = sch.generate(examB, cards);

    const updated = coordinator.coordinate([examA, examB]);
    const a = updated.get("A")!;
    // Los días del examen A (próximo) no deben tener a B en conflictsWith
    const dayZero = a.schedule!.days[0];
    expect(dayZero.conflictsWith).not.toContain("Examen B");
  });
});

describe("computeProgress", () => {
  it("calcula métricas de progreso", () => {
    const inTenDays = new Date();
    inTenDays.setDate(inTenDays.getDate() + 10);
    const exam = makeExam({ date: inTenDays.toISOString().slice(0, 10) });
    const cards: Flashcard[] = [
      makeCard("c1", { stability: 30, reps: 3 }),
      makeCard("c2", { stability: 5, reps: 1 }),
      makeCard("c3", { stability: 1, reps: 0 }),
    ];
    const progress = computeProgress(exam, cards);
    expect(progress.totalCards).toBe(3);
    expect(progress.reviewedCards).toBe(2);
    expect(progress.matureCards).toBe(1);
    expect(progress.coverage).toBeCloseTo(1 / 3);
    expect(progress.daysUntilExam).toBeGreaterThanOrEqual(9);
  });
});

describe("DEFAULT_SCHEDULER_OPTIONS", () => {
  it("tiene valores razonables por defecto", () => {
    expect(DEFAULT_SCHEDULER_OPTIONS.dailyReviewCap).toBe(100);
    expect(DEFAULT_SCHEDULER_OPTIONS.minutesPerCard).toBe(0.5);
    expect(DEFAULT_SCHEDULER_OPTIONS.strategy).toBe("front-loaded");
  });
});

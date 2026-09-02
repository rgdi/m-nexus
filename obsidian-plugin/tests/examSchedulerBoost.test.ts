// Tests de ExamScheduler con FSRS-aware boost.

import { describe, it, expect } from "vitest";
import { ExamScheduler, DEFAULT_SCHEDULER_OPTIONS } from "../src/exams/scheduler";
import { ScopeResolver } from "../src/exams/scopeResolver";
import type { Flashcard, Exam } from "../src/exams/types";
import type { FSRSAdapter } from "../src/exams/fsrsIntegration";

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
  getRoot() { return this.root; }
}
class MockMetadataCache { getFileCache(_f: any) { return { frontmatter: {} }; } }
class MockApp { vault: MockVault; metadataCache: MockMetadataCache; constructor() { this.vault = new MockVault(); this.metadataCache = new MockMetadataCache(); } }
function dirname(p: string) { const i = p.lastIndexOf("/"); return i === -1 ? "" : p.slice(0, i); }

function makeApp() {
  const app = new MockApp();
  app.vault.addFile("Bioquímica/A.md");
  app.vault.addFile("Bioquímica/B.md");
  return app as unknown as import("obsidian").App;
}

function makeCard(id: string, over: Partial<Flashcard> = {}): Flashcard {
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
    subject: "Bioquímica",
    ...over,
  };
}

function makeExam(over: Partial<Exam> = {}): Exam {
  const today = new Date();
  const inTenDays = new Date(today);
  inTenDays.setDate(inTenDays.getDate() + 10);
  return {
    id: "exam-1",
    title: "Parcial",
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

describe("ExamScheduler con FSRS boost", () => {
  it("por defecto aplica boost y la dueDate se adelanta", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const exam = makeExam();
    const card = makeCard("c1", { dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const plan = sch.generate(exam, [card]);
    expect(plan.boosts).toBeDefined();
    expect(plan.boosts!.length).toBe(1);
    expect(plan.boosts![0].daysPulledIn).toBeGreaterThan(0);
  });

  it("no boost si la dueDate ya está antes del target", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const today = new Date();
    const card = makeCard("c1", { dueDate: today.toISOString().slice(0, 10) });
    const exam = makeExam();
    const plan = sch.generate(exam, [card]);
    expect(plan.boosts).toBeDefined();
    expect(plan.boosts!.length).toBe(0);
  });

  it("no aplica boost si applyBoosts:false", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const exam = makeExam();
    const card = makeCard("c1", { dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const plan = sch.generate(exam, [card], { applyBoosts: false });
    expect(plan.boosts?.length).toBe(0);
  });

  it("usa adapter FSRS personalizado (inyectable)", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const exam = makeExam();
    const card = makeCard("c1", { dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const calls: { cardId: string; newDue: string }[] = [];
    const adapter: FSRSAdapter = {
      naturalDue: (c) => c.dueDate ?? "",
      applyBoost: (c, newDue) => { calls.push({ cardId: c.id, newDue }); c.dueDate = newDue; },
    };
    sch.generate(exam, [card], { fsrsAdapter: adapter });
    expect(calls.length).toBe(1);
    expect(calls[0].cardId).toBe("c1");
  });

  it("incluye warning cuando hay boosts aplicados", () => {
    const resolver = new ScopeResolver(makeApp());
    const sch = new ExamScheduler(resolver);
    const inTwentyDays = new Date();
    inTwentyDays.setDate(inTwentyDays.getDate() + 20);
    const exam = makeExam();
    const card = makeCard("c1", { dueDate: inTwentyDays.toISOString().slice(0, 10) });
    const plan = sch.generate(exam, [card]);
    expect(plan.warnings.some((w) => w.includes("FSRS boost"))).toBe(true);
  });
});

describe("DEFAULT_SCHEDULER_OPTIONS incluye boost", () => {
  it("tiene boost options por defecto", () => {
    expect(DEFAULT_SCHEDULER_OPTIONS.boost).toBeDefined();
    expect(DEFAULT_SCHEDULER_OPTIONS.applyBoosts).toBe(true);
  });
});

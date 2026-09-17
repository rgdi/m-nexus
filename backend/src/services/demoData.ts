// demoData.ts — Shared demo data for opt-in seeding.
// v2.6.0: extracted from individual route files so they're no longer
// auto-seeded on first request. Loaded only via POST /admin/demo/load.

import { logOp } from "../utils/log.js";
import {
  subjectsServiceInstance,
  eventsServiceInstance,
  notesServiceInstance,
  tasksServiceInstance,
} from "../routes/index.js";

export const DEMO_SUBJECTS = [
  { name: "Math", icon: "M", color: "var(--subj-red)", grade: 9.23, performance: 3, prof: "Mr. Meier", next: "Algebra" },
  { name: "Politics-economics", icon: "P", color: "var(--subj-yellow)", grade: 7.52, performance: 1, prof: "Fr. Stolz", next: "" },
  { name: "Deutsch", icon: "D", color: "var(--subj-blue)", grade: 7.52, performance: 3, prof: "Dr. Seibert", next: "" },
  { name: "Physics", icon: "Ψ", color: "var(--subj-purple)", grade: 6.98, performance: 1, prof: "Dr. Müller", next: "" },
  { name: "Chemistry", icon: "C", color: "var(--subj-green)", grade: 7.24, performance: 2, prof: "Dr. Müller", next: "" },
  { name: "French", icon: "F", color: "var(--subj-teal)", grade: 6.98, performance: 0, prof: "", next: "" },
  { name: "Biology", icon: "B", color: "var(--subj-green)", grade: 7.24, performance: 0, prof: "", next: "" },
  { name: "Computer Sci.", icon: "</>", color: "var(--subj-orange)", grade: 9.23, performance: 0, prof: "", next: "" },
  { name: "History", icon: "H", color: "var(--subj-yellow)", grade: 7.83, performance: 0, prof: "", next: "" },
  { name: "English", icon: "E", color: "var(--subj-blue)", grade: 8.41, performance: 0, prof: "", next: "" },
  { name: "Art", icon: "A", color: "var(--subj-pink)", grade: 8.22, performance: 0, prof: "", next: "" },
  { name: "Music", icon: "♪", color: "var(--subj-pink)", grade: 8.64, performance: 0, prof: "", next: "" },
];

const today = (h = 9, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

export const DEMO_EVENTS = [
  { title: "Math", prof: "Mr. Meier", room: "301", type: "Homework", subject: "math", start: today(8, 0), end: today(9, 30) },
  { title: "Politics-economics", prof: "Fr. Stolz", room: "301", type: "Homework", subject: "pol", start: today(9, 55), end: today(11, 25) },
  { title: "Deutsch", prof: "Dr. Seibert", room: "207", type: "Referat", subject: "deu", start: today(11, 45), end: today(13, 15) },
  { title: "Physics", prof: "Dr. Müller", room: "211", type: "Homework", subject: "phy", start: today(14, 0), end: today(15, 0) },
  { title: "Chemistry", prof: "Dr. Müller", room: "301", type: "Homework", subject: "che", start: today(15, 10), end: today(16, 10) },
];

const inDays = (n: number, h = 9, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

export const DEMO_NOTES = [
  {
    title: "Welcome to M-NEXUS",
    subject: "math",
    tags: ["welcome"],
    body: "# Welcome\n\nEste es tu notebook. **Pulsa el lápiz para escribir**, el icono de imagen para insertar fotos, el código para snippets, etc.\n\nUsa ==subrayado==, !!resaltado!!, [[Getting started]] o {{c1::Capital de Francia::París}} para crear flashcards.",
    pages: [{ strokes: [], placeholders: [] }],
  },
  {
    title: "Getting started",
    subject: "deu",
    tags: ["guide"],
    body: "# Erste Schritte\n\n- Schreibe mit dem Stift\n- Markiere mit dem Textmarker\n- Erstelle Karteikarten mit {{c1::cloze::answer}}\n- Verlinke Notizen mit [[Welcome to M-NEXUS]]",
    pages: [{ strokes: [], placeholders: [] }],
  },
  {
    title: "Flashcards demo",
    subject: "bio",
    tags: ["biology"],
    body: "# Cell biology\n\nMitochondria: the powerhouse of the cell. {{c1::Cristae::folded inner membrane}} increases surface area for ATP synthesis.\n\nRibosomes: {{c1::protein synthesis::translation site}}.",
    pages: [{ strokes: [], placeholders: [] }],
  },
];

export const DEMO_TASKS = [
  { title: "Submit politics-econ essay", text: "Submit politics-econ essay", subject: "pol", due: inDays(-2, 23, 59), priority: 2 as const, done: false },
  { title: "Read chapter 7 — Biology", text: "Read chapter 7 — Biology", subject: "bio", due: inDays(-1, 18, 59), priority: 1 as const, done: false },
  { title: "Chemistry lab report", text: "Chemistry lab report", subject: "che", due: inDays(1, 23, 59), priority: 2 as const, done: false },
  { title: "Practice integrals (set 3)", text: "Practice integrals (set 3)", subject: "math", due: inDays(-3, 22, 59), priority: 1 as const, done: false },
  { title: "Buy lab coat", text: "Buy lab coat", subject: "che", due: inDays(-5, 10, 0), priority: 0 as const, done: true },
  { title: "Email professor about Referat", text: "Email professor about Referat", subject: "deu", due: inDays(-2, 14, 30), priority: 1 as const, done: true },
];

/**
 * Load all demo data. Used only via POST /api/v1/admin/demo/load.
 * Idempotent — skips collections that already have items.
 * Uses the same singleton instances as the actual route handlers
 * so the cache stays in sync.
 */
export async function loadDemoDataInline(): Promise<{ subjects: number; events: number; notes: number; tasks: number }> {
  const subjectSvc = subjectsServiceInstance;
  const eventSvc = eventsServiceInstance;
  const noteSvc = notesServiceInstance;
  const taskSvc = tasksServiceInstance;
  const result = { subjects: 0, events: 0, notes: 0, tasks: 0 };

  // Subjects
  const existingSubjects = await subjectSvc.all();
  if (existingSubjects.length === 0) {
    for (const s of DEMO_SUBJECTS) {
      await subjectSvc.create(s);
      result.subjects++;
    }
  }

  // Events
  const existingEvents = await eventSvc.all();
  if (existingEvents.length === 0) {
    for (const e of DEMO_EVENTS) {
      await eventSvc.create(e);
      result.events++;
    }
  }

  // Notes
  const existingNotes = await noteSvc.all();
  if (existingNotes.length === 0) {
    for (const n of DEMO_NOTES as any[]) {
      await noteSvc.create(n);
      result.notes++;
    }
  }

  // Tasks
  const existingTasks = await taskSvc.all();
  if (existingTasks.length === 0) {
    for (const t of DEMO_TASKS) {
      await taskSvc.create(t);
      result.tasks++;
    }
  }

  logOp("demo", "demo data loaded", true, result);
  return result;
}

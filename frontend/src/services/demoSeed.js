/* ============================================================
 * demoSeed.js — populate localStorage with demo data on first run.
 * v1.0.0 — based on the Education Service reference visuals.
 * ============================================================ */

import { store, collection } from "./store.js";

const today = (h = 9, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
};
const inDays = (n, h = 9, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, m, 0, 0);
  return d.getTime();
};

export function seedDemo(store) {
  // ----- Subjects -----
  const subjects = collection("subjects");
  const math = subjects.create({
    name: "Math", icon: "M", color: "var(--subj-red)",
    grade: 9.23, performance: 3, next: "Algebra", prof: "Mr. Meier",
  });
  const pol = subjects.create({
    name: "Politics-economics", icon: "P", color: "var(--subj-yellow)",
    grade: 7.52, performance: 1, next: "Fr. Stolz",
  });
  const deu = subjects.create({
    name: "Deutsch", icon: "D", color: "var(--subj-blue)",
    grade: 7.52, performance: 3, prof: "Dr. Seibert",
  });
  const phy = subjects.create({
    name: "Physics", icon: "Ψ", color: "var(--subj-purple)",
    grade: 6.98, performance: 1, prof: "Dr. Müller",
  });
  const che = subjects.create({
    name: "Chemistry", icon: "C", color: "var(--subj-green)",
    grade: 7.24, performance: 2, prof: "Dr. Müller",
  });
  const fre = subjects.create({ name: "French", icon: "F", color: "var(--subj-teal)", grade: 6.98 });
  const bio = subjects.create({ name: "Biology", icon: "B", color: "var(--subj-green)", grade: 7.24 });
  const cs  = subjects.create({ name: "Computer Sci.", icon: "</>", color: "var(--subj-orange)", grade: 9.23 });
  subjects.create({ name: "History", icon: "H", color: "var(--subj-yellow)", grade: 7.83 });
  subjects.create({ name: "English", icon: "E", color: "var(--subj-blue)", grade: 8.41 });
  subjects.create({ name: "Art", icon: "A", color: "var(--subj-pink)", grade: 8.22 });
  subjects.create({ name: "Music", icon: "♪", color: "var(--subj-pink)", grade: 8.64 });

  // ----- Events (today's calendar) -----
  const events = collection("events");
  events.create({
    title: "Math", prof: "Mr. Meier", room: "301", type: "Homework",
    subject: "math", start: today(8, 0), end: today(9, 30),
  });
  events.create({
    title: "Politics-economics", prof: "Fr. Stolz", room: "301", type: "Homework",
    subject: "pol", start: today(9, 55), end: today(11, 25),
  });
  events.create({
    title: "Deutsch", prof: "Dr. Seibert", room: "207", type: "Referat",
    subject: "deu", start: today(11, 45), end: today(13, 15),
  });
  events.create({
    title: "Physics", prof: "Dr. Müller", room: "211", type: "Homework",
    subject: "phy", start: today(14, 0), end: today(15, 0),
  });
  events.create({
    title: "Chemistry", prof: "Dr. Müller", room: "301",
    subject: "che", start: today(15, 10), end: today(16, 10),
  });

  // ----- Notes (3 demo notebooks) -----
  const notes = collection("notes");
  notes.create({
    title: "Welcome to M-NEXUS",
    subject: "math",
    body: "# Welcome\n\nEste es tu notebook. **Pulsa el lápiz para escribir**, el icono de imagen para insertar fotos, el código para snippets, etc.",
    tags: ["welcome"],
  });
  notes.create({
    title: "Getting started",
    subject: "deu",
    body: "# Erste Schritte\n\n- Schreib mit dem Stift\n- Speichere oft (auto-save alle 5s)\n- Nutze die AI-Taste für Übersetzung",
    tags: ["onboarding"],
  });
  notes.create({
    title: "Flashcards demo",
    subject: "bio",
    body: "# Cell biology\n\nMitochondria: the powerhouse of the cell.",
    tags: ["biology", "review"],
  });

  // ----- Tasks (todos) -----
  const tasks = collection("tasks");
  tasks.create({ text: "Submit politics-econ essay", due: inDays(1, 23, 59), priority: 2, subject: "pol" });
  tasks.create({ text: "Read chapter 7 — Biology", due: inDays(2, 18, 0), priority: 1, subject: "bio" });
  tasks.create({ text: "Practice integrals (set 3)", due: inDays(0, 22, 0), priority: 0, subject: "math" });
  tasks.create({ text: "Chemistry lab report", due: inDays(4, 23, 59), priority: 1, subject: "che" });
  tasks.create({ text: "Buy lab coat", done: true, subject: "che" });
  tasks.create({ text: "Email professor about Referat", done: true, subject: "deu" });
}

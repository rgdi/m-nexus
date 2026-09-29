// tests/v2382isolation.test.ts — v2.38.2, the partition is complete.
//
// v2.38.1 partitioned notes, folders, flashcards and tasks and reported
// the work as done. It was not: subjects, events and recordings were
// left on the global files, so every device that ever registered shared
// one subject list — creating three subjects returned twelve. Four
// loose readers (journal live queries, cross-verify, grading) were also
// still pointed at the global paths and silently resolved to empty.
//
// This file is the guard that the first one was missing. It asserts the
// property directly — no data route reads a global path — rather than
// listing the tables that happen to be migrated today, because the bug
// was precisely that the list was kept by hand.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROUTES = join(process.cwd(), "src", "routes");
const SERVICES = join(process.cwd(), "src", "services");

/** Read every .ts under a directory tree. */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

const ALL = [...tsFiles(ROUTES), ...tsFiles(SERVICES)];

/** Collections that are user data, not device or server configuration. */
const USER_DATA = ["notes", "folders", "flashcards", "subjects", "events", "recordings", "tasks"];

describe("v2.38.2 — no user data table is still global", () => {
  for (const name of USER_DATA) {
    it(`${name}.json is not read from the global path`, () => {
      // A leftover like `join(process.cwd(), "data", "notes.json")` is the
      // exact shape of the bug: after the migration that file is either
      // gone or belongs to somebody else.
      const offenders: string[] = [];
      for (const f of ALL) {
        if (f.endsWith("userStore.ts")) continue;
        const src = readFileSync(f, "utf-8");
        const re = new RegExp(`join\\(process\\.cwd\\(\\),\\s*"data",\\s*"${name}\\.json"\\)`);
        if (re.test(src)) offenders.push(f.replace(process.cwd() + "/", ""));
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("v2.38.2 — the services are subject-scoped", () => {
  const cases: Array<[string, string]> = [
    ["subjects.ts", "SubjectsService"],
    ["events.ts", "EventsService"],
    ["recordings.ts", "RecordingsService"],
    ["notes.ts", "NotesService"],
    ["tasks.ts", "TasksService"],
    ["flashcards.ts", "FlashcardsService"],
  ];

  for (const [file, cls] of cases) {
    it(`${cls} caches per subject, not in one array`, () => {
      const src = readFileSync(join(ROUTES, file), "utf-8");
      const start = src.indexOf(`class ${cls}`);
      expect(start, `${cls} no está en ${file}`).toBeGreaterThan(-1);
      const body = src.slice(start, start + 2500);
      // A single shared array is the defect: it bleeds across concurrent
      // requests even when every read is otherwise correct.
      expect(body).toMatch(/cache\s*=\s*new Map</);
      expect(body).toMatch(/currentSubject\(\)/);
    });
  }
});

describe("v2.38.2 — loose readers are gone", () => {
  it("the journal's live queries read the current user's collections", () => {
    const src = readFileSync(join(ROUTES, "journal.ts"), "utf-8");
    // "Due cards", "today's agenda" and "open tasks" blocks.
    expect(src).toMatch(/async function perUser\(/);
    expect(src).not.toMatch(/readJson<any\[\]>\(join\(process\.cwd\(\), "data"/);
  });

  it("cross-verify reads this user's recordings", () => {
    const src = readFileSync(join(ROUTES, "cross_verify.ts"), "utf-8");
    expect(src).toMatch(/"recordings\.json"/);
    expect(src).not.toMatch(/"data", "recordings\.json"/);
  });

  it("the grader reads this user's deck", () => {
    const src = readFileSync(join(ROUTES, "grading.ts"), "utf-8");
    expect(src).toMatch(/readCollection<any\[\]>\(currentSubject\(\), "flashcards\.json"/);
  });
});

// tests/v238.test.js — v2.38.0 quick capture (frontend).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");

const capture = read("src/screens/capture.js");
const fab = read("src/widgets/capture_fab.js");
const main = read("src/main.js");
const index = read("index.html");
const mobile = read("src/styles/mobile.css");
const backendTasks = read("../backend/src/routes/tasks.ts");
const extractor = read("../backend/src/services/taskExtractor.ts");

describe("v2.38.0 — the capture screen exists", () => {
  it("is a registered route", () => {
    expect(main).toMatch(/capture: renderCapture/);
    expect(main).toMatch(/import \{ renderCapture \} from "\.\/screens\/capture\.js"/);
  });

  it("has a dock entry", () => {
    expect(index).toMatch(/data-route="capture"/);
  });

  it("renders the four buckets", () => {
    for (const kind of ["task", "shopping", "habit", "expense"]) {
      expect(capture).toMatch(new RegExp(`kind: "${kind}"`));
    }
  });

  it("never uses a bare fetch without auth", () => {
    // v2.38.0 closed /api/v1/tasks, so an unauthenticated call would 401.
    const fetches = capture.match(/fetch\(`[^`]*`[^)]*\)/g) || [];
    expect(fetches.length).toBeGreaterThan(0);
    for (const f of fetches) {
      if (f.includes("/api/v1/")) expect(f).toMatch(/authHeaders/);
    }
  });
});

describe("v2.38.0 — preview before persisting", () => {
  it("asks the backend for a preview first (persist: false)", () => {
    expect(capture).toMatch(/persist: false/);
  });

  it("only writes after the user accepts", () => {
    expect(capture).toMatch(/data-cap-accept/);
    expect(capture).toMatch(/function acceptAll/);
  });

  it("labels where each row came from", () => {
    // A row the rules produced must never be shown as AI-graded.
    expect(capture).toMatch(/t\.how !== "rule"/);
    expect(capture).toMatch(/por reglas/);
  });

  it("says so when the model was unavailable", () => {
    expect(capture).toMatch(/IA no disponible/);
  });

  it("lets a single row be saved on its own", () => {
    expect(capture).toMatch(/data-cap-accept-one|function acceptOne/);
  });
});

describe("v2.38.0 — habits", () => {
  it("shows the streak and a check-in button", () => {
    expect(capture).toMatch(/data-cap-habit-check/);
    expect(capture).toMatch(/cap-chip--streak/);
  });

  it("reports the new streak after a check-in", () => {
    expect(capture).toMatch(/Racha: \$\{j\.streak\}/);
  });
});

describe("v2.38.0 — the FAB", () => {
  it("is mounted from the bootstrap", () => {
    expect(main).toMatch(/mountCaptureFab\(\)/);
  });

  it("navigates to the capture route", () => {
    expect(fab).toMatch(/location\.hash = "#\/capture"/);
  });

  it("hides itself on the capture screen and on desktop", () => {
    // Otherwise it covers the very screen it opens.
    expect(fab).toMatch(/onCapture \|\| wide/);
  });

  it("is mounted only once", () => {
    expect(fab).toMatch(/getElementById\(ID\)\) return/);
  });

  it("is styled as a 56px touch target", () => {
    expect(mobile).toMatch(/\.mn-capture-fab \{[^}]*width: 56px; height: 56px/);
  });
});

describe("v2.38.0 — backend contract", () => {
  it("exposes the capture endpoint", () => {
    expect(backendTasks).toMatch(/"\/tasks\/capture"/);
  });

  it("exposes the habit check-in", () => {
    expect(backendTasks).toMatch(/"\/tasks\/:id\/habit-check"/);
  });

  it("exposes the summaries", () => {
    expect(backendTasks).toMatch(/"\/tasks\/summary"/);
  });

  it("keeps legacy rows readable (kind is optional)", () => {
    expect(backendTasks).toMatch(/kind\?: TaskKind/);
  });
});

describe("v2.38.0 — the accent bug that made the parser useless", () => {
  it("does not rely on \\b for Spanish keywords", () => {
    // \b is defined over [A-Za-z0-9_], so "é" is a non-word character
    // and /\bpagu[eé]\b/ can never match "pagué". Every accented keyword
    // — pagué, gasté, reunión, hábitos, miércoles — was unreachable and
    // silently fell through to the generic "task" branch.
    const code = extractor
      .replace(/^\s*\*.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\\b[a-zñ_]*[éíóúñ][a-zñ_]*\\b/);
    expect(extractor).toMatch(/function w\(pattern: string\)/);
    expect(extractor).toMatch(/\\p\{L\}/);
  });

  it("uses the u flag wherever it uses \\p", () => {
    const regexes = extractor.match(/new RegExp\([^;]+?"i(u)?"\)/g) || [];
    const needsU = regexes.filter((r) => r.includes("\\p{"));
    for (const r of needsU) expect(r).toMatch(/"iu"/);
  });
});

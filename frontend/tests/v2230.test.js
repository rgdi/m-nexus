// v2230.test.js — v2.23.0 frontend additions:
//   - Drag & drop visual feedback (drop indicators)
//   - Multi-device sync via WebSocket
//   - Subject templates (career starters)

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.23.0 — drag & drop visual feedback", () => {
  it("subjects screen has showDropIndicator / hideDropIndicator helpers", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/function showDropIndicator/);
    expect(src).toMatch(/function hideDropIndicator/);
  });

  it("subjects screen uses .drop-target-before / .drop-target-after classes", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/drop-target-before/);
    expect(src).toMatch(/drop-target-after/);
  });

  it("subjects.js tracks dropPosition in state", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/dropPosition:\s*null/);
    expect(src).toMatch(/dropIndicator:\s*null/);
  });

  it("mobile touch-drag mode (long-press + drag)", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/startTouchDrag/);
    expect(src).toMatch(/endTouchDrag/);
    expect(src).toMatch(/touchClone/);
    expect(src).toMatch(/navigator\.vibrate/);
  });

  it("reorderAround accepts position (before/after)", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/async function reorderAround\([^)]+position/);
  });

  it("CSS has drop indicator animated line", () => {
    const css = readFileSync(SRC("frontend/src/styles/components.css"), "utf-8");
    expect(css).toMatch(/\.subj-row\.drop-target-before::before/);
    expect(css).toMatch(/\.subj-row\.drop-target-after::after/);
    expect(css).toMatch(/@keyframes drop-line-pulse/);
  });

  it("CSS .subj-row.dragging = opacity 0.4", () => {
    const css = readFileSync(SRC("frontend/src/styles/components.css"), "utf-8");
    expect(css).toMatch(/\.subj-row\.dragging[^}]*opacity:\s*0\.4/);
  });

  it("drag-clone has rotate + halo", () => {
    const css = readFileSync(SRC("frontend/src/styles/components.css"), "utf-8");
    expect(css).toMatch(/\.drag-clone/);
    expect(css).toMatch(/transform:\s*rotate\(-1\.5deg\)/);
  });
});

describe("v2.23.0 — multi-device sync", () => {
  it("subjects.js imports connectSync", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/import.*connectSync/);
  });

  it("subjects.js calls connectSync on render", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/connectSync\(\);/);
  });

  it("subjects.js installs sync:incoming event listener", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/addEventListener\("sync:incoming"/);
    expect(src).toMatch(/installRemoteSyncListener/);
  });

  it("listener refreshes subject list on incoming events", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/if \(!msg \|\| msg\.type !== "subject"\) return/);
    expect(src).toMatch(/renderSubjectList\(remoteSyncRoot\)/);
  });

  it("guards against being on a different screen", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/screenStillActive/);
  });
});

describe("v2.23.0 — templates by career", () => {
  it("subjects.js exports TEMPLATES with multiple careers", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/const TEMPLATES = \[/);
    // Career templates
    expect(src).toMatch(/ESO 1/);
    expect(src).toMatch(/Bachillerato Científico/);
    expect(src).toMatch(/Medicina/);
    expect(src).toMatch(/Ingeniería/);
    expect(src).toMatch(/Derecho/);
    expect(src).toMatch(/ADE/);
    expect(src).toMatch(/Veterinaria/);
  });

  it("openTemplates function exists and creates modal", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/function openTemplates\(/);
    expect(src).toMatch(/templates-modal/);
  });

  it("templates UI shows subjects preview", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/t-emoji|t-body|t-title|t-sub/);
  });

  it("templates sequential POST via dataSource.subjects.create", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/dataSource\.subjects\.create\(/);
    expect(src).toMatch(/for \(const s of tpl\.subjects\)/);
  });

  it("templates button in screen header", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/id="templates-btn"/);
    expect(src).toMatch(/📋/);
  });

  it("empty state shows templates button too", () => {
    const src = readFileSync(SRC("frontend/src/screens/subjects.js"), "utf-8");
    expect(src).toMatch(/id="empty-templates"/);
  });

  it("CSS for templates-modal & ghost button", () => {
    const css = readFileSync(SRC("frontend/src/styles/components.css"), "utf-8");
    expect(css).toMatch(/\.templates-modal/);
    expect(css).toMatch(/\.template-card/);
    expect(css).toMatch(/\.btn\.ghost/);
  });
});

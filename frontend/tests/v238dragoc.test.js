// tests/v238dragoc.test.js — v2.38.1 drag answers onto a masked image.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");
const w = read("src/widgets/drag_occlusion.js");
const screen = read("src/screens/occlusion_screen.js");
const css = read("src/styles/mobile.css");

describe("v2.38.1 — drag over an image works with a finger", () => {
  it("uses Pointer Events, not HTML5 drag", () => {
    // HTML5 drag does not fire on touch screens — the drag simply never
    // begins on Android or ChromeOS.
    expect(w).toMatch(/addEventListener\("pointerdown"/);
    expect(w).toMatch(/addEventListener\("pointermove"/);
    expect(w).toMatch(/addEventListener\("pointerup"/);
    expect(w).not.toMatch(/addEventListener\("dragstart"/);
    expect(w).not.toMatch(/addEventListener\("dragover"/);
    expect(w).not.toMatch(/addEventListener\("drop"/);
    expect(w).not.toMatch(/dataTransfer/);
  });

  it("marks the chips touch-action: none so the page does not scroll", () => {
    expect(css).toMatch(/touch-action: none/);
  });

  it("keeps the tap-then-tap path for accessibility", () => {
    expect(w).toMatch(/if \(!selected\) return/);
    expect(w).toMatch(/place\(selected, m\.dataset\.mask\)/);
  });

  it("has an 8px threshold so a tap is not a drag", () => {
    expect(w).toMatch(/Math\.hypot\(dx, dy\) < 8/);
  });

  it("suppresses the synthetic click that follows a drag", () => {
    // Otherwise every drag also toggles the selection.
    expect(w).toMatch(/suppressClick/);
  });
});

describe("v2.38.1 — geometry", () => {
  it("positions masks in normalised coordinates", () => {
    // Masks are stored 0..1 against the page, so they survive any
    // render size — phone, 4K, print.
    expect(w).toMatch(/left:\$\{o\.x \* 100\}%/);
    expect(w).toMatch(/width:\$\{o\.w \* 100\}%/);
  });

  it("hit-tests through the DOM rather than comparing pixels", () => {
    expect(w).toMatch(/document\.elementFromPoint/);
  });
});

describe("v2.38.1 — the drop rules", () => {
  it("a chip is used once", () => {
    expect(w).toMatch(/isUsed/);
    expect(w).toMatch(/aria-disabled/);
  });

  it("two chips cannot occupy one mask", () => {
    expect(w).toMatch(/occupant/);
  });

  it("moving a chip frees the mask it was in", () => {
    // Otherwise the first mask stays filled by a chip that has moved.
    expect(w).toMatch(/if \(prior\) drops\.splice/);
  });

  it("marks correct and wrong differently once checked", () => {
    expect(w).toMatch(/is-correct/);
    expect(w).toMatch(/is-wrong/);
  });

  it("only reveals what was attempted, not the whole key", () => {
    expect(w).toMatch(/for \(const d of drops\)/);
    expect(w).toMatch(/if \(drops\.length >= total\)/);
  });
});

describe("v2.38.1 — the study logic stays outside the widget", () => {
  it("the widget asks a predicate, it does not decide", () => {
    expect(w).toMatch(/isCorrect\(chip\.text, mask\)/);
  });

  it("the screen supplies it, accent- and case-insensitively", () => {
    expect(screen).toMatch(/isCorrect:/);
    expect(screen).toMatch(/NFD/);
  });
});

describe("v2.38.1 — lifecycle", () => {
  it("returns a destroy handle so a re-render leaves no stale state", () => {
    // drag_gap.js in v2.37.0 kept its drag state in module scope with
    // no way to clear it, so a re-render left a ghost chip mid-screen.
    expect(w).toMatch(/destroy\(\)/);
    expect(w).toMatch(/host\.innerHTML = ""/);
  });

  it("is wired into the occlusion screen", () => {
    expect(screen).toMatch(/from "\.\.\/widgets\/drag_occlusion\.js"/);
    expect(screen).toMatch(/mountOcclusionDragExercise/);
  });
});

// ── The mount itself ───────────────────────────────────────────────
// The tests above read the source. That is a real blind spot, and it
// is exactly how `drops` shipped undeclared: every helper behaved and
// the widget still threw "drops is not defined" the moment a browser
// called mountDragOcclusion. These mount it against a real DOM.
describe("v2.38.1 — the widget actually mounts", () => {
  it("mounts without throwing and returns a destroy handle", async () => {
    const { mountDragOcclusion } = await import("../src/widgets/drag_occlusion.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = mountDragOcclusion({
      host,
      imageUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      occlusions: [{ id: "o1", x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "A" }],
      chips: [{ id: "c1", text: "A" }, { id: "c2", text: "B" }],
      isCorrect: () => true,
    });
    expect(host.querySelectorAll("[data-chip]").length).toBe(2);
    expect(host.querySelectorAll("[data-mask]").length).toBe(1);
    expect(typeof api.destroy).toBe("function");
    api.destroy();
    host.remove();
  });

  it("re-repaints after a selection without throwing", async () => {
    const { mountDragOcclusion } = await import("../src/widgets/drag_occlusion.js");
    const host = document.createElement("div");
    document.body.appendChild(host);
    const api = mountDragOcclusion({
      host,
      imageUrl: "data:image/svg+xml;base64,PHN2Zy8+",
      occlusions: [{ id: "o1", x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "A" }],
      chips: [{ id: "c1", text: "A" }],
      isCorrect: () => true,
    });
    const chip = host.querySelector("[data-chip]");
    chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chip.getAttribute("aria-selected")).toBe("true");
    api.destroy();
    host.remove();
  });

  it("declares every module-level variable it assigns", () => {
    // A cheap guard against the next undeclared assignment, which in a
    // strict-mode module is a hard crash at first use, not a soft bug.
    const declared = new Set(
      [...w.matchAll(/^\s*(?:let|const|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    );
    const assigned = new Set(
      [...w.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*=\s*[^=]/gm)].map((m) => m[1]),
    );
    // `style` and friends are object keys inside the template, not
    // module bindings; only flag names the module really assigns.
    const skip = new Set(["style", "className", "innerHTML", "textContent"]);
    expect([...assigned].filter((n) => !declared.has(n) && !skip.has(n))).toEqual([]);
  });
});

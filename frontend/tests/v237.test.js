// tests/v237.test.js — v2.37.0 frontend regression tests.
//
// Every test maps to a defect found in the critical audit. These are
// mostly source-level assertions (the widgets are DOM-heavy and the
// project has no jsdom harness for them), plus pure-function checks
// where the logic can be imported directly.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");

const studyCards = read("src/widgets/study_cards.js");
const studyScreen = read("src/screens/study.js");
const pwa = read("src/services/pwa.js");
const dragGap = read("src/widgets/drag_gap.js");
const main = read("src/main.js");
const auth = read("src/services/auth.js");
const bell = read("src/widgets/notifications_bell.js");
const journal = read("src/screens/journal.js");
const progress = read("src/screens/progress.js");

/* ------------------------------------------------------------------ *
 * F5 — the study screen must actually persist a review
 * ------------------------------------------------------------------ */
describe("F5 — study review persistence", () => {
  it("sends ratings on the 1..4 scale the backend accepts", () => {
    // v2.35.0 used 0..3, so "De nuevo" sent 0 and the backend answered
    // 400 EC-FC-004. The whole progress screen stayed empty because of
    // this one off-by-one.
    expect(studyCards).toMatch(/\{ r: 1, label: "De nuevo"/);
    expect(studyCards).toMatch(/\{ r: 4, label: "Fácil"/);
    expect(studyCards).not.toMatch(/\{ r: 0, label/);
  });

  it("swipes map to Again and Easy, not to out-of-range values", () => {
    expect(studyCards).toMatch(/dx < -80\) \{ grade\(el, 1\)/);
    expect(studyCards).toMatch(/dx > 80\) \{ grade\(el, 4\)/);
  });

  it("attaches the bearer token to the review request", () => {
    expect(studyScreen).toMatch(/\.\.\.authHeaders\(\)/);
    expect(studyScreen).toMatch(/Authorization|authHeaders/);
  });

  it("does not swallow a failed review", () => {
    // An empty catch made a permanently broken endpoint indistinguishable
    // from a working one.
    expect(studyScreen).not.toMatch(/\}\s*catch\s*\{\s*\}\s*\)?\s*;\s*\n\s*\}/);
    expect(studyScreen).toMatch(/onRateError/);
    expect(studyScreen).toMatch(/No se pudo guardar el repaso/);
  });

  it("throws when the server refuses, instead of returning quietly", () => {
    expect(studyScreen).toMatch(/if \(!res\.ok\)/);
    expect(studyScreen).toMatch(/throw new Error/);
  });
});

/* ------------------------------------------------------------------ *
 * No invented numbers on the study header
 * ------------------------------------------------------------------ */
describe("study header shows measured values only", () => {
  it("no longer hardcodes the streak", () => {
    // v2.35.0 shipped a literal "7".
    expect(studyScreen).not.toMatch(/<div class="m-stat-num">7<\/div>/);
  });

  it("reads the streak from the heatmap endpoint", () => {
    expect(studyScreen).toMatch(/currentStreak/);
  });

  it("drops the made-up due * 0.4 minutes formula", () => {
    // Strip line comments: the file explains the old formula in prose.
    // Strip both // and * /* *\/ block-comment lines so the file's own
    // changelog prose about the old formula does not trip the assertion.
    const code = studyScreen.replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/due \* 0\.4/);
  });

  it("shows an em dash instead of a number it does not have", () => {
    expect(studyScreen).toMatch(/streak > 0 \? streak : "—"/);
  });
});

/* ------------------------------------------------------------------ *
 * F1..F4 — auth on the client
 * ------------------------------------------------------------------ */
describe("client sends auth to the routes that now require it", () => {
  it("auth.js exports a shared header helper", () => {
    expect(auth).toMatch(/export function authHeaders/);
    expect(auth).toMatch(/Authorization.*Bearer/);
  });

  it("the study badge no longer uses a bare fetch on /flashcards", () => {
    const badge = main.slice(main.indexOf("setStudyBadge") - 600, main.indexOf("setStudyBadge"));
    expect(badge).toMatch(/authHeaders/);
    expect(badge).not.toMatch(/fetch\(`\$\{detectApiBase\(\)\}\/api\/v1\/flashcards`\)/);
  });
});

/* ------------------------------------------------------------------ *
 * F6 — the install prompt was unreachable
 * ------------------------------------------------------------------ */
describe("F6 — install prompt is actually wired", () => {
  it("registers a beforeinstallprompt listener", () => {
    expect(pwa).toMatch(/addEventListener\("beforeinstallprompt"/);
  });

  it("calls preventDefault so Chrome fires it only once", () => {
    expect(pwa).toMatch(/beforeinstallprompt[\s\S]{0,200}preventDefault\(\)/);
  });

  it("assigns the captured event to deferredPrompt", () => {
    // v2.36.0 declared the variable and read it twice but never wrote it,
    // so isInstallable() was permanently false.
    expect(pwa).toMatch(/deferredPrompt = e/);
  });

  it("handles appinstalled", () => {
    expect(pwa).toMatch(/addEventListener\("appinstalled"/);
  });

  it("registers the listener from the bootstrap path", () => {
    // Must run before the secure-context / support guards, otherwise a
    // non-HTTPS origin never becomes installable.
    const fn = pwa.slice(pwa.indexOf("export async function registerPwa"));
    const first = fn.indexOf("installPromptListener()");
    const guard = fn.indexOf('"serviceWorker" in navigator');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(guard);
  });

  it("the main entry subscribes to pwa events and renders a banner", () => {
    expect(main).toMatch(/mountPwaUi/);
    expect(main).toMatch(/onPwaEvent/);
    expect(main).toMatch(/offerInstallBanner/);
    expect(main).toMatch(/offerUpdateBanner/);
  });
});

/* ------------------------------------------------------------------ *
 * F7 — drag_gap claimed Pointer Events but used HTML5 drag
 * ------------------------------------------------------------------ */
describe("F7 — drag_gap works with a finger", () => {
  it("uses pointerdown / pointermove / pointerup", () => {
    expect(dragGap).toMatch(/addEventListener\("pointerdown"/);
    expect(dragGap).toMatch(/addEventListener\("pointermove"/);
    expect(dragGap).toMatch(/addEventListener\("pointerup"/);
  });

  it("no longer binds HTML5 drag events", () => {
    expect(dragGap).not.toMatch(/addEventListener\("dragstart"/);
    expect(dragGap).not.toMatch(/addEventListener\("dragover"/);
    expect(dragGap).not.toMatch(/addEventListener\("drop"/);
  });

  it("no longer relies on dataTransfer", () => {
    expect(dragGap).not.toMatch(/dataTransfer/);
  });

  it("drops the draggable attribute", () => {
    expect(dragGap).not.toMatch(/draggable="true"/);
  });

  it("keeps the tap-chip-then-tap-gap accessible path", () => {
    expect(dragGap).toMatch(/data-chip/);
    expect(dragGap).toMatch(/if \(selectedChip\) place\(selectedChip/);
  });

  it("sets touch-action so the page does not scroll mid-drag", () => {
    const css = read("src/styles/components.css");
    expect(css).toMatch(/m-drag-chip \{[^}]*touch-action: none/);
  });
});

/* ------------------------------------------------------------------ *
 * F8 — new card types had no renderer
 * ------------------------------------------------------------------ */
describe("F8 — multiple_choice and typed_answer are answerable", () => {
  it("dispatches on cardType", () => {
    expect(studyCards).toMatch(/function renderCardFace/);
    expect(studyCards).toMatch(/c\.cardType \|\| "basic"/);
  });

  it("renders MCQ options as a radiogroup", () => {
    expect(studyCards).toMatch(/role="radiogroup"/);
    expect(studyCards).toMatch(/data-mcq=/);
  });

  it("renders a textarea for typed answers", () => {
    expect(studyCards).toMatch(/data-typed/);
    expect(studyCards).toMatch(/Escribe tu respuesta/);
  });

  it("grades MCQ through the server, never locally", () => {
    // A client-side comparison would let a tampered client self-approve.
    expect(studyCards).toMatch(/\/api\/v1\/grade\/mcq/);
    expect(studyCards).not.toMatch(/c\.correctIndex\s*===/);
  });

  it("grades typed answers through the server", () => {
    expect(studyCards).toMatch(/\/api\/v1\/grade\/typed/);
  });

  it("shows the IA badge only when the grader really used an LLM", () => {
    expect(studyCards).toMatch(/gradedBy === "llm"/);
  });

  it("mounts the drag_gap type", () => {
    expect(studyCards).toMatch(/type === "drag_gap"/);
  });
});

/* ------------------------------------------------------------------ *
 * F9 — no dead controls
 * ------------------------------------------------------------------ */
describe("F9 — no placeholder UI left in the app", () => {
  it("the notification bell has no config button", () => {
    // There is no settings model in the backend, so the ⚙ button could
    // only ever show "próximamente". Removed rather than faked.
    expect(bell).not.toMatch(/data-config/);
    expect(bell).not.toMatch(/próximamente/);
  });

  it("the mood chart has a real readout instead of a promise", () => {
    const code = journal.replace(/^\s*\*.*$/gm, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/Hover \(próximamente\)/);
    expect(journal).toMatch(/data-mood-readout/);
  });

  it("no 'próximamente' survives in a user-facing string", () => {
    for (const [name, src] of [
      ["study_cards", studyCards],
      ["study", studyScreen],
      ["bell", bell],
      ["progress", progress],
    ]) {
      const hits = src.match(/"[^"]*próximamente[^"]*"/g) || [];
      expect(hits, `${name} still has a placeholder string`).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ *
 * F10 — startStudySession silently dropped half its options
 * ------------------------------------------------------------------ */
describe("F10 — startStudySession forwards everything", () => {
  it("passes the error callback through", () => {
    // v2.37.0: only onRate and onClose were forwarded, so the study
    // screen's "no se pudo guardar el repaso" toast was wired to nothing.
    const fn = studyCards.slice(studyCards.indexOf("export async function startStudySession"));
    expect(fn).toMatch(/onRateError: opts\.onRateError/);
    expect(fn).toMatch(/onScheduled: opts\.onScheduled/);
  });

  it("sends auth on its fallback fetch", () => {
    const fn = studyCards.slice(studyCards.indexOf("export async function startStudySession"));
    expect(fn).toMatch(/authHeaders\(\)/);
  });

  it("keeps cardType and options so the renderer can dispatch", () => {
    const fn = studyCards.slice(studyCards.indexOf("export async function startStudySession"));
    expect(fn).toMatch(/cardType: c\.cardType/);
    expect(fn).toMatch(/options: c\.options/);
  });

  it("the study screen also carries cardType through its refresh", () => {
    expect(studyScreen).toMatch(/cardType: c\.cardType \|\| "basic"/);
  });
});

/* ------------------------------------------------------------------ *
 * F11 — the decorative cards behind the top one ate every tap
 * ------------------------------------------------------------------ */
describe("F11 — only the top card is hit-testable", () => {
  it("cards behind the top one have pointer-events: none", () => {
    // The stack offsets the cards downward, so data-behind="1" covered
    // the lower half of the top card — the "Comprobar" button of a
    // typed_answer card and the rating row were unclickable.
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/\.m-study-card:not\(\[data-behind="0"\]\)\s*\{[^}]*pointer-events: none/);
  });
});

/* ------------------------------------------------------------------ *
 * Interval hints come from the card's own FSRS state
 * ------------------------------------------------------------------ */
describe("interval hints are derived, not hardcoded", () => {
  it("reads the card's stability", () => {
    expect(studyCards).toMatch(/function intervalHint/);
    expect(studyCards).toMatch(/card\?\.fsrs\?\.stability/);
  });

  it("refreshes the hints on every paint", () => {
    expect(studyCards).toMatch(/data-rate-int/);
  });
});

// tests/v238feat.test.js — v2.38.1 features.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");
const gen = read("src/screens/generate.js");
const mood = read("src/screens/mood.js");
const voice = read("src/services/voice.js");
const capture = read("src/screens/capture.js");
const main = read("src/main.js");

describe("v2.38.1 — generate", () => {
  it("is a registered route", () => {
    expect(main).toMatch(/generate: renderGenerate/);
  });
  it("lists the sources it generated from", () => {
    // "Made from your notes" is a claim you should be able to check.
    expect(gen).toMatch(/generated-from|Generado a partir de|generated from/);
    expect(gen).toMatch(/sources/);
  });
  it("does not ask for a model for the mind map", () => {
    expect(gen).toMatch(/kind === "mindmap" \? false : true/);
  });
  it("shows a model error rather than an empty result", () => {
    expect(gen).toMatch(/llmError/);
  });
  it("can save the result as a real note", () => {
    expect(gen).toMatch(/Guardar como nota/);
  });
});

describe("v2.38.1 — mood", () => {
  it("is a registered route", () => {
    expect(main).toMatch(/mood: renderMood/);
  });
  it("has no hardcoded streak", () => {
    // v2.35.0's study screen shipped a literal "7".
    expect(mood).not.toMatch(/<div class="m-stat-num">7<\/div>/);
  });
  it("shows a dash when there is nothing measured", () => {
    expect(mood).toMatch(/"—"/);
  });
  it("computes the average over logged days and says how many", () => {
    expect(mood).toMatch(/Días anotados/);
  });
  it("counts a streak that ends yesterday as alive", () => {
    // The day is not over until it is over.
    expect(mood).toMatch(/setDate\(cursor\.getDate\(\) - 1\)/);
  });
  it("uses the real endpoint, not an invented one", () => {
    expect(mood).toMatch(/\/api\/v1\/journal\/today/);
    expect(mood).toMatch(/\/journal\/\$\{j\.id\}\/mood/);
    expect(mood).not.toMatch(/journal\/mood"/);
  });
  it("reports coverage so gaps are visible", () => {
    expect(mood).toMatch(/días con registro/);
  });
});

describe("v2.38.1 — voice", () => {
  it("hides the button where the browser cannot transcribe", () => {
    // SpeechRecognition is Chromium-only. A button that silently does
    // nothing is what v2.37.0 spent a release cleaning up.
    expect(voice).toMatch(/function voiceSupport/);
    expect(capture).toMatch(/voiceSupport\(\) \?/);
  });
  it("says when recognition goes to the cloud", () => {
    // Chromium streams audio to a remote recogniser. That is worth
    // knowing before the mic opens.
    expect(voice).toMatch(/function isCloudBacked/);
    expect(capture).toMatch(/isCloudBacked\(\)/);
  });
  it("records the caret before the result arrives", () => {
    // By the time a result lands the caret may have moved, and the text
    // would go in the wrong place.
    expect(voice).toMatch(/let caret = target\.selectionStart/);
    expect(voice).toMatch(/let base = target\.value/);
  });
  it("re-applies from the base so interim text does not accumulate", () => {
    expect(voice).toMatch(/base\.slice\(0, caret\) \+ final \+ interim/);
  });
  it("translates the error codes a user can act on", () => {
    expect(voice).toMatch(/not-allowed/);
    expect(voice).toMatch(/Permiso de micrófono/);
    expect(voice).toMatch(/no-speech/);
  });
  it("stops the session when the mic is pressed again", () => {
    expect(capture).toMatch(/isListening\(\)/);
    expect(capture).toMatch(/stopDictation\(\)/);
  });
});

describe("v2.38.1 — CRDT wired into the editor", () => {
  it("notes.js reconciles blocks on open", () => {
    const notes = read("src/screens/notes.js");
    expect(notes).toMatch(/from "\.\.\/services\/noteCrdt\.js"/);
    expect(notes).toMatch(/reconcile\(/);
  });
  it("uses the real device id, not a literal", () => {
    const notes = read("src/screens/notes.js");
    expect(notes).toMatch(/getDeviceId\(\)/);
  });
});

describe("v2.38.1 — the folder selector is not decorative", () => {
  // Regression: paint() rewrites host.innerHTML, so the <select> came
  // back as "Toda la biblioteca". Choosing a folder and then tapping a
  // format sent folderId: null, and the whole library came back under
  // the heading of a folder nobody had picked. The control looked alive
  // and did nothing — the one thing the UI rules forbid.
  it("keeps the chosen folder in state, not only in the DOM", () => {
    expect(gen).toMatch(/let folderId = ""/);
    expect(gen).toMatch(/querySelector\("\[data-gen-scope\]"\)\?\.addEventListener\("change"/);
  });

  it("restores it when the screen repaints", () => {
    expect(gen).toMatch(/f\.id === folderId \? "selected" : ""/);
  });

  it("sends the stored folder, not whatever the repaint left behind", () => {
    expect(gen).toMatch(/folderId: folderId \|\| null/);
    expect(gen).not.toMatch(/folderId: host\.querySelector\("\[data-gen-scope\]"\)/);
  });

  it("keeps the topic for the same reason", () => {
    expect(gen).toMatch(/let topic = ""/);
    expect(gen).toMatch(/querySelector\("\[data-gen-topic\]"\)\?\.addEventListener\("input"/);
  });
});

describe("v2.38.1 — citation chips are references, not buttons", () => {
  // Regression: the blanket `a[href] { min-height: 44px }` WCAG rule
  // stretched an 11px citation into a 44px box under its own text.
  it("opts citations out of the touch-target minimum", () => {
    const st = read("src/styles/mobile.css");
    expect(st).toMatch(/a\.gen-cite \{ min-height: 0; \}/);
  });

  it("keeps the rule itself for real controls", () => {
    const st = read("src/styles/mobile.css");
    expect(st).toMatch(/button, a\[href\], \[role="button"\] \{\s*min-height: 44px;/);
  });
});

describe("v2.38.1 — the theme attribute wins over the OS preference", () => {
  // Regression: components.css re-declared --bg-sunken on :root with a
  // light value and only swapped it under prefers-color-scheme, so
  // choosing "dark" in Settings on a light-preference device left the
  // notes panel light while the text stayed light-theme white — note
  // titles invisible on a white background.
  const comp = read("src/styles/components.css");

  it("defines a dark override for the explicit attribute", () => {
    expect(comp).toMatch(/\[data-theme="dark"\] \{\s*--bg-sunken: #1f2126;/);
    expect(comp).toMatch(/\[data-theme="light"\] \{\s*--bg-sunken: #f4f5f7;/);
  });

  it("keeps the media query for auto", () => {
    expect(comp).toMatch(/@media \(prefers-color-scheme: dark\)/);
  });

  it("defines a dark value under the attribute, not just under the media query", () => {
    // Note: components.css (#1f2126) and tokens.css (#14171c) already
    // carried different dark values before this fix — that divergence
    // predates the release and is not what broke the screen. What broke
    // it was the attribute being ignored entirely, so the assertion is
    // behavioural: the dark value must exist for [data-theme="dark"].
    // Both branches of "auto" and the explicit attribute must land on
    // the same dark surface, or switching theme changes the colour.
    const region = comp.slice(comp.indexOf("Background states for drag-and-drop"), comp.indexOf("v2.23.3"));
    const darkAttr = region.match(/\[data-theme="dark"\] \{\s*--bg-sunken:\s*(#[0-9a-f]+)/i);
    const darkMedia = region.match(/prefers-color-scheme: dark\) \{\s*:root \{\s*--bg-sunken:\s*(#[0-9a-f]+)/i);
    expect(darkAttr).not.toBeNull();
    expect(darkMedia).not.toBeNull();
    expect(darkAttr[1].toLowerCase()).toBe(darkMedia[1].toLowerCase());
  });
});

describe("v2.38.2 — a full-screen overlay does not outlive its route", () => {
  // The study session and the floating windows are appended to <body>,
  // not to #app, so replacing app.innerHTML on a route change never
  // reached them. Start a review, tap another tab, and a full-screen
  // sheet stayed on top with no way back — the app looked frozen.
  const main = read("src/main.js");
  const cards = read("src/widgets/study_cards.js");

  it("the router announces a route change", () => {
    expect(main).toMatch(/dispatchEvent\(new CustomEvent\("mnexus:route"/);
  });

  it("the study session listens for it and closes", () => {
    expect(cards).toMatch(/addEventListener\("mnexus:route", close\)/);
    expect(cards).toMatch(/removeEventListener\("mnexus:route", close\)/);
  });

  it("closing twice is safe", () => {
    // The router event and the Escape key can both fire.
    expect(cards).toMatch(/if \(closed\) return;/);
  });

  it("floating windows are closed on the same signal", () => {
    expect(main).toMatch(/closeAllFloatingWindows/);
  });
});

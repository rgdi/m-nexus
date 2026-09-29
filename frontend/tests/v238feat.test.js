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

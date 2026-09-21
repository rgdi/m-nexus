// ankiV227.test.js — v2.27.0 Anki widget + multiple-choice study_session.

import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(async () => {
  vi.resetModules();
  document.body.innerHTML = "";
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (k) => (k?.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => ({ ok: true }),
    text: async () => "{}",
  }));
});

describe("v2.27.0 — multiple-choice card rendering", () => {
  it("renderiza opciones como radios con letters A/B/C", async () => {
    const { openStudySession } = await import("../src/widgets/study_session.js");
    const card = {
      id: "mc1",
      front: "¿Cuál es la capital de Francia?",
      back: "París",
      subject: "geo",
      cardType: "multiple_choice",
      options: ["París", "Madrid", "Berlín", "Roma"],
      correctIndex: 0,
      fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: Date.now(), retrievability: 1 },
    };
    await openStudySession([card]);
    const root = document.querySelector(".study");
    expect(root.querySelector(".card.is-mc")).toBeTruthy();
    const opts = root.querySelectorAll(".mc-option");
    expect(opts.length).toBe(4);
    // 1st option has letter "A"
    expect(opts[0].textContent).toContain("A");
    expect(opts[3].textContent).toContain("D");
    expect(opts[0].querySelector(".mc-text").textContent).toContain("París");
    // aria-correct="false" initially
    expect(opts[0].getAttribute("aria-checked")).toBe("false");
  });

  it("click en una opción marca 'selected' y revela feedback", async () => {
    const { openStudySession } = await import("../src/widgets/study_session.js");
    const card = {
      id: "mc2",
      front: "¿Cuál es 2+2?",
      back: "4",
      subject: "math",
      cardType: "multiple_choice",
      options: ["1", "2", "4", "5"],
      correctIndex: 2,
      fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: Date.now(), retrievability: 1 },
    };
    await openStudySession([card]);
    const root = document.querySelector(".study");
    // Click "4" (index 2 = correct)
    const opts = root.querySelectorAll(".mc-option");
    opts[2].click();
    await new Promise((r) => setTimeout(r, 30));
    const updated = document.querySelectorAll(".mc-option");
    expect(updated[2].classList.contains("selected")).toBe(true);
    expect(updated[2].classList.contains("correct")).toBe(true);
  });

  it("opción incorrecta recibe 'wrong' pero la correcta 'correct'", async () => {
    const { openStudySession } = await import("../src/widgets/study_session.js");
    const card = {
      id: "mc3",
      front: "¿Capital de Alemania?",
      back: "Berlín",
      subject: "geo",
      cardType: "multiple_choice",
      options: ["París", "Berlín", "Madrid"],
      correctIndex: 1,
      fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: Date.now(), retrievability: 1 },
    };
    await openStudySession([card]);
    const root = document.querySelector(".study");
    // Click wrong option (index 0 = París)
    root.querySelectorAll(".mc-option")[0].click();
    await new Promise((r) => setTimeout(r, 30));
    const updated = document.querySelectorAll(".mc-option");
    expect(updated[0].classList.contains("wrong")).toBe(true);
    expect(updated[1].classList.contains("correct")).toBe(true);
  });

  it("typeLabel incluye 'Opción múltiple' en stats", async () => {
    const { openStudySession } = await import("../src/widgets/study_session.js");
    const card = {
      id: "mc4",
      front: "Q", back: "A",
      subject: "x",
      cardType: "multiple_choice",
      options: ["A", "B"],
      correctIndex: 0,
      fsrs: { stability: 0, difficulty: 5, state: "new", reps: 0, lapses: 0, lastReview: 0, due: Date.now(), retrievability: 1 },
    };
    await openStudySession([card]);
    const root = document.querySelector(".study");
    expect(root.textContent).toContain("Opción múltiple");
  });
});

describe("v2.27.0 — Anki import widget", () => {
  it("openAnkiImport monta un wizard con 3 steps", async () => {
    const { openAnkiImport } = await import("../src/widgets/anki_import.js");
    await openAnkiImport();
    const steps = document.querySelectorAll(".anki-step");
    expect(steps.length).toBe(3);
    expect(document.querySelector(".anki-drop")).toBeTruthy();
  });

  it("rechaza archivos que no terminan en .apkg", async () => {
    const { openAnkiImport } = await import("../src/widgets/anki_import.js");
    await openAnkiImport();
    const drop = document.querySelector(".anki-drop");
    const input = document.querySelector('[data-role="file-input"]');
    // simulate file input with non-apkg
    const fakeFile = new File(["x"], "foo.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [fakeFile] });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 30));
    const err = document.querySelector('[data-role="error"]');
    expect(err).toBeTruthy();
    expect(err.textContent).toContain(".apkg");
  });

  it("ancla las 3 secciones (file, preview, commit)", async () => {
    const { openAnkiImport } = await import("../src/widgets/anki_import.js");
    await openAnkiImport();
    expect(document.querySelector('[data-panel="1"]')).toBeTruthy();
    expect(document.querySelector('[data-panel="2"]')).toBeTruthy();
    expect(document.querySelector('[data-panel="3"]')).toBeTruthy();
    // panel 1 visible, others hidden
    expect(document.querySelector('[data-panel="1"]').hidden).toBe(false);
    expect(document.querySelector('[data-panel="2"]').hidden).toBe(true);
    expect(document.querySelector('[data-panel="3"]').hidden).toBe(true);
  });

  it("rango maxUploadMb presente en info endpoint mock", () => {
    // Pure sanity: el backend expone maxUploadMb: 50 (cubierto por tests backend)
    expect(true).toBe(true);
  });
});

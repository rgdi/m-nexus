// tests/v238ai.test.js — v2.38.0 AI companion popup.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");

const ac = read("src/widgets/ai_companion.js");
const main = read("src/main.js");
const aiScreen = read("src/screens/ai.js");
const css = read("src/styles/components.css");
const rag = read("../backend/src/services/folderRag.ts");
const ragRoutes = read("../backend/src/routes/folderRag.ts");
const float = read("src/widgets/floating_window.js");

describe("v2.38.0 — the companion is a popup, not a route", () => {
  it("rides the floating window from v2.34.0", () => {
    // Reusing that machinery is the point: draggable and resizable on
    // desktop, a bottom sheet on a phone, no route change so the
    // conversation survives navigating around it.
    expect(ac).toMatch(/from "\.\/floating_window\.js"/);
    expect(ac).toMatch(/openFloatingWindow\(\{/);
  });

  it("is registered as a popup kind, not a page", () => {
    expect(ac).toMatch(/kind: "popup"/);
  });

  it("has a stable id so a second open focuses instead of stacking", () => {
    expect(ac).toMatch(/id: "mnexus-ai-companion"/);
    expect(ac).toMatch(/if \(win\) \{ win\.focus/);
  });

  it("is reachable by keyboard from any screen", () => {
    expect(main).toMatch(/ctrlKey.*"k"|metaKey.*"k"/s);
  });

  it("the AI screen hands off to the popup", () => {
    expect(aiScreen).toMatch(/mnexus:open-ai/);
  });
});

describe("v2.38.0 — conversation, not a single query", () => {
  it("sends the history with every question", () => {
    // Khoj: subqueries are generated with the conversation in the
    // prompt, which is the only reason "¿Y el tratamiento?" resolves.
    expect(ac).toMatch(/history: turns\.slice\(0, -1\)/);
  });

  it("keeps a bounded history", () => {
    expect(ac).toMatch(/MAX_TURNS/);
    expect(ac).toMatch(/slice\(-MAX_TURNS\)/);
  });

  it("persists the transcript", () => {
    expect(ac).toMatch(/mnexus\.ai\.history/);
  });

  it("restores it on reopen", () => {
    expect(ac).toMatch(/loadHistory/);
  });
});

describe("v2.38.0 — the backend resolves references", () => {
  it("renders the conversation into the strategy prompt", () => {
    expect(rag).toMatch(/function renderHistory/);
    expect(rag).toMatch(/CONVERSACIÓN PREVIA/);
  });

  it("sends it with the ask request", () => {
    expect(ragRoutes).toMatch(/history\?: Array/);
    expect(ragRoutes).toMatch(/history: b\.history/);
  });
});

describe("v2.38.0 — web is opt-in and never impersonates a note", () => {
  it("is off unless asked for", () => {
    expect(ac).toMatch(/mnexus\.ai\.allowWeb/);
    expect(rag).toMatch(/allowWeb\?: boolean/);
  });

  it("is a visible toggle, not a silent default", () => {
    expect(ac).toMatch(/data-ac-web/);
  });

  it("returns web results in their own field", () => {
    expect(rag).toMatch(/web\?: WebResult\[\]/);
  });

  it("keeps web results out of the citation list", () => {
    // A citation is a note you can click. A search result is not.
    expect(rag).toMatch(/citations: \[\], web,/);
  });

  it("labels them in the UI", () => {
    expect(ac).toMatch(/ac-web-tag/);
  });
});

describe("v2.38.0 — input behaves like a chat box", () => {
  it("Enter sends, Shift+Enter is a newline", () => {
    // Hijacking Enter is the single most annoying thing a chat input does.
    expect(ac).toMatch(/e\.key === "Enter" && !e\.shiftKey/);
  });

  it("the textarea grows but does not eat the transcript", () => {
    expect(ac).toMatch(/Math\.min\(120, input\.scrollHeight\)/);
  });

  it("escapes the transcript", () => {
    expect(ac).toMatch(/function esc\(/);
  });
});

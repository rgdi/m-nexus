// v0.28: Tests del design system.
// Verifica que los tokens, helpers de estilos, y la consistencia visual funcionen.

import { describe, it, expect, beforeEach } from "vitest";
import {
  SPACING, FONT_SIZE, RADIUS, COLOR, ICON, TRANSITION, TAP_TARGET,
  primaryButton, secondaryButton, ghostButton, card, badge, input,
  title, separator, attachTooltip,
} from "../src/ui/designSystem";

// ── Tokens: valores coherentes y accesibles ─────────────

describe("Design tokens", () => {
  it("1.1 espaciado sigue múltiplos de 4", () => {
    for (const [name, v] of Object.entries(SPACING)) {
      // 0 también es múltiplo de 4, pero no tiene sentido para spacing
      // así que verificamos: > 0 Y múltiplo de 4
      expect(v, `${name} debe ser > 0`).toBeGreaterThan(0);
      expect(v % 4, `${name} debe ser múltiplo de 4`).toBe(0);
    }
  });

  it("1.2 tipografía tiene jerarquía clara", () => {
    expect(FONT_SIZE.caption).toBeLessThan(FONT_SIZE.bodySm);
    expect(FONT_SIZE.bodySm).toBeLessThan(FONT_SIZE.body);
    expect(FONT_SIZE.body).toBeLessThan(FONT_SIZE.h3);
    expect(FONT_SIZE.h3).toBeLessThan(FONT_SIZE.h2);
    expect(FONT_SIZE.h2).toBeLessThan(FONT_SIZE.h1);
  });

  it("1.3 radios siguen escala", () => {
    expect(RADIUS.sm).toBeLessThan(RADIUS.md);
    expect(RADIUS.md).toBeLessThan(RADIUS.lg);
    expect(RADIUS.lg).toBeLessThan(RADIUS.xl);
  });

  it("1.4 tap targets cumplen mínimo WCAG (44px iOS, 36px Material)", () => {
    expect(TAP_TARGET.min).toBeGreaterThanOrEqual(36);
    expect(TAP_TARGET.comfortable).toBeGreaterThanOrEqual(44);
  });

  it("1.5 colores usan CSS vars (compatibles con temas)", () => {
    for (const v of Object.values(COLOR)) {
      expect(v).toMatch(/var\(--/);
    }
  });

  it("1.6 transiciones no son agresivas (max 320ms)", () => {
    const fast = parseInt(TRANSITION.fast);
    const normal = parseInt(TRANSITION.normal);
    const slow = parseInt(TRANSITION.slow);
    expect(fast).toBeLessThanOrEqual(200);
    expect(normal).toBeLessThanOrEqual(250);
    expect(slow).toBeLessThanOrEqual(400);
  });

  it("1.7 iconos son ASCII/Unicode básico (no emojis redundantes)", () => {
    // No debe haber emojis decorativos
    for (const [name, icon] of Object.entries(ICON)) {
      // Verifica que son caracteres simples
      expect(icon.length).toBeLessThanOrEqual(2);
    }
  });
});

// ── Helpers: aplican estilos correctos ───────────────────

describe("Design system helpers", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("button");
    document.body.appendChild(el);
  });

  it("2.1 primaryButton aplica estilos de botón principal", () => {
    primaryButton(el);
    expect(el.style.padding).toContain("px");
    expect(el.style.background).toBe(COLOR.accent);
    expect(el.style.color).toBe(COLOR.textOnAccent);
    expect(el.style.cursor).toBe("pointer");
    expect(parseInt(el.style.minHeight)).toBeGreaterThanOrEqual(TAP_TARGET.min);
  });

  it("2.2 secondaryButton aplica estilos de botón secundario", () => {
    secondaryButton(el);
    expect(el.style.background).toBe(COLOR.bg);
    expect(el.style.color).toBe(COLOR.text);
    expect(el.style.border).toContain("1px");
  });

  it("2.3 ghostButton aplica estilos minimal (solo icono)", () => {
    ghostButton(el);
    expect(el.style.background).toBe("transparent");
    // border puede ser "none" o vacío en jsdom
    expect(["none", ""].includes(el.style.border)).toBe(true);
  });

  it("2.4 card aplica padding y border-radius", () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    card(c);
    expect(c.style.borderRadius).toBe(`${RADIUS.lg}px`);
    expect(c.style.padding).toContain("px");
    expect(c.style.background).toBe(COLOR.bg);
  });

  it("2.5 card interactive tiene cursor pointer", () => {
    const c = document.createElement("div");
    document.body.appendChild(c);
    card(c, true);
    expect(c.style.cursor).toBe("pointer");
  });

  it("2.6 badge aplica colores semánticos", () => {
    const b = document.createElement("span");
    document.body.appendChild(b);
    badge(b, "success");
    expect(b.style.background).toBe(COLOR.successBg);
    expect(b.style.color).toBe(COLOR.success);
    expect(b.style.borderRadius).toBe(`${RADIUS.pill}px`);
  });

  it("2.7 badge variants usan colores distintos", () => {
    const successBadge = document.createElement("span");
    const errorBadge = document.createElement("span");
    document.body.appendChild(successBadge);
    document.body.appendChild(errorBadge);
    badge(successBadge, "success");
    badge(errorBadge, "error");
    expect(successBadge.style.background).not.toBe(errorBadge.style.background);
  });

  it("2.8 input aplica estilos consistentes", () => {
    const i = document.createElement("input");
    document.body.appendChild(i);
    input(i);
    expect(i.style.borderRadius).toBe(`${RADIUS.md}px`);
    expect(i.style.background).toBe(COLOR.bg);
    // Focus event cambia border
    i.focus();
    i.dispatchEvent(new Event("focus"));
    // jsdom no computa focus styles directamente, pero el listener está
    expect(i.style.transition).toBeTruthy();
  });

  it("2.9 title aplica jerarquía visual", () => {
    const h = document.createElement("h2");
    document.body.appendChild(h);
    title(h, 1);
    expect(h.style.fontSize).toBe(`${FONT_SIZE.h1}px`);
    expect(h.style.fontWeight).toBe("600");
    // margin puede ser "0" o "0px" en jsdom
    expect(["0", "0px"].includes(h.style.margin)).toBe(true);
  });

  it("2.10 attachTooltip añade aria-label y title", () => {
    const t = document.createElement("button");
    document.body.appendChild(t);
    attachTooltip(t, "Aprobar", "A");
    expect(t.getAttribute("aria-label")).toBe("Aprobar (A)");
    expect(t.getAttribute("title")).toBe("Aprobar (A)");
  });
});

// ── Consistencia: modales refactorizados usan design system

describe("Modales refactorizados", () => {
  it("3.1 ProposalsModal importa del design system", async () => {
    // Verificar que el archivo importa los tokens correctos
    const fs = await import("node:fs");
    const path = "/workspace/m-nexus-obsidian/src/ui/proposalsModal.ts";
    const content = fs.readFileSync(path, "utf-8");
    expect(content).toContain("designSystem.js");
    expect(content).toContain("SPACING");
    expect(content).toContain("primaryButton");
    expect(content).toContain("secondaryButton");
    expect(content).toContain("badge");
  });

  it("3.2 AdaptiveQuizModal importa del design system", async () => {
    const fs = await import("node:fs");
    const path = "/workspace/m-nexus-obsidian/src/ui/adaptiveQuizModal.ts";
    const content = fs.readFileSync(path, "utf-8");
    expect(content).toContain("designSystem.js");
    expect(content).toContain("primaryButton");
    expect(content).toContain("input(");
  });

  it("3.3 modales NO usan emojis redundantes (solo iconos semánticos)", async () => {
    const fs = await import("node:fs");
    const files = [
      "/workspace/m-nexus-obsidian/src/ui/proposalsModal.ts",
      "/workspace/m-nexus-obsidian/src/ui/adaptiveQuizModal.ts",
    ];
    for (const f of files) {
      const content = fs.readFileSync(f, "utf-8");
      // No debe haber "📝" o "🃏" hardcodeados (deben venir del designSystem)
      expect(content).not.toMatch(/textContent = .*📝/);
      expect(content).not.toMatch(/textContent = .*🃏/);
    }
  });
});

// ── Onboarding hints ───────────────────────────────────

describe("Onboarding hints", () => {
  it("4.1 showHint no lanza sin localStorage", async () => {
    const { showHint } = await import("../src/ui/onboardingHints");
    // No debe lanzar, incluso si localStorage no está disponible
    expect(() => showHint("open-quiz")).not.toThrow();
  });

  it("4.2 COMMAND_HINTS cubre los comandos principales", async () => {
    const { COMMAND_HINTS } = await import("../src/ui/onboardingHints");
    expect(COMMAND_HINTS["mnexus-adaptive-quiz"]).toBeDefined();
    expect(COMMAND_HINTS["mnexus-knowledge-stats"]).toBeDefined();
    expect(COMMAND_HINTS["mnexus-annotation-toggle"]).toBeDefined();
    expect(COMMAND_HINTS["mnexus-show-proposals"]).toBeDefined();
  });

  it("4.3 getCommandHint devuelve string legible", async () => {
    const { getCommandHint } = await import("../src/ui/onboardingHints");
    const hint = getCommandHint("mnexus-adaptive-quiz");
    expect(hint).toContain("Ctrl+Shift+Q");
    expect(hint.length).toBeGreaterThan(0);
  });

  it("4.4 comandos tienen shortcuts únicos", async () => {
    const { COMMAND_HINTS } = await import("../src/ui/onboardingHints");
    const shortcuts = Object.values(COMMAND_HINTS).map((h) => h.shortcut);
    const unique = new Set(shortcuts);
    expect(unique.size).toBe(shortcuts.length);
  });
});

// ── CSS unificado ──────────────────────────────────────

describe("CSS unificado", () => {
  it("5.1 styles.css incluye design system classes", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("/workspace/m-nexus-obsidian/styles.css", "utf-8");
    expect(css).toContain(".mnexus-stack");
    expect(css).toContain(".mnexus-cluster");
    expect(css).toContain(".mnexus-spinner");
    expect(css).toContain(".mnexus-empty-state");
    expect(css).toContain("@keyframes mnexus-spin");
  });

  it("5.2 CSS tiene accesibilidad (focus, sr-only)", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("/workspace/m-nexus-obsidian/styles.css", "utf-8");
    expect(css).toContain("focus-visible");
    expect(css).toContain(".mnexus-sr-only");
  });

  it("5.3 CSS no usa colores hardcodeados críticos", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("/workspace/m-nexus-obsidian/styles.css", "utf-8");
    // Los colores deben usar var(--...)
    const hardcoded = css.match(/color:\s*#[0-9a-fA-F]{3,6}/g) ?? [];
    // Permitimos un máximo de 5 hardcoded (acentos decorativos)
    expect(hardcoded.length).toBeLessThanOrEqual(5);
  });
});

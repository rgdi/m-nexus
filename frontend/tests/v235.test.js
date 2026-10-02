// v235.test.js — v2.35.0 mobile redesign tests.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  if (global.fetch) delete global.fetch;
});

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");

describe("v2.35.0 — mobile.css design system", () => {
  it("exists and defines the dark-first token ramp", () => {
    const path = join(process.cwd(), "src/styles/mobile.css");
    expect(existsSync(path)).toBe(true);
    const css = read("src/styles/mobile.css");
    // v2.38.24 — el morado #8b5cf6 era una SEGUNDA paleta, paralela a
    // --accent: cambiar los tokens no la movia, y por eso el boton
    // "Empezar sesion" seguia morado con todo lo demas en azul. Ahora
    // las dos rampas son el mismo azul, y el test lo fija para que no
    // vuelva a pasar.
    expect(css).toMatch(/--m-accent:\s*#2f6fed/);
    expect(css).toMatch(/--m-accent-05:\s*rgba\(47, 111, 237/);
    expect(css).not.toMatch(/139, ?92, ?246/);
    expect(css).not.toMatch(/#8b5cf6|#a78bfa|#6d28d9/);
    // The ramp must be a real ladder, not three near-identical greys.
    // v2.38.1 had #0b0b12 / #12121c / #171724 — steps of ~6/255, which on
    // a phone reads as one flat field.
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000;
    };
    const bg = (css.match(/--m-bg:\s*(#[0-9a-f]{6})/i) || [])[1];
    const card = (css.match(/--m-bg-card:\s*(#[0-9a-f]{6})/i) || [])[1];
    const card2 = (css.match(/--m-bg-card-2:\s*(#[0-9a-f]{6})/i) || [])[1];
    expect(bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(lum(card) - lum(bg)).toBeGreaterThan(8);
    expect(lum(card2) - lum(card)).toBeGreaterThan(4);
    expect(css).toMatch(/--m-shadow-lg/);
    expect(css).toMatch(/--m-r-lg/);
  });

  it("is linked from index.html", () => {
    expect(read("index.html")).toMatch(/styles\/mobile\.css/);
  });

  it("has safe-area insets for notch + home indicator", () => {
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/env\(safe-area-inset-top/);
    expect(css).toMatch(/env\(safe-area-inset-bottom/);
    expect(css).toMatch(/env\(safe-area-inset-left/);
    expect(css).toMatch(/env\(safe-area-inset-right/);
  });

  it("respects prefers-reduced-motion", () => {
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it("hides the desktop dock on mobile", () => {
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/#dock, \.dock/);
  });

  it("enforces 44px minimum touch targets", () => {
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/min-height: 44px/);
  });
});

describe("v2.35.0 — bottom tab bar", () => {
  it("bottom_tabbar.js exports mountBottomTabbar + setStudyBadge", () => {
    const src = read("src/widgets/bottom_tabbar.js");
    expect(src).toMatch(/export function mountBottomTabbar/);
    expect(src).toMatch(/export function setStudyBadge/);
  });

  it("defines exactly 5 tabs including Study and Progress", () => {
    const src = read("src/widgets/bottom_tabbar.js");
    const tabs = src.match(/id:\s*"(\w+)"/g) || [];
    expect(tabs.length).toBe(5);
    expect(src).toMatch(/#\/study/);
    expect(src).toMatch(/#\/progress/);
    expect(src).toMatch(/aria-current/);
  });

  it("has inline SVG icons for every tab", () => {
    const src = read("src/widgets/bottom_tabbar.js");
    expect(src).toMatch(/const ICONS = \{/);
    for (const k of ["home", "notes", "study", "stats", "you"]) {
      expect(src).toMatch(new RegExp(k + ":\\s*'<"));
    }
  });

  it("main.js mounts the tab bar", () => {
    expect(read("src/main.js")).toMatch(/mountBottomTabbar\(document\.body\)/);
  });
});

describe("v2.35.0 — GitHub heatmap widget", () => {
  it("github_heatmap.js exports mountHeatmap", () => {
    const src = read("src/widgets/github_heatmap.js");
    expect(src).toMatch(/export function mountHeatmap/);
    expect(src).toMatch(/api\/v1\/progress\/heatmap/);
  });

  it("renders 5 intensity levels + today marker", () => {
    const src = read("src/widgets/github_heatmap.js");
    // The legend builds all 5 levels: [0,1,2,3,4].map(lv => data-lv="${lv}")
    expect(src).toMatch(/\[0, 1, 2, 3, 4\]\.map/);
    expect(src).toMatch(/data-lv="\$\{lv\}"/);
    expect(src).toMatch(/is-today/);
  });

  it("builds a 7-row grid (GitHub convention)", () => {
    const css = read("src/styles/mobile.css");
    // 7 fixed 13px rows (not 1fr — 1fr made cells stretch to fill the container)
    expect(css).toMatch(/grid-template-rows: repeat\(7, 13px\)/);
    expect(css).toMatch(/grid-auto-flow: column/);
    expect(css).toMatch(/grid-auto-columns: 13px/);
    // Cells must not stretch
    expect(css).toMatch(/\.m-heat-cell \{[^}]*align-self: start/s);
  });

  it("shows a tooltip with reviews + minutes", () => {
    const src = read("src/widgets/github_heatmap.js");
    expect(src).toMatch(/m-heat-tip/);
    expect(src).toMatch(/reviews/);
  });
});

describe("v2.35.0 — progress charts", () => {
  it("exports line, bar, donut and sparkline", () => {
    const src = read("src/widgets/progress_charts.js");
    expect(src).toMatch(/export function mountLineChart/);
    expect(src).toMatch(/export function mountBarChart/);
    expect(src).toMatch(/export function mountDonut/);
    expect(src).toMatch(/export function sparkline/);
  });

  it("uses no chart libraries (pure SVG)", () => {
    const src = read("src/widgets/progress_charts.js");
    expect(src).not.toMatch(/from ["'](chart|d3|recharts|plotly)/i);
    expect(src).toMatch(/createElementNS|<svg/);
  });

  it("hits the right endpoints", () => {
    const src = read("src/widgets/progress_charts.js");
    expect(src).toMatch(/api\/v1\/progress\/series/);
    expect(src).toMatch(/api\/v1\/progress\/retention/);
    expect(src).toMatch(/api\/v1\/progress\/breakdown/);
  });
});

describe("v2.35.0 — study cards", () => {
  it("exports openStudySession + startStudySession", () => {
    const src = read("src/widgets/study_cards.js");
    expect(src).toMatch(/export function openStudySession/);
    expect(src).toMatch(/export async function startStudySession/);
  });

  it("has the 4 Knowunity-style ratings", () => {
    const src = read("src/widgets/study_cards.js");
    expect(src).toMatch(/De nuevo/);
    expect(src).toMatch(/Difícil/);
    expect(src).toMatch(/Bien/);
    expect(src).toMatch(/Fácil/);
    // v2.37.0: the interval labels are no longer a hardcoded table
    // ("<10m", "6d", "15d", "22d"). They are derived from the card's own
    // FSRS stability, because the scheduler now returns real intervals.
    expect(src).toMatch(/function intervalHint/);
    expect(src).toMatch(/10 min/);
    expect(src).toMatch(/22d/);
  });

  it("supports tap-to-flip + swipe gestures", () => {
    const src = read("src/widgets/study_cards.js");
    expect(src).toMatch(/is-flipped/);
    expect(src).toMatch(/pointerdown/);
    expect(src).toMatch(/pointermove/);
    expect(src).toMatch(/is-gone/);
  });
});

describe("v2.35.0 — occlusion editor", () => {
  it("exports openOcclusionEditor with 4 shape tools", () => {
    const src = read("src/widgets/occlusion_editor.js");
    expect(src).toMatch(/export async function openOcclusionEditor/);
    for (const s of ["rect", "square", "circle", "erase"]) {
      expect(src).toMatch(new RegExp('key: "' + s + '"'));
    }
  });

  it("uses normalized 0..1 coordinates", () => {
    const src = read("src/widgets/occlusion_editor.js");
    expect(src).toMatch(/clamp\(\(clientX - r\.left\) \/ r\.width, 0, 1\)/);
  });

  it("supports reveal-all test mode", () => {
    const src = read("src/widgets/occlusion_editor.js");
    expect(src).toMatch(/Revelar todo/);
    expect(src).toMatch(/is-revealed/);
  });
});

describe("v2.35.0 — new screens registered", () => {
  it("main.js has study + progress routes", () => {
    const src = read("src/main.js");
    expect(src).toMatch(/study: renderStudy/);
    expect(src).toMatch(/progress: renderProgress/);
  });

  it("study screen has the big display title", () => {
    const src = read("src/screens/study.js");
    expect(src).toMatch(/m-display/);
    expect(src).toMatch(/TARJETAS/);
    expect(src).toMatch(/DE ESTUDIO/);
  });

  it("progress screen has all 3 charts + heatmap", () => {
    const src = read("src/screens/progress.js");
    expect(src).toMatch(/mountHeatmap/);
    expect(src).toMatch(/mountLineChart/);
    expect(src).toMatch(/mountBarChart/);
    expect(src).toMatch(/mountDonut/);
    expect(src).toMatch(/MI PROGRESO/);
  });
});

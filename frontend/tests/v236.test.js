// v236.test.js — v2.36.0 PWA + logging tests.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const read = (p) => readFileSync(join(process.cwd(), p), "utf-8");

beforeEach(() => {
  document.body.innerHTML = "";
  try { localStorage.clear(); } catch {}
});

describe("v2.36.0 — service worker", () => {
  it("sw.js exists and has a real cache version", () => {
    const path = join(process.cwd(), "sw.js");
    expect(existsSync(path)).toBe(true);
    const src = read("sw.js");
    expect(src).toMatch(/const VERSION = "v2\.\d+\.\d+"/);
  });

  it("does NOT use glob patterns in the precache list (the v2.0.0 bug)", () => {
    const src = read("sw.js");
    // Extract just the SHELL array literal and assert no `*` inside it.
    const m = src.match(/const SHELL = \[([\s\S]*?)\];/);
    expect(m).toBeTruthy();
    expect(m[1]).not.toContain("*");
    // And the install handler must add entries one by one.
    expect(src).toMatch(/cache\.add\(new Request/);
    expect(src).not.toMatch(/caches\.open\(CACHE\)\.then\(\(c\) => c\.addAll/);
  });

  it("precaches every real shell file explicitly", () => {
    const src = read("sw.js");
    for (const f of [
      "./index.html", "./manifest.json", "./src/main.js",
      "./src/styles/mobile.css", "./src/styles/base.css",
    ]) {
      expect(src).toContain(`"${f}"`);
    }
  });

  it("navigation is network-first with a cached shell fallback", () => {
    const src = read("sw.js");
    expect(src).toMatch(/req\.mode === "navigate"/);
    expect(src).toMatch(/cache\.match\("\.\/index\.html"\)/);
  });

  it("never caches API calls", () => {
    const src = read("sw.js");
    expect(src).toMatch(/url\.pathname\.startsWith\("\/api\/"\)\) return/);
  });

  it("does not intercept WebSocket upgrades", () => {
    const src = read("sw.js");
    expect(src).toMatch(/upgrade.*websocket/);
  });

  it("handles Background Sync with the outbox tag", () => {
    const src = read("sw.js");
    expect(src).toMatch(/addEventListener\("sync"/);
    expect(src).toMatch(/SYNC_TAG = "mnexus-outbox-sync"/);
    expect(src).toMatch(/mnexus-sync-request/);
  });

  it("cleans up old caches on activate", () => {
    const src = read("sw.js");
    expect(src).toMatch(/addEventListener\("activate"/);
    expect(src).toMatch(/caches\.delete/);
    expect(src).toMatch(/clients\.claim/);
  });
});

describe("v2.36.0 — pwa.js registration module", () => {
  it("exports the registration + install API", () => {
    const src = read("src/services/pwa.js");
    expect(src).toMatch(/export async function registerPwa/);
    expect(src).toMatch(/export function isInstallable/);
    expect(src).toMatch(/export function isStandalone/);
    expect(src).toMatch(/export async function promptInstall/);
    expect(src).toMatch(/export async function applyUpdate/);
    expect(src).toMatch(/export async function requestBackgroundSync/);
  });

  it("captures beforeinstallprompt", () => {
    const src = read("src/services/pwa.js");
    expect(src).toMatch(/deferredPrompt/);
  });

  it("bails out on insecure contexts (SW requires https)", () => {
    const src = read("src/services/pwa.js");
    expect(src).toMatch(/window\.isSecureContext/);
  });

  it("main.js registers the PWA on boot", () => {
    const src = read("src/main.js");
    expect(src).toMatch(/services\/pwa\.js/);
    expect(src).toMatch(/registerPwa/);
  });
});

describe("v2.36.0 — offline queue gains drainNow", () => {
  it("exports drainNow for Background Sync", () => {
    const src = read("src/services/offline_queue.js");
    expect(src).toMatch(/export async function drainNow/);
  });

  it("emits an event when the outbox changes so the SW can re-register", () => {
    const src = read("src/services/offline_queue.js");
    expect(src).toMatch(/mnexus-outbox-changed/);
  });

  it("pwa.js listens for that event and requests a sync", () => {
    const src = read("src/services/pwa.js");
    expect(src).toMatch(/mnexus-outbox-changed/);
    expect(src).toMatch(/requestBackgroundSync/);
  });
});

describe("v2.36.0 — manifest is installable", () => {
  const m = JSON.parse(read("manifest.json"));

  it("has the fields Chrome requires", () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBeTruthy();
    expect(m.display).toBe("standalone");
  });

  it("ships 192 + 512 icons in any and maskable purposes", () => {
    const sizes = m.icons.map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes.some((s) => s.startsWith("192x192") && s.endsWith("any"))).toBe(true);
    expect(sizes.some((s) => s.startsWith("512x512") && s.endsWith("any"))).toBe(true);
    expect(sizes.some((s) => s.includes("maskable"))).toBe(true);
  });

  it("the referenced icon files actually exist on disk", () => {
    for (const icon of m.icons) {
      if (icon.src.endsWith(".svg")) continue;
      const p = join(process.cwd(), icon.src.replace(/^\//, ""));
      expect(existsSync(p), `${icon.src} missing`).toBe(true);
    }
  });

  it("declares app shortcuts", () => {
    expect(Array.isArray(m.shortcuts)).toBe(true);
    expect(m.shortcuts.length).toBeGreaterThanOrEqual(3);
    expect(m.shortcuts.some((s) => s.url.includes("/study"))).toBe(true);
    expect(m.shortcuts.some((s) => s.url.includes("/progress"))).toBe(true);
  });

  it("theme colour matches the mobile.css dark background", () => {
    expect(m.theme_color).toBe("#0b0b12");
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/--m-bg:\s*#0b0b12/);
  });
});

describe("v2.36.0 — index.html PWA meta", () => {
  const html = read("index.html");
  it("has apple-touch-icon", () => expect(html).toMatch(/apple-touch-icon/));
  it("has apple-mobile-web-app-capable", () => expect(html).toMatch(/apple-mobile-web-app-capable/));
  it("theme-color matches the manifest", () => expect(html).toMatch(/name="theme-color" content="#0b0b12"/));
});

describe("v2.36.0 — structured logging is available", () => {
  it("pwa.js exposes createLogger with level gating", () => {
    const src = read("src/services/pwa.js");
    expect(src).toMatch(/export function createLogger/);
    expect(src).toMatch(/debug:/);
    expect(src).toMatch(/info:/);
    expect(src).toMatch(/warn:/);
    expect(src).toMatch(/error:/);
  });

  it("debug logging is opt-in via localStorage", () => {
    const src = read("src/services/pwa.js");
    expect(src).toMatch(/mnexus\.debug/);
  });
});

describe("v2.36.0 — drag-gap exercise", () => {
  it("drag_gap.js exports openDragGap", () => {
    const src = read("src/widgets/drag_gap.js");
    expect(src).toMatch(/export function openDragGap/);
  });

  it("supports both pointer (drag) and tap-then-tap (accessible) placement", () => {
    const src = read("src/widgets/drag_gap.js");
    expect(src).toMatch(/dragstart/);
    expect(src).toMatch(/addEventListener\("drop"/);
    expect(src).toMatch(/selectedChip/); // tap-to-select path
    expect(src).toMatch(/role="button"/);  // keyboard-reachable slots
  });

  it("reports per-gap correctness and duration to onComplete", () => {
    const src = read("src/widgets/drag_gap.js");
    expect(src).toMatch(/onComplete/);
    expect(src).toMatch(/perGap/);
    expect(src).toMatch(/durationMs/);
  });

  it("shuffles chips so the answer is not always first", () => {
    const src = read("src/widgets/drag_gap.js");
    expect(src).toMatch(/shuffle/);
  });

  it("mobile.css styles the slots, chips and shake/pop animations", () => {
    const css = read("src/styles/mobile.css");
    expect(css).toMatch(/\.m-drag-gap-slot/);
    expect(css).toMatch(/\.m-drag-chip/);
    expect(css).toMatch(/@keyframes m-slot-shake/);
    expect(css).toMatch(/@keyframes m-slot-pop/);
  });
});

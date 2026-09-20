// v2220.test.js — v2.22.0 frontend additions:
// - safe_areas.js (notch/cutout detection)
// - hamburger redesign (FAB + app-drawer)
// - per-subject foreground color via --fg-on-subj-X
// - touch target bump to 44px on coarse pointer

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = (p) => join(process.cwd(), "..", p);

describe("v2.22.0 — safe_areas.js", () => {
  it("exports detectSafeAreas + installSafeAreas + safePositionFor", () => {
    const src = readFileSync(SRC("frontend/src/services/safe_areas.js"), "utf-8");
    expect(src).toMatch(/export function detectSafeAreas/);
    expect(src).toMatch(/export function installSafeAreas/);
    expect(src).toMatch(/export function safePositionFor/);
  });

  it("reads CSS env() values via probe element", () => {
    const src = readFileSync(SRC("frontend/src/services/safe_areas.js"), "utf-8");
    expect(src).toMatch(/env\(safe-area-inset-top/);
    expect(src).toMatch(/getComputedStyle/);
  });

  it("detects notch / camera / gesture bar from insets", () => {
    const src = readFileSync(SRC("frontend/src/services/safe_areas.js"), "utf-8");
    expect(src).toMatch(/hasNotch\s*=/);
    expect(src).toMatch(/hasCameraCutout\s*=/);
    expect(src).toMatch(/hasGestureBar\s*=/);
  });

  it("exposes window.MNEXUS_SAFE_AREAS frozen object", () => {
    const src = readFileSync(SRC("frontend/src/services/safe_areas.js"), "utf-8");
    expect(src).toMatch(/window\.MNEXUS_SAFE_AREAS\s*=/);
    expect(src).toMatch(/Object\.freeze/);
  });

  it("updates on resize + orientationchange", () => {
    const src = readFileSync(SRC("frontend/src/services/safe_areas.js"), "utf-8");
    expect(src).toMatch(/window\.addEventListener\("resize"/);
    expect(src).toMatch(/orientationchange/);
    expect(src).toMatch(/visualViewport/);
  });
});

describe("v2.22.0 — safe area tokens", () => {
  it("declares --safe-top, --safe-right, --safe-bottom, --safe-left", () => {
    const src = readFileSync(SRC("frontend/src/styles/tokens.css"), "utf-8");
    expect(src).toMatch(/--safe-top:\s*env\(safe-area-inset-top, 0px\)/);
    expect(src).toMatch(/--safe-right:\s*env\(safe-area-inset-right, 0px\)/);
    expect(src).toMatch(/--safe-bottom:\s*env\(safe-area-inset-bottom, 0px\)/);
    expect(src).toMatch(/--safe-left:\s*env\(safe-area-inset-left, 0px\)/);
  });

  it("declares hit-target size tokens", () => {
    const src = readFileSync(SRC("frontend/src/styles/tokens.css"), "utf-8");
    expect(src).toMatch(/--hit-target-min:\s*44px/);
    expect(src).toMatch(/--hit-target-coarse:\s*48px/);
    expect(src).toMatch(/--hit-target-desktop:\s*36px/);
  });
});

describe("v2.22.0 — subject foreground colors", () => {
  it("each --subj-X has matching --fg-on-subj-X", () => {
    const src = readFileSync(SRC("frontend/src/styles/tokens.css"), "utf-8");
    const subs = ["red", "yellow", "blue", "purple", "green", "pink", "orange", "teal", "gray"];
    for (const s of subs) {
      expect(src).toMatch(new RegExp(`--subj-${s}:`));
      expect(src).toMatch(new RegExp(`--fg-on-subj-${s}:`));
    }
  });
});

describe("v2.22.0 — hamburger FAB", () => {
  it("is in index.html with hamburger-fab class", () => {
    const src = readFileSync(SRC("frontend/public/index.html"), "utf-8");
    expect(src).toMatch(/<button class="hamburger-fab"/);
    expect(src).toMatch(/aria-label="Open menu"/);
  });

  it("uses bottom-left safe-area positioning in CSS", () => {
    const src = readFileSync(SRC("frontend/src/styles/layout.css"), "utf-8");
    expect(src).toMatch(/\.hamburger-fab \{[\s\S]*bottom:\s*calc\(var\(--safe-bottom\)/);
    expect(src).toMatch(/\.hamburger-fab \{[\s\S]*left:\s*calc\(var\(--safe-left\)/);
  });

  it("is sized at 56×56 (exceeds WCAG 44px touch target)", () => {
    const src = readFileSync(SRC("frontend/src/styles/layout.css"), "utf-8");
    expect(src).toMatch(/\.hamburger-fab \{[\s\S]*width:\s*56px/);
    expect(src).toMatch(/\.hamburger-fab \{[\s\S]*height:\s*56px/);
  });

  it("is hidden on desktop (mouse-only context)", () => {
    const src = readFileSync(SRC("frontend/src/styles/layout.css"), "utf-8");
    expect(src).toMatch(/@media \(hover: hover\) and \(pointer: fine\) and \(min-width: 720px\)[\s\S]*\.hamburger-fab\s*\{\s*display:\s*none/);
  });

  it("main.js wires the click to openAppDrawer / closeAppDrawer", () => {
    const src = readFileSync(SRC("frontend/src/main.js"), "utf-8");
    expect(src).toMatch(/function openAppDrawer\(\)/);
    expect(src).toMatch(/function closeAppDrawer\(\)/);
    expect(src).toMatch(/function toggleAppDrawer/);
    expect(src).toMatch(/aria-expanded/);
  });
});

describe("v2.22.0 — app drawer", () => {
  it("has scrim + slide-in transition", () => {
    const src = readFileSync(SRC("frontend/src/styles/layout.css"), "utf-8");
    expect(src).toMatch(/\.app-drawer-scrim/);
    expect(src).toMatch(/\.app-drawer\s*\{[\s\S]*transform:\s*translateX\(-100%\)/);
    expect(src).toMatch(/\.app-drawer\[aria-hidden="false"\][\s\S]*transform:\s*translateX\(0\)/);
  });

  it("respects prefers-reduced-motion", () => {
    const src = readFileSync(SRC("frontend/src/styles/layout.css"), "utf-8");
    expect(src).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.app-drawer/);
  });

  it("closes on ESC key", () => {
    const src = readFileSync(SRC("frontend/src/main.js"), "utf-8");
    expect(src).toMatch(/if \(e\.key === "Escape"\)/);
  });

  it("focuses close button on open for keyboard a11y", () => {
    const src = readFileSync(SRC("frontend/src/main.js"), "utf-8");
    expect(src).toMatch(/app-drawer-close.*focus/);
  });
});

describe("v2.22.0 — focus-visible prominence", () => {
  it("uses 3px outline + offset for keyboard focus", () => {
    const src = readFileSync(SRC("frontend/src/styles/base.css"), "utf-8");
    expect(src).toMatch(/:focus-visible\s*\{[\s\S]*outline:\s*3px solid var\(--accent\)/);
    expect(src).toMatch(/:focus-visible\s*\{[\s\S]*outline-offset:\s*3px/);
  });

  it("removes outline on mouse click (focus-visible only)", () => {
    const src = readFileSync(SRC("frontend/src/styles/base.css"), "utf-8");
    expect(src).toMatch(/:focus:not\(:focus-visible\)/);
  });
});

describe("v2.22.0 — touch target bump", () => {
  it("sets 44px on small buttons / seg / tab in coarse-pointer media query", () => {
    const src = readFileSync(SRC("frontend/src/styles/base.css"), "utf-8");
    const block = src.match(/@media \(pointer: coarse\) \{([\s\S]+?)\n\}/);
    expect(block).toBeTruthy();
    const body = block[1];
    expect(body).toMatch(/\.btn\.small \{ height: var\(--hit-target-min\)/);
    expect(body).toMatch(/min-height: 44px/);
  });
});

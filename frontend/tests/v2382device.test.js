// tests/v2382device.test.js — telling a tablet from a laptop.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dev = readFileSync(join(process.cwd(), "src/services/device.js"), "utf-8");
const css = readFileSync(join(process.cwd(), "src/styles/mobile.css"), "utf-8");
const html = readFileSync(join(process.cwd(), "index.html"), "utf-8");

describe("v2.38.2 — a tablet is not a laptop with a wide screen", () => {
  it("detects an iPad, not just a width", () => {
    // iPadOS 13+ sends a desktop macOS user agent. Width alone files an
    // iPad Pro as a laptop and hands it a desktop layout on a phone's
    // worth of usable space.
    expect(dev).toMatch(/Macintosh\|Mac OS X/);
    expect(dev).toMatch(/maxTouchPoints/);
    expect(dev).toMatch(/iPad/);
  });

  it("requires touch before believing a Mac is an iPad", () => {
    // No real Mac reports touch points; a desktop pretending to be an
    // iPad would get the tablet layout it has no business having.
    expect(dev).toMatch(/isMacUA && maxTouch > 1/);
  });

  it("mirrors the kind onto the document for CSS", () => {
    expect(dev).toMatch(/setAttribute\("data-device"/);
    // The four kinds the CSS branches on.
    for (const k of ["ipad", "tablet", "phone", "desktop"]) {
      expect(dev).toContain('"' + k + '"');
    }
  });

  it("keeps the width tier for cases it is good for", () => {
    expect(dev).toMatch(/_tier\(w\)/);
    expect(dev).toMatch(/return "tablet"/);
  });
});

describe("v2.38.2 — the tablet tier actually exists in CSS", () => {
  it("branches on the device, not on a width query", () => {
    // A width query cannot tell an iPad from a laptop, so it must not
    // be what decides this.
    expect(css).toMatch(/\[data-device="tablet"\]/);
    expect(css).toMatch(/\[data-device="ipad"\]/);
  });

  it("hides the in-page title on touch devices", () => {
    // On every touch device the app bar is the header; the screen's own
    // heading is a duplicate and, at 820px, it drew under the bar.
    expect(css).toMatch(/\[data-device="ipad"\]\s*\.screen-header h1 \{ display: none; \}/);
  });

  it("sizes the notes rail for touch rather than for a monitor", () => {
    expect(css).toMatch(/\[data-device="ipad"\]\s*\.notes-with-sidebar/);
  });
});

describe("v2.38.2 — installable on iOS, where the manifest is mostly ignored", () => {
  it("has the Apple meta tags", () => {
    expect(html).toMatch(/apple-mobile-web-app-capable/);
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style/);
    expect(html).toMatch(/apple-mobile-web-app-title/);
  });

  it("names the app for the home screen", () => {
    expect(html).toMatch(/<meta name="application-name" content="M-NEXUS"/);
  });

  it("has one theme-color, and it is the background", () => {
    // There were two, and the first was a colour the app never paints.
    const hits = html.match(/name="theme-color" content="(#[0-9a-f]+)"/gi) || [];
    expect(hits.length).toBe(1);
    expect(hits[0]).toMatch(/#08080e/i);
  });
});

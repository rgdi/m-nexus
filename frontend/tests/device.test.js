/* ============================================================
 * device.test.js — Unit tests for device detection.
 * v2.5.0 W6 — covers responsive logic for adaptive UI.
 *
 * Note: window.matchMedia polyfill is in tests/setup.js (runs before imports).
 * ============================================================ */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { device, setTheme, startDeviceWatch } from "../src/services/device.js";

describe("device.js — device detection", () => {
  describe("_tier() — breakpoint tier", () => {
    it("returns 'tiny' for <=360px (compact phones)", () => {
      expect(device._tier(360)).toBe("tiny");
      expect(device._tier(320)).toBe("tiny");
    });

    it("returns 'phone' for 361-480px (large phones)", () => {
      expect(device._tier(361)).toBe("phone");
      expect(device._tier(414)).toBe("phone");
      expect(device._tier(480)).toBe("phone");
    });

    it("returns 'phablet' for 481-719px (small tablets)", () => {
      expect(device._tier(481)).toBe("phablet");
      expect(device._tier(600)).toBe("phablet");
      expect(device._tier(719)).toBe("phablet");
    });

    it("returns 'tablet' for 720-1099px (primary target)", () => {
      expect(device._tier(720)).toBe("tablet");
      expect(device._tier(1024)).toBe("tablet");
      expect(device._tier(1099)).toBe("tablet");
    });

    it("returns 'laptop' for 1100-1439px", () => {
      expect(device._tier(1100)).toBe("laptop");
      expect(device._tier(1280)).toBe("laptop");
      expect(device._tier(1439)).toBe("laptop");
    });

    it("returns 'desktop' for >=1440px (ultra-wide)", () => {
      expect(device._tier(1440)).toBe("desktop");
      expect(device._tier(1920)).toBe("desktop");
    });
  });

  describe("isTablet detection", () => {
    it("returns true for 720-1099px", () => {
      expect(device._tier(720) === "tablet").toBe(true);
      expect(device._tier(1024) === "tablet").toBe(true);
      expect(device._tier(1099) === "tablet").toBe(true);
    });

    it("returns false for phones and desktop", () => {
      expect(device._tier(390) === "tablet").toBe(false); // mobile
      expect(device._tier(1280) === "tablet").toBe(false); // laptop
      expect(device._tier(1920) === "tablet").toBe(false); // desktop
    });
  });

  describe("bodyClasses() — CSS class names", () => {
    it("returns non-empty string", () => {
      const classes = device.bodyClasses();
      expect(classes.length).toBeGreaterThan(0);
      expect(typeof classes).toBe("string");
    });

    it("includes dpr class", () => {
      expect(device.bodyClasses()).toMatch(/dpr-\d+x/);
    });

    it("includes tier class", () => {
      expect(device.bodyClasses()).toMatch(/tier-\w+/);
    });

    it("includes orientation class", () => {
      expect(device.bodyClasses()).toMatch(/orient-\w+/);
    });

    it("includes either touch or mouse class", () => {
      const classes = device.bodyClasses();
      expect(classes).toMatch(/(touch|mouse)/);
    });

    it("includes online/offline class", () => {
      expect(device.bodyClasses()).toMatch(/(online|offline)/);
    });

    it("filters out empty strings", () => {
      // Should not have double spaces or empty tokens
      const classes = device.bodyClasses();
      expect(classes).not.toMatch(/\s{2,}/);
      expect(classes.split(" ").every((c) => c.length > 0)).toBe(true);
    });
  });

  describe("values getter", () => {
    it("returns a copy (not reference)", () => {
      const v1 = device.values;
      v1.foo = "bar";
      const v2 = device.values;
      expect(v2.foo).toBeUndefined();
    });

    it("includes all required fields", () => {
      const v = device.values;
      expect(v).toHaveProperty("dpr");
      expect(v).toHaveProperty("width");
      expect(v).toHaveProperty("height");
      expect(v).toHaveProperty("orientation");
      expect(v).toHaveProperty("isTouch");
      expect(v).toHaveProperty("isMouse");
      expect(v).toHaveProperty("canHover");
      expect(v).toHaveProperty("prefersDark");
      expect(v).toHaveProperty("prefersLight");
      expect(v).toHaveProperty("isTablet");
      expect(v).toHaveProperty("prefersReducedMotion");
      expect(v).toHaveProperty("online");
      expect(v).toHaveProperty("tier");
    });
  });

  describe("subscribe() — listener pattern", () => {
    it("calls listener immediately with current values", () => {
      let called = false;
      let received = null;
      device.subscribe((v) => {
        called = true;
        received = v;
      });
      expect(called).toBe(true);
      expect(received).toBeTruthy();
      expect(received.tier).toBeTruthy();
    });

    it("returns unsubscribe function", () => {
      let count = 0;
      const unsub = device.subscribe(() => count++);
      unsub();
      const before = count;
      device._onChange();
      expect(count).toBe(before);
    });

    it("notifies all listeners on change", () => {
      let a = 0, b = 0;
      device.subscribe(() => a++);
      device.subscribe(() => b++);
      device._onChange();
      expect(a).toBeGreaterThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("device.js — setTheme()", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("sets data-theme='light' for light", () => {
    setTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("sets data-theme='dark' for dark", () => {
    setTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("removes data-theme for 'auto'", () => {
    document.documentElement.dataset.theme = "light";
    setTheme("auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe("device.js — startDeviceWatch()", () => {
  it("applies body classes immediately", () => {
    startDeviceWatch();
    expect(document.body.className.length).toBeGreaterThan(0);
  });

  it("returns an unsubscribe function", () => {
    const unsub = startDeviceWatch();
    expect(typeof unsub).toBe("function");
    if (typeof unsub === "function") unsub();
  });
});

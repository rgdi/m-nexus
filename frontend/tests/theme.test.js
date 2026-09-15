/* ============================================================
 * theme.test.js — Unit tests for theme.js.
 * v2.2.0 W6 — verifies theme persistence + data-theme attribute.
 * ============================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import { storage } from "../src/services/storage.js";
import { getTheme, setTheme, applyTheme } from "../src/services/theme.js";

describe("theme.js — theme control", () => {
  beforeEach(() => {
    storage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  describe("getTheme", () => {
    it("defaults to 'auto' when no preference saved", () => {
      expect(getTheme()).toBe("auto");
    });

    it("returns saved preference", () => {
      // theme.js reads raw string (legacy impl), so we set directly
      localStorage.setItem("mnexus.theme", "dark");
      expect(getTheme()).toBe("dark");
    });
  });

  describe("setTheme", () => {
    it("persists the choice", () => {
      setTheme("dark");
      expect(getTheme()).toBe("dark");
    });

    it("applies data-theme attribute on html", () => {
      setTheme("dark");
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

      setTheme("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("removes data-theme attribute when 'auto'", () => {
      setTheme("dark");
      setTheme("auto");
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    });
  });

  describe("applyTheme", () => {
    it("respects existing localStorage value", () => {
      localStorage.setItem("mnexus.theme", "light");
      applyTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });

    it("clears attribute when no saved value (auto)", () => {
      localStorage.removeItem("mnexus.theme");
      applyTheme();
      expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    });
  });
});

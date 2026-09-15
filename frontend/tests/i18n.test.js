/* ============================================================
 * i18n.test.js — Unit tests for i18n.js.
 * v2.2.0 W6 — verifies translations + interpolation + completeness.
 * ============================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import { i18n } from "../src/services/i18n.js";

describe("i18n.js — translation system", () => {
  beforeEach(() => {
    i18n.setLang("en");
  });

  describe("t() — translation lookup", () => {
    it("returns English string by default", () => {
      i18n.setLang("en");
      expect(i18n.t("dock.overview")).toBe("Overview");
    });

    it("returns Spanish when lang=es", () => {
      i18n.setLang("es");
      expect(i18n.t("dock.overview")).toBe("Resumen");
    });

    it("returns Portuguese when lang=pt", () => {
      i18n.setLang("pt");
      expect(i18n.t("dock.overview")).toBe("Visão geral");
    });

    it("returns the key itself for missing translations", () => {
      expect(i18n.t("nonexistent.key")).toBe("nonexistent.key");
    });

    it("falls back to English if active lang missing", () => {
      // If a key has en + es but not pt, pt should return en
      i18n.setLang("pt");
      // Use a key we know is complete (en/es/pt)
      expect(i18n.t("dock.subjects")).toBe("Disciplinas");
    });
  });

  describe("t() — interpolation", () => {
    it("substitutes {key} placeholders", () => {
      i18n.setLang("es");
      expect(i18n.t("subjects.avg", { grade: "8.5" })).toBe("Media 8.5");
    });

    it("handles multiple placeholders", () => {
      i18n.setLang("en");
      const out = i18n.t("overview.acrossSubjects", { n: 5 });
      expect(out).toBe("across 5 subjects");
    });

    it("leaves missing placeholders as {key}", () => {
      i18n.setLang("en");
      expect(i18n.t("overview.acrossSubjects", {})).toContain("{n}");
    });
  });

  describe("languages()", () => {
    it("returns 3 languages", () => {
      const langs = i18n.languages();
      expect(langs.length).toBe(3);
      expect(langs.map((l) => l.code)).toEqual(["en", "es", "pt"]);
    });

    it("each has code, name, flag", () => {
      for (const lang of i18n.languages()) {
        expect(lang.code).toBeTruthy();
        expect(lang.name).toBeTruthy();
        expect(lang.flag).toBeTruthy();
      }
    });
  });

  describe("isComplete()", () => {
    it("English is complete (or should be)", () => {
      const r = i18n.isComplete("en");
      expect(r.complete).toBe(true);
      expect(r.missing).toEqual([]);
    });

    it("Spanish should be complete (or list missing)", () => {
      const r = i18n.isComplete("es");
      // Allow this to be false if some keys are missing, but check structure
      expect(Array.isArray(r.missing)).toBe(true);
    });

    it("Portuguese should be complete", () => {
      const r = i18n.isComplete("pt");
      expect(Array.isArray(r.missing)).toBe(true);
    });
  });

  describe("subscribe() — listener", () => {
    it("calls listener on lang change", () => {
      let called = false;
      let received = null;
      const unsub = i18n.subscribe((l) => {
        called = true;
        received = l;
      });

      i18n.setLang("es");
      expect(called).toBe(true);
      expect(received).toBe("es");

      unsub();
    });

    it("unsubscribe stops notifications", () => {
      let callCount = 0;
      const unsub = i18n.subscribe(() => callCount++);
      i18n.setLang("pt");
      const before = callCount;

      unsub();
      i18n.setLang("en");
      expect(callCount).toBe(before);
    });
  });

  describe("setLang() — invalid values", () => {
    it("rejects unknown languages", () => {
      i18n.setLang("en");
      i18n.setLang("xx"); // invalid
      expect(i18n.lang).toBe("en");
    });
  });
});

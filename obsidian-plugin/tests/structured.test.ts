// Tests para Notion-style structured notes (v0.33).
// Incluyen fault-injection y edge cases.

import { describe, it, expect } from "vitest";
import { evalFormula as evaluateFormula, validatePropertyValue as validateValue, applyFilters, applySorts, groupBy } from "../src/structured/validate";

describe("Notion-style structured notes", () => {
  describe("validateValue", () => {
    it("accepts a text", () => {
      const r = validateValue({ name: "t", type: "text" }, "hola");
      expect(r.ok).toBe(true);
    });
    it("rejects text type with a number", () => {
      const r = validateValue({ name: "t", type: "text" }, 42);
      expect(r.ok).toBe(false);
    });
    it("accepts a number", () => {
      const r = validateValue({ name: "n", type: "number" }, "3.14");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.coerced).toBe(3.14);
    });
    it("rejects NaN", () => {
      const r = validateValue({ name: "n", type: "number" }, "no soy número");
      expect(r.ok).toBe(false);
    });
    it("accepts select with options", () => {
      const r = validateValue(
        { name: "s", type: "select", options: ["a", "b"] },
        "a"
      );
      expect(r.ok).toBe(true);
    });
    it("rejects select with bad option", () => {
      const r = validateValue(
        { name: "s", type: "select", options: ["a", "b"] },
        "c"
      );
      expect(r.ok).toBe(false);
    });
    it("accepts multi array", () => {
      const r = validateValue(
        { name: "m", type: "multi", options: ["x", "y"] },
        ["x", "y"]
      );
      expect(r.ok).toBe(true);
    });
    it("rejects multi with bad value", () => {
      const r = validateValue(
        { name: "m", type: "multi", options: ["x", "y"] },
        ["x", "z"]
      );
      expect(r.ok).toBe(false);
    });
    it("rejects formula assigned directly", () => {
      const r = validateValue({ name: "f", type: "formula" }, "valor");
      expect(r.ok).toBe(false);
    });
    it("accepts valid URL", () => {
      const r = validateValue({ name: "u", type: "url" }, "https://example.com");
      expect(r.ok).toBe(true);
    });
    it("rejects invalid URL", () => {
      const r = validateValue({ name: "u", type: "url" }, "no es url");
      expect(r.ok).toBe(false);
    });
    it("rejects invalid email", () => {
      const r = validateValue({ name: "e", type: "email" }, "no es email");
      expect(r.ok).toBe(false);
    });
    it("respects required", () => {
      const r = validateValue({ name: "t", type: "text", required: true }, undefined);
      expect(r.ok).toBe(false);
    });
    it("uses default when missing", () => {
      const r = validateValue(
        { name: "t", type: "text", default: "auto" },
        undefined
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.coerced).toBe("auto");
    });
  });

  describe("evaluateFormula", () => {
    it("evaluates today()", () => {
      const r = evaluateFormula("today()", {});
      expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("evaluates now()", () => {
      const r = evaluateFormula("now()", {});
      expect(typeof r).toBe("number");
    });
    it("evaluates upper", () => {
      expect(evaluateFormula('upper("hola")', {})).toBe("HOLA");
    });
    it("evaluates lower", () => {
      expect(evaluateFormula('lower("HOLA")', {})).toBe("hola");
    });
    it("evaluates length", () => {
      expect(evaluateFormula('length("abcd")', {})).toBe(4);
    });
    it("evaluates concat", () => {
      expect(evaluateFormula('concat("a", "b", "c")', {})).toBe("abc");
    });
    it("evaluates abs", () => {
      expect(evaluateFormula("abs(-5)", {})).toBe(5);
    });
    it("evaluates round", () => {
      expect(evaluateFormula("round(3.7)", {})).toBe(4);
    });
    it("evaluates if true", () => {
      expect(evaluateFormula('if(1, "yes", "no")', {})).toBe("yes");
    });
    it("evaluates if false", () => {
      expect(evaluateFormula('if(0, "yes", "no")', {})).toBe("no");
    });
    it("reads prop from row", () => {
      expect(evaluateFormula("prop(\"name\")", { name: "rodrigo" })).toBe("rodrigo");
    });
    it("throws on unknown function", () => {
      expect(() => evaluateFormula("evil()", {})).toThrow();
    });
  });

  describe("applyFilters", () => {
    const rows = [
      { properties: { s: "a", n: 1, tags: ["x", "y"] } },
      { properties: { s: "b", n: 2, tags: ["y"] } },
      { properties: { s: "a", n: 3, tags: [] } },
    ];
    it("filters = ", () => {
      const r = applyFilters(rows, [{ property: "s", op: "=", value: "a" }]);
      expect(r.length).toBe(2);
    });
    it("filters >", () => {
      const r = applyFilters(rows, [{ property: "n", op: ">", value: 1 }]);
      expect(r.length).toBe(2);
    });
    it("filters contains", () => {
      const r = applyFilters(rows, [
        { property: "tags", op: "contains", value: "y" },
      ]);
      expect(r.length).toBe(2);
    });
    it("filters isEmpty", () => {
      const r = applyFilters(rows, [{ property: "tags", op: "isEmpty", value: null }]);
      expect(r.length).toBe(1);
    });
  });

  describe("applySorts", () => {
    it("sorts by n asc", () => {
      const rows = [
        { properties: { n: 3 } },
        { properties: { n: 1 } },
        { properties: { n: 2 } },
      ];
      const r = applySorts(rows, [{ property: "n", direction: "asc" }]);
      expect((r[0].properties as any).n).toBe(1);
    });
    it("sorts by n desc", () => {
      const rows = [
        { properties: { n: 1 } },
        { properties: { n: 3 } },
        { properties: { n: 2 } },
      ];
      const r = applySorts(rows, [{ property: "n", direction: "desc" }]);
      expect((r[0].properties as any).n).toBe(3);
    });
  });

  describe("groupBy", () => {
    it("groups by property", () => {
      const rows = [
        { properties: { s: "a" } },
        { properties: { s: "a" } },
        { properties: { s: "b" } },
      ];
      const r = groupBy(rows, "s");
      expect(r.get("a")?.length).toBe(2);
      expect(r.get("b")?.length).toBe(1);
    });
  });

  describe("fault injection", () => {
    it("handles empty filters", () => {
      const r = applyFilters([], []);
      expect(r).toEqual([]);
    });
    it("handles bad sort property gracefully", () => {
      const rows = [{ properties: {} }];
      const r = applySorts(rows, [{ property: "nonexistent", direction: "asc" }]);
      expect(r.length).toBe(1);
    });
    it("handles formula with no args", () => {
      expect(() => evaluateFormula("upper()", {})).not.toThrow();
    });
    it("validates non-string select with malformed input", () => {
      const r = validateValue({ name: "s", type: "select" }, { weird: true });
      expect(r.ok).toBe(false);
    });
  });
});

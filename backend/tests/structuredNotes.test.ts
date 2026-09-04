import { describe, it, expect } from "vitest";
import {
  validatePropertyValue,
  applyFilters,
  applySorts,
  groupBy,
  evalFormula,
  hashContent,
  genId,
} from "../src/services/structuredNotes.js";

describe("structuredNotes", () => {
  describe("validatePropertyValue", () => {
    it("text accepts string", () => {
      expect(validatePropertyValue({ name: "x", type: "text" }, "hi").ok).toBe(true);
    });
    it("text rejects number", () => {
      expect(validatePropertyValue({ name: "x", type: "text" }, 123).ok).toBe(false);
    });
    it("number accepts number, rejects string", () => {
      expect(validatePropertyValue({ name: "x", type: "number" }, 3.14).ok).toBe(true);
      expect(validatePropertyValue({ name: "x", type: "number" }, "x").ok).toBe(false);
    });
    it("boolean accepts bool", () => {
      expect(validatePropertyValue({ name: "x", type: "boolean" }, true).ok).toBe(true);
      expect(validatePropertyValue({ name: "x", type: "boolean" }, "true").ok).toBe(false);
    });
    it("date accepts valid ISO, rejects garbage", () => {
      expect(validatePropertyValue({ name: "x", type: "date" }, "2024-01-15").ok).toBe(true);
      expect(validatePropertyValue({ name: "x", type: "date" }, "not a date").ok).toBe(false);
    });
    it("select with options validates", () => {
      const schema = { name: "x", type: "select" as const, options: ["a", "b", "c"] };
      expect(validatePropertyValue(schema, "a").ok).toBe(true);
      expect(validatePropertyValue(schema, "z").ok).toBe(false);
    });
    it("multi validates each element", () => {
      const schema = { name: "x", type: "multi" as const, options: ["a", "b", "c"] };
      expect(validatePropertyValue(schema, ["a", "b"]).ok).toBe(true);
      expect(validatePropertyValue(schema, ["a", "z"]).ok).toBe(false);
      expect(validatePropertyValue(schema, "not array").ok).toBe(false);
    });
    it("url validates format", () => {
      expect(validatePropertyValue({ name: "x", type: "url" }, "https://example.com").ok).toBe(true);
      expect(validatePropertyValue({ name: "x", type: "url" }, "not a url").ok).toBe(false);
    });
    it("email validates format", () => {
      expect(validatePropertyValue({ name: "x", type: "email" }, "a@b.co").ok).toBe(true);
      expect(validatePropertyValue({ name: "x", type: "email" }, "a@b").ok).toBe(false);
    });
    it("null is allowed unless required", () => {
      expect(validatePropertyValue({ name: "x", type: "text" }, null).ok).toBe(true);
      expect(validatePropertyValue({ name: "x", type: "text", required: true }, null).ok).toBe(false);
    });
  });

  describe("applyFilters", () => {
    const rows = [
      { id: "1", properties: { status: "todo", priority: 1 } },
      { id: "2", properties: { status: "done", priority: 3 } },
      { id: "3", properties: { status: "todo", priority: 5 } },
    ];
    it("filters by =", () => {
      expect(applyFilters(rows as never, [{ property: "status", op: "=", value: "todo" }])).toHaveLength(2);
    });
    it("filters by !=", () => {
      expect(applyFilters(rows as never, [{ property: "status", op: "!=", value: "todo" }])).toHaveLength(1);
    });
    it("filters by >", () => {
      expect(applyFilters(rows as never, [{ property: "priority", op: ">", value: 2 }])).toHaveLength(2);
    });
    it("ANDs multiple filters", () => {
      expect(applyFilters(rows as never, [
        { property: "status", op: "=", value: "todo" },
        { property: "priority", op: ">", value: 2 },
      ])).toHaveLength(1);
    });
  });

  describe("applySorts", () => {
    const rows = [
      { id: "a", properties: { priority: 3 } },
      { id: "b", properties: { priority: 1 } },
      { id: "c", properties: { priority: 5 } },
    ];
    it("sorts ascending", () => {
      const out = applySorts(rows as never, [{ property: "priority", direction: "asc" }]);
      expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
    });
    it("sorts descending", () => {
      const out = applySorts(rows as never, [{ property: "priority", direction: "desc" }]);
      expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
    });
  });

  describe("groupBy", () => {
    it("groups by field", () => {
      const rows = [
        { id: "1", properties: { status: "todo" } },
        { id: "2", properties: { status: "done" } },
        { id: "3", properties: { status: "todo" } },
      ];
      const out = groupBy(rows as never, "status");
      expect(out.get("todo")?.length).toBe(2);
      expect(out.get("done")?.length).toBe(1);
    });
  });

  describe("evalFormula", () => {
    it("upper", () => {
      const row = { id: "1", databaseId: "d", path: "/p", properties: { name: "hi" }, createdAt: 0, updatedAt: 0, clock: {}, contentHash: "" };
      expect(evalFormula("upper(name)", row as never, [])).toBe("HI");
    });
    it("concat", () => {
      const row = { id: "1", databaseId: "d", path: "/p", properties: { a: "x", b: "y" }, createdAt: 0, updatedAt: 0, clock: {}, contentHash: "" };
      expect(evalFormula("concat(a, b)", row as never, [])).toBe("xy");
    });
    it("today returns ISO date", () => {
      const row = { id: "1", databaseId: "d", path: "/p", properties: {}, createdAt: 0, updatedAt: 0, clock: {}, contentHash: "" };
      const v = evalFormula("today()", row as never, []);
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    it("if(true, a, b) returns a", () => {
      const row = { id: "1", databaseId: "d", path: "/p", properties: { a: "X", b: "Y" }, createdAt: 0, updatedAt: 0, clock: {}, contentHash: "" };
      expect(evalFormula("if(true, a, b)", row as never, [])).toBe("X");
    });
    it("returns null for unknown function", () => {
      const row = { id: "1", databaseId: "d", path: "/p", properties: {}, createdAt: 0, updatedAt: 0, clock: {}, contentHash: "" };
      expect(evalFormula("unknown()", row as never, [])).toBeNull();
    });
  });

  it("hashContent is deterministic", () => {
    const a = hashContent({ x: 1 }, "body");
    const b = hashContent({ x: 1 }, "body");
    expect(a).toBe(b);
    const c = hashContent({ x: 2 }, "body");
    expect(a).not.toBe(c);
  });

  it("genId returns unique ids", () => {
    const ids = new Set([genId(), genId(), genId(), genId()]);
    expect(ids.size).toBe(4);
  });
});

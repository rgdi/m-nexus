/* ============================================================
 * safe.test.js — Unit tests for safe.js escape functions.
 * v2.2.0 W6 — verifies XSS-safe escaping behavior.
 * ============================================================ */

import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  escapeAttr,
  escapeJs,
  escapeUrl,
  escapeCss,
} from "../src/services/safe.js";

describe("safe.js — escape functions", () => {
  describe("escapeHtml", () => {
    it("escapes < and >", () => {
      expect(escapeHtml("<script>")).toBe("&lt;script&gt;");
    });

    it("escapes &", () => {
      expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
    });

    it("escapes double quotes", () => {
      expect(escapeHtml('"hello"')).toBe("&quot;hello&quot;");
    });

    it("escapes single quotes", () => {
      expect(escapeHtml("it's")).toBe("it&#39;s");
    });

    it("escapes backticks", () => {
      expect(escapeHtml("`code`")).toBe("&#96;code&#96;");
    });

    it("handles null/undefined gracefully", () => {
      expect(escapeHtml(null)).toBe("");
      expect(escapeHtml(undefined)).toBe("");
    });

    it("escapes a complex XSS payload", () => {
      const payload = `<img src=x onerror="alert('XSS')">`;
      const out = escapeHtml(payload);
      expect(out).not.toContain("<");
      expect(out).not.toContain(">");
      expect(out).not.toContain('"');
      expect(out).toContain("&lt;");
      expect(out).toContain("&quot;");
    });

    it("preserves safe text", () => {
      expect(escapeHtml("Hello, world! 123")).toBe("Hello, world! 123");
    });
  });

  describe("escapeAttr", () => {
    it("escapes quotes (the main attr injection vector)", () => {
      expect(escapeAttr('" onclick="alert(1)')).toBe("&quot; onclick=&quot;alert(1)");
    });

    it("escapes & to prevent entity confusion", () => {
      expect(escapeAttr("&amp;")).toBe("&amp;amp;");
    });

    it("handles null", () => {
      expect(escapeAttr(null)).toBe("");
    });
  });

  describe("escapeJs", () => {
    it("escapes </script>", () => {
      expect(escapeJs("</script>")).not.toContain("</script>");
      expect(escapeJs("</script>")).toContain("\\u003c");
    });

    it("escapes backslashes", () => {
      expect(escapeJs("\\")).toContain("\\\\");
    });

    it("escapes U+2028 / U+2029 (JSON parse killers)", () => {
      expect(escapeJs("\u2028")).toContain("\\u2028");
      expect(escapeJs("\u2029")).toContain("\\u2029");
    });
  });

  describe("escapeUrl", () => {
    it("encodes spaces", () => {
      expect(escapeUrl("hello world")).toBe("hello%20world");
    });

    it("encodes special chars", () => {
      expect(escapeUrl("a/b?c=d")).toBe("a%2Fb%3Fc%3Dd");
    });

    it("preserves unreserved chars (alphanum + -_.~)", () => {
      expect(escapeUrl("abc-123_test~")).toBe("abc-123_test~");
    });
  });

  describe("escapeCss", () => {
    it("escapes curly braces (CSS expression injection)", () => {
      const out = escapeCss("red;}</style>");
      expect(out).toContain("\\}");
      expect(out).toContain("\\<");
    });

    it("escapes quotes", () => {
      expect(escapeCss('"')).toContain('\\"');
    });

    it("escapes parentheses (JS expression context)", () => {
      expect(escapeCss("expression(alert(1))")).toContain("\\(");
    });
  });
});

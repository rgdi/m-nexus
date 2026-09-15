/* ============================================================
 * storage.test.js — Unit tests for storage.js wrapper.
 * v2.2.0 W6 — verifies localStorage wrapper behavior.
 * ============================================================ */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { storage, storageRaw } from "../src/services/storage.js";

describe("storage.js — localStorage wrapper", () => {
  beforeEach(() => {
    // Clear all mnexus keys before each test
    storage.clear();
  });

  describe("get / set / remove", () => {
    it("stores and retrieves JSON values", () => {
      storage.set("user", { name: "Mavis", age: 1 });
      expect(storage.get("user")).toEqual({ name: "Mavis", age: 1 });
    });

    it("returns defaultValue for missing keys", () => {
      expect(storage.get("missing", "default")).toBe("default");
    });

    it("returns null when no defaultValue is provided", () => {
      expect(storage.get("missing")).toBeNull();
    });

    it("removes a key", () => {
      storage.set("temp", "value");
      expect(storage.has("temp")).toBe(true);
      storage.remove("temp");
      expect(storage.has("temp")).toBe(false);
    });

    it("handles arrays", () => {
      storage.set("list", [1, 2, 3]);
      expect(storage.get("list")).toEqual([1, 2, 3]);
    });

    it("handles nested objects", () => {
      const data = { user: { profile: { tags: ["a", "b"] } } };
      storage.set("data", data);
      expect(storage.get("data")).toEqual(data);
    });
  });

  describe("has", () => {
    it("returns true for existing keys", () => {
      storage.set("exists", true);
      expect(storage.has("exists")).toBe(true);
    });

    it("returns false for missing keys", () => {
      expect(storage.has("doesnt-exist")).toBe(false);
    });
  });

  describe("keys", () => {
    it("returns only mnexus-prefixed keys", () => {
      storage.set("a", 1);
      storage.set("b", 2);
      localStorage.setItem("other-app.key", "x"); // not mnexus
      const keys = storage.keys();
      expect(keys.sort()).toEqual(["a", "b"]);
    });
  });

  describe("clear", () => {
    it("removes only mnexus keys", () => {
      storage.set("a", 1);
      localStorage.setItem("external", "x");
      const cleared = storage.clear();
      expect(cleared).toBe(1);
      expect(localStorage.getItem("external")).toBe("x");
      expect(storage.has("a")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("returns default on parse error", () => {
      // Manually inject malformed JSON
      localStorage.setItem("mnexus.broken", "{not valid json");
      expect(storage.get("broken", "fallback")).toBe("fallback");
    });

    it("returns false on quota exceeded", () => {
      // Mock localStorage.setItem to throw
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = vi.fn(() => {
        throw new Error("QuotaExceededError");
      });
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = storage.set("key", "value");
      expect(result).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();

      Storage.prototype.setItem = original;
      consoleSpy.mockRestore();
    });
  });

  describe("namespace prefix", () => {
    it("auto-prefixes with 'mnexus.'", () => {
      storage.set("foo", "bar");
      expect(localStorage.getItem("mnexus.foo")).toBe('"bar"');
      expect(localStorage.getItem("foo")).toBeNull();
    });
  });

  describe("storageRaw", () => {
    it("stores strings as-is (no JSON)", () => {
      storageRaw.set("raw", "plain string");
      expect(localStorage.getItem("mnexus.raw")).toBe("plain string");
      expect(storageRaw.get("raw")).toBe("plain string");
    });

    it("coerces non-strings", () => {
      storageRaw.set("number", 42);
      expect(storageRaw.get("number")).toBe("42");
    });
  });
});

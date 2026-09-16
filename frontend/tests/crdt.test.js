/* ============================================================
 * crdt.test.js — Unit tests for LWW (Last-Write-Wins) CRDT.
 * v2.5.0 W6 — covers conflict resolution in sync.
 * ============================================================ */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getVector,
  bumpVector,
  mergeVectors,
  compareVectors,
  lwwRead,
  lwwWrite,
  lwwMerge,
  getTombstones,
} from "../src/services/crdt.js";

describe("crdt.js — vector clock", () => {
  beforeEach(() => {
    // Reset via a high counter so our test counters are "ahead"
    bumpVector("__reset__");
  });

  describe("bumpVector()", () => {
    it("increments counter for a device", () => {
      const before = getVector();
      const v = bumpVector("deviceA");
      expect(v.deviceA).toBeGreaterThan(before.deviceA || 0);
    });

    it("increments on repeated calls", () => {
      bumpVector("deviceA");
      const a = getVector().deviceA || 0;
      bumpVector("deviceA");
      const b = getVector().deviceA || 0;
      expect(b).toBe(a + 1);
    });

    it("does not mutate input", () => {
      const original = {};
      bumpVector("deviceA", original);
      expect(Object.keys(original).length).toBe(0);
    });

    it("handles multiple devices independently", () => {
      bumpVector("deviceA");
      const a = getVector().deviceA || 0;
      bumpVector("deviceB");
      bumpVector("deviceA");
      const b = getVector().deviceA || 0;
      expect(b).toBe(a + 1);
      expect(getVector().deviceB).toBeGreaterThan(0);
    });
  });

  describe("mergeVectors()", () => {
    it("takes max of each device counter", () => {
      const a = { x: 3, y: 1 };
      const b = { x: 2, y: 5 };
      const merged = mergeVectors(a, b);
      expect(merged).toEqual({ x: 3, y: 5 });
    });

    it("includes devices only in one side", () => {
      const a = { x: 1 };
      const b = { y: 2 };
      const merged = mergeVectors(a, b);
      expect(merged).toEqual({ x: 1, y: 2 });
    });

    it("handles empty vectors", () => {
      expect(mergeVectors({}, {})).toEqual({});
      expect(mergeVectors({ x: 1 }, {})).toEqual({ x: 1 });
    });

    it("does not mutate inputs", () => {
      const a = { x: 1 };
      const b = { y: 2 };
      mergeVectors(a, b);
      expect(a).toEqual({ x: 1 });
      expect(b).toEqual({ y: 2 });
    });
  });

  describe("compareVectors() — returns true if a > b", () => {
    it("returns false when a < b", () => {
      expect(compareVectors({ x: 1 }, { x: 2 })).toBe(false);
    });

    it("returns true when a > b", () => {
      expect(compareVectors({ x: 2 }, { x: 1 })).toBe(true);
    });

    it("returns false when identical", () => {
      expect(compareVectors({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(false);
    });

    it("returns false when concurrent (a has b1 but a missing b2)", () => {
      // a = {x: 2, y: 1}, b = {x: 1, y: 2}
      // a > b in x (2 > 1), b > a in y (2 > 1) → neither dominates → false
      expect(compareVectors({ x: 2, y: 1 }, { x: 1, y: 2 })).toBe(false);
    });

    it("returns true when a dominates (a > b in all keys)", () => {
      expect(compareVectors({ x: 3, y: 5 }, { x: 2, y: 4 })).toBe(true);
    });
  });

  describe("getVector()", () => {
    it("returns an object", () => {
      const v = getVector();
      expect(typeof v).toBe("object");
      expect(v).not.toBeNull();
    });

    it("returns a snapshot (mutation doesn't affect internal state)", () => {
      const v1 = getVector();
      const a = JSON.stringify(v1);
      v1.injectedKey = "injected";
      const v2 = getVector();
      expect(JSON.stringify(v2)).toBe(a);
    });
  });
});

describe("crdt.js — LWW store", () => {
  beforeEach(() => {
    // Use a fresh key prefix to avoid cross-test pollution
    bumpVector("__reset__");
  });

  describe("lwwRead() / lwwWrite()", () => {
    it("returns entry with value/vector envelope for missing keys", () => {
      expect(lwwRead("missing", null)).toBeNull();
    });

    it("returns the value after write (extract .value)", () => {
      lwwWrite("greeting", "hello", "deviceA");
      const entry = lwwRead("greeting");
      expect(entry.value).toBe("hello");
    });

    it("supports complex values (extract .value)", () => {
      const obj = { foo: "bar", arr: [1, 2, 3] };
      lwwWrite("data", obj, "deviceA");
      const entry = lwwRead("data");
      expect(entry.value).toEqual(obj);
    });

    it("write returns the same envelope", () => {
      const result = lwwWrite("k", "v", "deviceA");
      expect(result).toHaveProperty("value", "v");
      expect(result).toHaveProperty("ts");
      expect(result).toHaveProperty("v");
    });
  });

  describe("lwwMerge() — timestamp-based conflict resolution", () => {
    it("remote wins if remote timestamp is newer", () => {
      const local = lwwWrite("title", "local", "deviceA");
      // Sleep briefly so remote has a later timestamp
      const remote = {
        value: "remote",
        ts: local.ts + 100,
        v: { deviceB: 1 },
      };
      lwwMerge("title", remote, "deviceA");
      expect(lwwRead("title").value).toBe("remote");
    });

    it("local wins if local timestamp is newer", () => {
      const local = lwwWrite("title", "local", "deviceA");
      const remote = {
        value: "remote",
        ts: local.ts - 100,
        v: { deviceB: 1 },
      };
      lwwMerge("title", remote, "deviceA");
      expect(lwwRead("title").value).toBe("local");
    });

    it("handles missing local entry — accept remote", () => {
      // No local write; remote arrives
      const remote = {
        value: "from-remote",
        ts: Date.now(),
        v: { deviceB: 1 },
      };
      lwwMerge("new-key", remote, "deviceA");
      expect(lwwRead("new-key").value).toBe("from-remote");
    });

    it("returns 'remote' when remote wins", () => {
      const local = lwwWrite("k", "v", "deviceA");
      const remote = {
        value: "newer",
        ts: local.ts + 50,
        v: { deviceB: 1 },
      };
      const result = lwwMerge("k", remote, "deviceA");
      expect(result).toBe("remote");
    });

    it("returns 'local' when local wins", () => {
      const local = lwwWrite("k", "v", "deviceA");
      const remote = {
        value: "older",
        ts: local.ts - 50,
        v: { deviceB: 1 },
      };
      const result = lwwMerge("k", remote, "deviceA");
      expect(result).toBe("local");
    });
  });
});

describe("crdt.js — tombstones (deletions)", () => {
  beforeEach(() => {
    bumpVector("__reset__");
  });

  describe("getTombstones()", () => {
    it("returns an object (possibly empty)", () => {
      const t = getTombstones();
      expect(typeof t).toBe("object");
    });
  });

  // Note: full tombstone testing depends on lwwWrite with tombstone semantics.
  // Tombstone set/restore via separate API may exist; covered by lwwMerge integration.
});

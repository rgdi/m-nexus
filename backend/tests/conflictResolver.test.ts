import { describe, it, expect } from "vitest";
import { ConflictResolver, VersionedField } from "../src/services/conflictResolver.js";

describe("ConflictResolver", () => {
  const r = new ConflictResolver();

  function vf(value: unknown, updatedBy: string, updatedAt: number, clock: Record<string, number> = {}): VersionedField {
    return { value, updatedBy, updatedAt, clock };
  }

  describe("vector clock comparison", () => {
    it("returns > 0 when a dominates b", () => {
      expect(r.compareClocks({ d1: 2 }, { d1: 1 })).toBe(1);
      expect(r.compareClocks({ d1: 1, d2: 1 }, { d1: 1 })).toBe(1);
    });
    it("returns < 0 when b dominates a", () => {
      expect(r.compareClocks({ d1: 1 }, { d1: 2 })).toBe(-1);
    });
    it("returns 0 when concurrent", () => {
      expect(r.compareClocks({ d1: 2 }, { d2: 1 })).toBe(0);
      expect(r.compareClocks({ d1: 1, d2: 1 }, { d1: 2, d2: 0 })).toBe(0);
    });
  });

  describe("field-level LWW", () => {
    it("local dominates → local wins", () => {
      const local = vf("local", "d1", 100, { d1: 2 });
      const remote = vf("remote", "d2", 99, { d1: 1, d2: 1 });
      const res = r.resolveField("front", local, remote);
      expect(res.value).toBe("local");
      expect(res.resolution).toBe("local");
    });

    it("remote dominates → remote wins", () => {
      const local = vf("local", "d1", 100, { d1: 1 });
      const remote = vf("remote", "d2", 99, { d1: 1, d2: 2 });
      const res = r.resolveField("front", local, remote);
      expect(res.value).toBe("remote");
      expect(res.resolution).toBe("remote");
    });

    it("concurrent clocks → LWW by timestamp", () => {
      const local = vf("local", "d1", 200, { d1: 1 });
      const remote = vf("remote", "d2", 100, { d2: 1 });
      const res = r.resolveField("front", local, remote);
      expect(res.value).toBe("local");
      expect(res.resolution).toBe("local");
    });

    it("concurrent + same ts → deterministic by deviceId", () => {
      const local = vf("local", "d1", 100, { d1: 1 });
      const remote = vf("remote", "d2", 100, { d2: 1 });
      const res = r.resolveField("front", local, remote);
      // "d1" < "d2" → local wins
      expect(res.value).toBe("local");
    });

    it("null local → remote wins", () => {
      const res = r.resolveField("front", null, vf("remote", "d1", 100, { d1: 1 }));
      expect(res.value).toBe("remote");
      expect(res.resolution).toBe("remote");
    });

    it("null remote → local wins", () => {
      const res = r.resolveField("front", vf("local", "d1", 100, { d1: 1 }), null);
      expect(res.value).toBe("local");
    });

    it("both null → equal", () => {
      const res = r.resolveField("front", null, null);
      expect(res.resolution).toBe("equal");
    });
  });

  describe("mergeClocks", () => {
    it("takes max of each device", () => {
      const out = r.mergeClocks({ d1: 1, d2: 5 }, { d1: 3, d3: 2 });
      expect(out).toEqual({ d1: 3, d2: 5, d3: 2 });
    });
  });

  describe("incrementClock", () => {
    it("increments existing device", () => {
      expect(r.incrementClock({ d1: 5 }, "d1")).toEqual({ d1: 6 });
    });
    it("adds new device", () => {
      expect(r.incrementClock({ d1: 1 }, "d2")).toEqual({ d1: 1, d2: 1 });
    });
    it("does not mutate original", () => {
      const orig = { d1: 1 };
      r.incrementClock(orig, "d1");
      expect(orig).toEqual({ d1: 1 });
    });
  });

  describe("resolveNote", () => {
    it("resolves multiple fields independently", () => {
      const local = {
        front: vf("L-front", "d1", 100, { d1: 1 }),
        back:  vf("L-back",  "d1", 50,  { d1: 1 }),
      };
      const remote = {
        front: vf("R-front", "d2", 200, { d2: 1 }),
        back:  vf("R-back",  "d2", 200, { d2: 1 }),
      };
      const out = r.resolveNote(local, remote, "d1");
      // front: local vs remote, clocks concurrent, LWW by ts → remote (200 > 100)
      // back: same logic → remote
      expect(out.resolved.front.value).toBe("R-front");
      expect(out.resolved.back.value).toBe("R-back");
      expect(out.report.hasConflict).toBe(true);
    });

    it("no conflict when local and remote are equal", () => {
      const local = { a: vf("x", "d1", 100, { d1: 1 }) };
      const remote = { a: vf("x", "d1", 100, { d1: 1 }) };
      const out = r.resolveNote(local, remote, "d1");
      expect(out.report.hasConflict).toBe(false);
    });

    it("handles missing fields in one side", () => {
      const local = { a: vf("x", "d1", 100, { d1: 1 }) };
      const remote = { b: vf("y", "d2", 100, { d2: 1 }) };
      const out = r.resolveNote(local, remote, "d1");
      expect(out.resolved.a.value).toBe("x");
      expect(out.resolved.b.value).toBe("y");
    });
  });
});

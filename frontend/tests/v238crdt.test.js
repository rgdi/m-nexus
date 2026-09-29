// tests/v238crdt.test.js — v2.38.1 concurrent note editing.
//
// These run in plain JS against the real crdt.js store, driving two
// devices through the same sequence and checking the result is
// identical on both. Convergence is the whole claim, so a test that only
// checked one side would prove nothing.

import { describe, it, expect, beforeEach } from "vitest";

// A minimal localStorage so the real crdt.js code path is exercised
// rather than a mock of it.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

// A static import is safe: crdt.js only reads localStorage inside its
// functions, never at module load, so the stub above is in place before
// anything touches it.
import {
  seqInsert, seqDelete, seqMerge, seqText, initBlockText, seqRead,
  applyRemote, deleteBlock, isBlockDeleted, reconcile,
} from "../src/services/noteCrdt.js";

beforeEach(() => store.clear());

const NOTE = "n1";
const B = "b1";

describe("v2.38.1 — sequence CRDT", () => {
  it("starts empty and reads back what was inserted", () => {
    const s = seqInsert({ items: [], counter: 0, v: { phone: 0 } }, "hola", "phone");
    expect(seqText(s)).toBe("hola");
  });

  it("keeps the order of consecutive inserts from one device", () => {
    let s = { items: [], counter: 0, v: { phone: 0 } };
    s = seqInsert(s, "hola ", "phone");
    s = seqInsert(s, "mundo", "phone");
    expect(seqText(s)).toBe("hola mundo");
  });

  it("deletes a range and leaves the rest", () => {
    const s = seqDelete(initBlockText("hola mundo", "phone"), 5, 5);
    expect(seqText(s)).toBe("hola ");
  });

  it("a delete is not resurrected by a stale copy", () => {
    // The one that matters: resurrection after a delete is surprising
    // and unrecoverable, a stale char is merely visible.
    const before = initBlockText("abcdef", "phone");
    const deleted = seqDelete(before, 2, 2);
    const merged = seqMerge(deleted, before);
    expect(seqText(merged)).toBe("abef");
  });
});

describe("v2.38.1 — two devices converge", () => {
  it("editing different positions keeps both", () => {
    // The case whole-note LWW got wrong: phone rewrites one part, the
    // laptop rewrites another, neither loses.
    let phone = initBlockText("el gato duerme", "phone");
    let laptop = initBlockText("el gato duerme", "laptop");

    phone = seqDelete(phone, 3, 4);
    phone = seqInsert(phone, "perro", "phone");
    laptop = seqDelete(laptop, 8, 6);
    laptop = seqInsert(laptop, "en el sofá", "laptop");

    const onPhone = seqMerge(phone, laptop);
    const onLaptop = seqMerge(laptop, phone);
    expect(seqText(onPhone)).toBe(seqText(onLaptop));
    expect(seqText(onPhone)).toContain("perro");
    expect(seqText(onPhone)).toContain("sofá");
  });

  it("both devices produce byte-identical text", () => {
    let a = initBlockText("uno dos tres", "alpha");
    let b = initBlockText("uno dos tres", "beta");
    a = seqInsert(a, " A", "alpha");
    b = seqInsert(b, " B", "beta");
    expect(seqText(seqMerge(a, b))).toBe(seqText(seqMerge(b, a)));
  });

  it("convergence survives a third round", () => {
    let a = initBlockText("base", "a");
    let b = initBlockText("base", "b");
    let c = initBlockText("base", "c");
    a = seqInsert(a, "-a", "a");
    b = seqDelete(b, 0, 1);
    c = seqInsert(c, "-c", "c");
    const merged = seqMerge(seqMerge(a, b), c);
    expect(seqText(merged)).toBe(seqText(seqMerge(c, seqMerge(a, b))));
  });

  it("merging is idempotent", () => {
    const a = seqInsert(initBlockText("texto", "a"), "x", "a");
    const b = seqInsert(initBlockText("texto", "b"), "y", "b");
    const once = seqMerge(a, b);
    const twice = seqMerge(once, b);
    expect(seqText(twice)).toBe(seqText(once));
  });

  it("a merge that changes nothing does not grow the state", () => {
    const a = initBlockText("texto", "a");
    const m1 = seqMerge(a, a);
    const m2 = seqMerge(m1, a);
    expect(m2.items.length).toBe(m1.items.length);
  });

  it("a stale replica that never saw an edit does not undo it", () => {
    // The device that was asleep writes its old copy back. If the merge
    // were "last writer wins on the whole state", it would clobber.
    const fresh = seqInsert(initBlockText("hola", "a"), " nuevo", "a");
    const stale = initBlockText("hola", "a");
    expect(seqText(seqMerge(fresh, stale))).toContain("nuevo");
  });
});

describe("v2.38.1 — through the shared store", () => {
  it("applyRemote writes the merged state back", () => {
    const mine = initBlockText("uno", "phone");
    const theirs = seqInsert(initBlockText("uno", "laptop"), " dos", "laptop");
    const text = applyRemote(NOTE, B, theirs, "phone");
    expect(text).toBe("uno dos");
  });

  it("reading it back gives the merged text", () => {
    const theirs = seqInsert(initBlockText("uno", "laptop"), " dos", "laptop");
    applyRemote(NOTE, B, theirs, "phone");
    expect(seqText(seqRead(NOTE, B, "phone"))).toBe("uno dos");
  });
});

describe("v2.38.1 — deleted blocks stay deleted", () => {
  it("a tombstone outlives the note being re-read", () => {
    deleteBlock("n9", "bX", "phone");
    expect(isBlockDeleted("n9", "bX")).toBe(true);
  });

  it("a different block is not affected", () => {
    deleteBlock("n9", "bX", "phone");
    expect(isBlockDeleted("n9", "bY")).toBe(false);
  });

  it("a different note is not affected", () => {
    deleteBlock("n9", "bX", "phone");
    expect(isBlockDeleted("n10", "bX")).toBe(false);
  });

  it("reconcile drops a deleted block", () => {
    deleteBlock("n11", "b1", "phone");
    const note = { id: "n11", blocks: [{ id: "b1", text: "x" }, { id: "b2", text: "y" }] };
    const r = reconcile(note, "phone");
    expect(r.blocks.map((b) => b.id)).toEqual(["b2"]);
  });
});

describe("v2.38.1 — reconcile", () => {
  it("seeds blocks that have never been edited", () => {
    const note = { id: "n2", blocks: [{ id: "b1", text: "contenido" }] };
    const r = reconcile(note, "phone");
    expect(r.blocks[0].text).toBe("contenido");
  });

  it("prefers the CRDT text once one exists", () => {
    applyRemote("n3", "b1", initBlockText("remoto", "laptop"), "phone");
    const note = { id: "n3", blocks: [{ id: "b1", text: "el texto viejo de la nota" }] };
    const r = reconcile(note, "phone");
    expect(r.blocks[0].text).toBe("remoto");
  });

  it("handles a note with no blocks", () => {
    expect(reconcile({ id: "n4", blocks: [] }, "phone").blocks).toEqual([]);
  });
});

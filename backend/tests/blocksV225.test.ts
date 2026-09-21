// blocksV225.test.ts — v2.25.0 block-level outliner tests.

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const BACKLINK_FILE = join(DATA_DIR, "block-backlinks.json");

import {
  bodyToBlocks,
  blocksToBody,
  extractBlockRefs,
  matchesBlockQuery,
  NoteBlocks,
  type Block,
} from "../src/services/blocks.js";

describe("v2.25.0 — bodyToBlocks / blocksToBody roundtrip", () => {
  it("deriva bloques a partir de markdown simple", () => {
    const blocks = bodyToBlocks("- Suma: 2+2\n- Resta: 5-3");
    expect(blocks.length).toBe(2);
    expect(blocks[0].text).toBe("Suma: 2+2");
    expect(blocks[1].text).toBe("Resta: 5-3");
    expect(blocks[0].parentId).toBeNull();
  });

  it("detecta indentación como jerarquía padre-hijo", () => {
    const blocks = bodyToBlocks("- Raíz\n  - Hijo 1\n  - Hijo 2\n- Otro raíz");
    expect(blocks.length).toBe(4);
    expect(blocks[0].parentId).toBeNull();
    expect(blocks[1].parentId).toBe(blocks[0].id);
    expect(blocks[2].parentId).toBe(blocks[0].id);
    expect(blocks[3].parentId).toBeNull();
  });

  it("detecta cloze blocks (text contiene {{c1::...}})", () => {
    const blocks = bodyToBlocks("- {{c1::Capital::París}}\n- Normal");
    expect(blocks[0].type).toBe("cloze");
    expect(blocks[1].type).toBe("text");
  });

  it("detecta code blocks (líneas con ```)", () => {
    const blocks = bodyToBlocks("- Texto normal\n- ```js\n  const x = 1;\n  ```\n- Otro");
    expect(blocks[1].type).toBe("code");
  });

  it("round-trip blocksToBody(bodyToBlocks(x)) preserva estructura", () => {
    const original = "- Raíz\n  - Hija A\n  - Hija B\n- Otro";
    const blocks = bodyToBlocks(original);
    const rebuilt = blocksToBody(blocks);
    // La estructura jerárquica se preserva con indentación de 2 espacios.
    expect(rebuilt).toContain("Raíz");
    expect(rebuilt).toContain("Hija A");
    expect(rebuilt).toMatch(/ {2}- Hija A/);
  });

  it("maneja body vacío", () => {
    expect(bodyToBlocks("")).toEqual([]);
    expect(blocksToBody([])).toBe("");
  });
});

describe("v2.25.0 — extractBlockRefs", () => {
  it("extrae [[block-id]]", () => {
    const refs = extractBlockRefs("Ver [[block-abc-123]] para detalle");
    expect(refs).toContain("block-abc-123");
  });

  it("extrae ((block-id)) Logseq-style", () => {
    const refs = extractBlockRefs("Similar a ((block-xyz-456))");
    expect(refs).toContain("block-xyz-456");
  });

  it("extrae [[note-id#^block-id]] form", () => {
    const refs = extractBlockRefs("Link a [[note-1#^block-anchor-99]]");
    expect(refs).toContain("block-anchor-99");
  });

  it("ignora links que no son block-uuid", () => {
    const refs = extractBlockRefs("[[Nota normal]] y [[block-keep]]");
    expect(refs).toEqual(["block-keep"]);
  });

  it("deduplica referencias múltiples al mismo block", () => {
    const refs = extractBlockRefs("[[block-1]] y otra vez [[block-1]]");
    expect(refs).toEqual(["block-1"]);
  });
});

describe("v2.25.0 — NoteBlocks mutations", () => {
  it("append crea un bloque con id, parentId y order correctos", () => {
    const note: any = { blocks: [], body: "", title: "t", subject: "s", tags: [], pages: [], folderId: null, createdAt: 0, updatedAt: 0 };
    const b = NoteBlocks.append(note, { text: "hi", parentId: null });
    expect(b.id).toMatch(/^block-/);
    expect(b.parentId).toBeNull();
    expect(b.order).toBe(0);
    expect(b.text).toBe("hi");
  });

  it("append con parentId añade al subárbol", () => {
    const note: any = { blocks: [], body: "", title: "t", subject: "s", tags: [], pages: [], folderId: null, createdAt: 0, updatedAt: 0 };
    const root = NoteBlocks.append(note, { text: "root" });
    const child = NoteBlocks.append(note, { text: "child", parentId: root.id });
    expect(child.parentId).toBe(root.id);
    expect(child.order).toBe(0);
    const second = NoteBlocks.append(note, { text: "child2", parentId: root.id });
    expect(second.order).toBe(1);
  });

  it("patch actualiza text y updatedAt", () => {
    const note: any = { blocks: [], body: "", title: "t", subject: "s", tags: [], pages: [], folderId: null, createdAt: 0, updatedAt: 0 };
    const b = NoteBlocks.append(note, { text: "a" });
    const updated = NoteBlocks.patch(note, b.id, { text: "b" });
    expect(updated?.text).toBe("b");
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(b.updatedAt);
  });

  it("move cambia parentId y previene ciclos", () => {
    const note: any = { blocks: [], body: "", title: "t", subject: "s", tags: [], pages: [], folderId: null, createdAt: 0, updatedAt: 0 };
    const a = NoteBlocks.append(note, { text: "a" });
    const b = NoteBlocks.append(note, { text: "b" });
    // Move b under a
    const ok1 = NoteBlocks.move(note, b.id, a.id, 0);
    expect(ok1).toBe(true);
    expect(note.blocks.find((x: Block) => x.id === b.id)?.parentId).toBe(a.id);
    // Try to make a child of b (would cycle) — should reject
    const ok2 = NoteBlocks.move(note, a.id, b.id, 0);
    expect(ok2).toBe(false);
  });

  it("remove elimina un bloque y todos sus descendientes", () => {
    const note: any = { blocks: [], body: "", title: "t", subject: "s", tags: [], pages: [], folderId: null, createdAt: 0, updatedAt: 0 };
    const root = NoteBlocks.append(note, { text: "root" });
    const c1 = NoteBlocks.append(note, { text: "c1", parentId: root.id });
    const c1a = NoteBlocks.append(note, { text: "c1a", parentId: c1.id });
    NoteBlocks.append(note, { text: "sibling" });
    const ok = NoteBlocks.remove(note, c1.id);
    expect(ok).toBe(true);
    expect(note.blocks.length).toBe(2); // root + sibling
    expect(note.blocks.find((b: Block) => b.id === c1a.id)).toBeUndefined();
  });
});

describe("v2.25.0 — matchesBlockQuery", () => {
  function makeNote(over: any): any {
    return {
      id: "n1",
      title: "n",
      body: "b",
      subject: "anat",
      tags: ["review"],
      pages: [],
      folderId: null,
      createdAt: 0,
      updatedAt: 0,
      blocks: over.blocks ?? [],
      ...over,
    };
  }

  it("filtra por tag", () => {
    expect(matchesBlockQuery(makeNote({}), { tag: "review" })).toBe(true);
    expect(matchesBlockQuery(makeNote({ tags: [] }), { tag: "review" })).toBe(false);
  });

  it("filtra por subject", () => {
    expect(matchesBlockQuery(makeNote({ subject: "anat" }), { subject: "anat" })).toBe(true);
    expect(matchesBlockQuery(makeNote({ subject: "bio" }), { subject: "anat" })).toBe(false);
  });

  it("filtra por containsBlock=cloze (incluye any-cloze)", () => {
    const clozeBlock: Block = { id: "b1", parentId: null, order: 0, text: "x", type: "cloze", createdAt: 0, updatedAt: 0 };
    const textBlock: Block = { id: "b2", parentId: null, order: 1, text: "y", type: "text", createdAt: 0, updatedAt: 0 };
    expect(matchesBlockQuery(makeNote({ blocks: [textBlock] }), { containsBlock: "cloze" })).toBe(false);
    expect(matchesBlockQuery(makeNote({ blocks: [textBlock, clozeBlock] }), { containsBlock: "cloze" })).toBe(true);
    expect(matchesBlockQuery(makeNote({ blocks: [textBlock, clozeBlock] }), { containsBlock: "any-cloze" })).toBe(true);
  });

  it("filtra por textMatches con regex string", () => {
    const note = makeNote({ title: "Pancreatitis", body: "x" });
    expect(matchesBlockQuery(note, { textMatches: "pancrea" })).toBe(true);
    expect(matchesBlockQuery(note, { textMatches: "celiaco" })).toBe(false);
  });

  it("combina múltiples predicates (AND)", () => {
    const clozeBlock: Block = { id: "b1", parentId: null, order: 0, text: "x", type: "cloze", createdAt: 0, updatedAt: 0 };
    const note = makeNote({ subject: "anat", tags: ["review"], blocks: [clozeBlock] });
    expect(matchesBlockQuery(note, { subject: "anat", tag: "review", containsBlock: "cloze" })).toBe(true);
    expect(matchesBlockQuery(note, { subject: "bio", tag: "review", containsBlock: "cloze" })).toBe(false);
  });
});

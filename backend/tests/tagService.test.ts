// Tests para TagService (Fase 2.E).

import { describe, it, expect, beforeEach } from "vitest";
import { TagService } from "../src/services/tagService";

describe("TagService.extractTags", () => {
  it("extracts single tag", () => {
    expect(TagService.extractTags("texto #anatomia")).toEqual(["anatomia"]);
  });

  it("extracts multiple tags", () => {
    const tags = TagService.extractTags("Notas de #anatomia y #fisiologia");
    expect(tags.sort()).toEqual(["anatomia", "fisiologia"]);
  });

  it("handles tags with hyphens and underscores", () => {
    const tags = TagService.extractTags("#sistema-nervioso #tag_with_underscore");
    expect(tags.sort()).toEqual(["sistema-nervioso", "tag_with_underscore"]);
  });

  it("handles nested tags", () => {
    const tags = TagService.extractTags("#medicina/anatomia #medicina/fisiologia");
    expect(tags.sort()).toEqual(["medicina/anatomia", "medicina/fisiologia"]);
  });

  it("deduplicates same tag multiple times", () => {
    const tags = TagService.extractTags("#anatomia texto #anatomia más #anatomia");
    expect(tags).toEqual(["anatomia"]);
  });

  it("lowercases tags", () => {
    expect(TagService.extractTags("#Anatomia #ANATOMIA")).toEqual(["anatomia"]);
  });

  it("does NOT match emails as tags", () => {
    const tags = TagService.extractTags("Contacta a user@example.com por favor");
    expect(tags).toEqual([]);
  });

  it("does NOT match #1 (must start with letter)", () => {
    expect(TagService.extractTags("#123abc")).toEqual([]);
  });

  it("extracts tags from frontmatter (array format)", () => {
    const content = `---
title: Test
tags: [anatomia, fisiologia, hitoria-clinica]
---

Contenido #extra`;
    const tags = TagService.extractTags(content);
    expect(tags.sort()).toEqual(["anatomia", "extra", "fisiologia", "hitoria-clinica"]);
  });

  it("extracts tags from frontmatter (inline format)", () => {
    const content = `---
title: Test
tags: anatomia, fisiologia
---`;
    const tags = TagService.extractTags(content);
    expect(tags.sort()).toEqual(["anatomia", "fisiologia"]);
  });
});

describe("TagService index", () => {
  let service: TagService;

  beforeEach(() => {
    service = new TagService();
  });

  it("indexes note and finds tags", () => {
    service.indexNote("anatomia/corazon.md", "El corazón es parte del #sistema-cardiovascular");
    expect(service.getTagsForNote("anatomia/corazon.md")).toEqual(["sistema-cardiovascular"]);
  });

  it("getNotes returns notes with a tag", () => {
    service.indexNote("a.md", "#anatomia");
    service.indexNote("b.md", "#anatomia y #fisiologia");
    service.indexNote("c.md", "#fisiologia");
    const notas = service.getNotes("anatomia");
    expect(notas.sort()).toEqual(["a.md", "b.md"]);
  });

  it("list returns all tags with counts", () => {
    service.indexNote("a.md", "#anatomia");
    service.indexNote("b.md", "#anatomia");
    service.indexNote("c.md", "#fisiologia");
    const all = service.list();
    expect(all).toHaveLength(2);
    const anatomia = all.find((t) => t.tag === "anatomia")!;
    expect(anatomia.noteCount).toBe(2);
  });

  it("rename moves all notes to new tag", () => {
    service.indexNote("a.md", "#typo");
    service.indexNote("b.md", "#typo");
    service.indexNote("c.md", "#anatomia");
    const moved = service.rename("typo", "anatomia");
    expect(moved).toBe(2);
    expect(service.getNotes("typo")).toEqual([]);
    expect(service.getNotes("anatomia").sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("rename returns 0 for non-existing tag", () => {
    expect(service.rename("nonexistent", "newtag")).toBe(0);
  });

  it("autocomplete finds tags by prefix", () => {
    service.indexNote("a.md", "#anatomia");
    service.indexNote("b.md", "#anatomia-clinica");
    service.indexNote("c.md", "#fisiologia");
    const results = service.autocomplete("anat");
    expect(results).toContain("anatomia");
    expect(results).toContain("anatomia-clinica");
  });

  it("orphans returns tags with only 1 note", () => {
    service.indexNote("a.md", "#unique");
    service.indexNote("b.md", "#shared");
    service.indexNote("c.md", "#shared");
    const orphans = service.orphans();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].tag).toBe("unique");
  });

  it("top N returns most used tags", () => {
    service.indexNote("a.md", "#popular");
    service.indexNote("b.md", "#popular");
    service.indexNote("c.md", "#popular");
    service.indexNote("d.md", "#raro");
    const top = service.top(2);
    expect(top[0].tag).toBe("popular");
    expect(top[0].noteCount).toBe(3);
  });

  it("removes note and cleans tag index", () => {
    service.indexNote("a.md", "#anatomia");
    expect(service.getNotes("anatomia")).toContain("a.md");
    service.removeNote("a.md");
    expect(service.getNotes("anatomia")).toEqual([]);
  });

  it("supports aliases (setAlias)", () => {
    service.setAlias("anat", "anatomia");
    service.indexNote("a.md", "#anat");  // se trata como anatomia
    expect(service.getNotes("anatomia")).toContain("a.md");
    // El tag "anat" no existe como tag real
    expect(service.getNotes("anat")).toEqual([]);
  });

  it("stats: total tags, instances, orphans", () => {
    service.indexNote("a.md", "#tag1");
    service.indexNote("b.md", "#tag1 #tag2");
    service.indexNote("c.md", "#tag2");  // tag2 ahora tiene 2 notas
    const stats = service.stats();
    expect(stats.totalTags).toBe(2);
    expect(stats.totalTagInstances).toBe(4); // tag1:2 + tag2:2
    expect(stats.orphanTags).toBe(0);
  });

  it("clear removes everything", () => {
    service.indexNote("a.md", "#tag1");
    service.clear();
    expect(service.list()).toEqual([]);
  });
});

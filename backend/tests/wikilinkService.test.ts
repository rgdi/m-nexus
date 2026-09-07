// Tests para WikilinkService (Fase 2.B).

import { describe, it, expect, beforeEach } from "vitest";
import { WikilinkService, Wikilink } from "../src/services/wikilinkService";

describe("WikilinkService.parseWikilinks", () => {
  it("parses basic wikilink", () => {
    const links = WikilinkService.parseWikilinks("Ver [[Diafragma]] para más info");
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("Diafragma");
    expect(links[0].displayText).toBe("Diafragma");
    expect(links[0].isEmbed).toBe(false);
    expect(links[0].offset).toBe(4);
  });

  it("parses wikilink with alias", () => {
    const links = WikilinkService.parseWikilinks("El [[Diafragma|músculo respiratorio]] es importante");
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("Diafragma");
    expect(links[0].displayText).toBe("músculo respiratorio");
  });

  it("parses wikilink to section", () => {
    const links = WikilinkService.parseWikilinks("Ver [[Diafragma#Función]] para detalles");
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("Diafragma");
    expect(links[0].section).toBe("Función");
  });

  it("parses wikilink to block", () => {
    const links = WikilinkService.parseWikilinks("Ver [[Nota#^b-abc123]] específico");
    expect(links).toHaveLength(1);
    expect(links[0].target).toBe("Nota");
    expect(links[0].blockId).toBe("b-abc123");
    expect(links[0].section).toBeUndefined();
  });

  it("parses embed", () => {
    const links = WikilinkService.parseWikilinks("Imagen: ![[anatomia.png]]");
    expect(links).toHaveLength(1);
    expect(links[0].isEmbed).toBe(true);
    expect(links[0].target).toBe("anatomia.png");
  });

  it("parses note embed", () => {
    const links = WikilinkService.parseWikilinks("Ver: ![[Otra Nota]]");
    expect(links).toHaveLength(1);
    expect(links[0].isEmbed).toBe(true);
    expect(links[0].target).toBe("Otra Nota");
  });

  it("parses multiple links in one text", () => {
    const links = WikilinkService.parseWikilinks("[[A]] y [[B]] y [[C|D]]");
    expect(links).toHaveLength(3);
    expect(links[0].target).toBe("A");
    expect(links[1].target).toBe("B");
    expect(links[2].target).toBe("C");
    expect(links[2].displayText).toBe("D");
  });

  it("returns empty for text without links", () => {
    const links = WikilinkService.parseWikilinks("Texto sin links de ningún tipo");
    expect(links).toHaveLength(0);
  });

  it("handles complex nested structure", () => {
    const text = "[[A#Sec1|alias]] texto ![[B#^block1]] fin";
    const links = WikilinkService.parseWikilinks(text);
    expect(links).toHaveLength(2);
    expect(links[0].target).toBe("A");
    expect(links[0].section).toBe("Sec1");
    expect(links[0].displayText).toBe("alias");
    expect(links[1].isEmbed).toBe(true);
    expect(links[1].blockId).toBe("block1");
  });
});

describe("WikilinkService graph", () => {
  let service: WikilinkService;

  beforeEach(() => {
    service = new WikilinkService();
  });

  it("indexes a note and finds outgoing links", () => {
    service.indexNote("anatomia/diafragma.md", "El [[músculo diafragma]] se inerva por [[nervio frénico]]");
    const outgoing = service.getOutgoingLinks("anatomia/diafragma.md");
    expect(outgoing).toHaveLength(2);
    expect(outgoing[0].target.toLowerCase()).toBe("músculo diafragma");
    expect(outgoing[1].target.toLowerCase()).toBe("nervio frénico");
  });

  it("finds backlinks", () => {
    service.indexNote("anatomia/diafragma.md", "El [[nervio frénico]] es importante");
    service.indexNote("anatomia/inspiracion.md", "Durante la [[fase inspiratoria]] el [[nervio frénico]] se activa");
    const backlinks = service.getBacklinks("nervio frénico");
    expect(backlinks).toContain("anatomia/diafragma.md");
    expect(backlinks).toContain("anatomia/inspiracion.md");
    expect(backlinks).toHaveLength(2);
  });

  it("resolves links", () => {
    service.indexNote("anatomia/diafragma.md", "Contenido");
    const resolved = service.resolveLink("Anatomía/Diafragma");
    expect(resolved).toBe("anatomia/diafragma.md");
  });

  it("returns null for non-existing target", () => {
    const resolved = service.resolveLink("No existe");
    expect(resolved).toBeNull();
  });

  it("supports aliases", () => {
    service.indexNote("anatomia/diafragma.md", "Contenido");
    service.registerAlias("diafragma", "anatomia/diafragma.md");
    expect(service.resolveLink("Diafragma")).toBe("anatomia/diafragma.md");
  });

  it("removes a note and cleans incoming", () => {
    service.indexNote("a.md", "[[B]]");
    service.indexNote("b.md", "Contenido");
    expect(service.getBacklinks("b")).toContain("a.md");
    service.removeNote("a.md");
    expect(service.getBacklinks("b")).toHaveLength(0);
  });

  it("autocomplete finds notes by prefix", () => {
    service.indexNote("anatomia/diafragma.md", "x");
    service.indexNote("anatomia/diente.md", "x");
    service.indexNote("fisiologia/respiracion.md", "x");
    const results = service.autocomplete("anat");
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.includes("anat"))).toBe(true);
  });

  it("autocomplete prioritizes prefix matches", () => {
    service.indexNote("anatomia/diafragma.md", "x");
    service.indexNote("fisiologia/diafragma_relacionado.md", "x");
    const results = service.autocomplete("diaf");
    expect(results[0]).toContain("anatomia/diafragma");
  });

  it("stats: counts notes, links, orphans", () => {
    service.indexNote("a.md", "[[B]]");
    service.indexNote("b.md", "[[C]]");
    service.indexNote("c.md", "standalone content");
    service.indexNote("orphan.md", "no links in or out");
    const stats = service.stats();
    expect(stats.totalNotes).toBe(4);
    expect(stats.totalLinks).toBe(2);
    // c.md y orphan.md son orphans (sin links in ni out)
    expect(stats.orphans).toBe(2);
  });

  it("re-indexing updates links", () => {
    service.indexNote("a.md", "[[B]]");
    expect(service.getBacklinks("b")).toContain("a.md");
    service.indexNote("a.md", "no links anymore");
    expect(service.getBacklinks("b")).toHaveLength(0);
  });
});

// Tests para GraphService (Fase 2.C).

import { describe, it, expect, beforeEach } from "vitest";
import { GraphService } from "../src/services/graphService";
import { WikilinkService } from "../src/services/wikilinkService";

describe("GraphService", () => {
  let wikilinkService: WikilinkService;
  let graphService: GraphService;

  beforeEach(() => {
    wikilinkService = new WikilinkService();
    graphService = new GraphService(wikilinkService);
  });

  it("generates empty graph for empty wikilink service", () => {
    const graph = graphService.generateGraph();
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.stats.nodeCount).toBe(0);
    expect(graph.stats.density).toBe(0);
  });

  it("generates nodes for each indexed note", () => {
    wikilinkService.indexNote("a.md", "");
    wikilinkService.indexNote("b.md", "");
    wikilinkService.indexNote("c.md", "");
    const graph = graphService.generateGraph();
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("generates edges for outgoing links", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "");
    const graph = graphService.generateGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].source).toBe("a.md");
    expect(graph.edges[0].target).toBe("b.md");
  });

  it("deduplicates bidirectional edges", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "[[A]]");
    const graph = graphService.generateGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].bidirectional).toBe(true);
  });

  it("marks unidirectional edges correctly", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "no link to a");
    const graph = graphService.generateGraph();
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].bidirectional).toBe(false);
  });

  it("computes in-degree and out-degree", () => {
    wikilinkService.indexNote("a.md", "[[B]] [[C]]");
    wikilinkService.indexNote("b.md", "[[C]]");
    wikilinkService.indexNote("c.md", "");
    const graph = graphService.generateGraph();
    const a = graph.nodes.find((n) => n.id === "a.md")!;
    const b = graph.nodes.find((n) => n.id === "b.md")!;
    const c = graph.nodes.find((n) => n.id === "c.md")!;
    expect(a.outDegree).toBe(2);
    expect(a.inDegree).toBe(0);
    expect(b.outDegree).toBe(1);
    expect(b.inDegree).toBe(1);
    expect(c.inDegree).toBe(2);
    expect(c.outDegree).toBe(0);
  });

  it("sizes nodes by degree", () => {
    wikilinkService.indexNote("hub.md", "[[A]] [[B]] [[C]] [[D]] [[E]]");
    wikilinkService.indexNote("a.md", "");
    wikilinkService.indexNote("b.md", "");
    wikilinkService.indexNote("c.md", "");
    wikilinkService.indexNote("d.md", "");
    wikilinkService.indexNote("e.md", "");
    const graph = graphService.generateGraph();
    const hub = graph.nodes.find((n) => n.id === "hub.md")!;
    const leaf = graph.nodes.find((n) => n.id === "a.md")!;
    expect(hub.size).toBeGreaterThan(leaf.size);
  });

  it("uses force-directed layout (positions are not all identical)", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "[[C]]");
    wikilinkService.indexNote("c.md", "");
    const graph = graphService.generateGraph();
    // Después del layout, los nodos deben tener posiciones distintas
    const positions = new Set(graph.nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y)}`));
    expect(positions.size).toBeGreaterThan(1);
  });

  it("uses seed for deterministic layout", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "");
    const g1 = graphService.generateGraph({ seed: 42 });
    const g2 = graphService.generateGraph({ seed: 42 });
    expect(g1.nodes[0].x).toBeCloseTo(g2.nodes[0].x, 5);
    expect(g1.nodes[0].y).toBeCloseTo(g2.nodes[0].y, 5);
  });

  it("different seeds give different layouts", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "");
    const g1 = graphService.generateGraph({ seed: 42 });
    const g2 = graphService.generateGraph({ seed: 999 });
    const same = g1.nodes.every((n1, i) =>
      Math.abs(n1.x - g2.nodes[i].x) < 0.01 && Math.abs(n1.y - g2.nodes[i].y) < 0.01
    );
    expect(same).toBe(false);
  });

  it("computes graph density correctly", () => {
    // 3 nodos, 3 aristas (complete graph) → density = 1
    wikilinkService.indexNote("a.md", "[[B]] [[C]]");
    wikilinkService.indexNote("b.md", "[[C]]");
    wikilinkService.indexNote("c.md", "");
    const graph = graphService.generateGraph();
    // 3 edges, max = 3*2/2 = 3, density = 1
    expect(graph.stats.density).toBeCloseTo(1, 1);
  });

  it("counts orphans (nodes with no edges)", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "");
    wikilinkService.indexNote("orphan1.md", "");
    wikilinkService.indexNote("orphan2.md", "");
    const graph = graphService.generateGraph();
    expect(graph.stats.orphans).toBe(2);
  });

  it("respects iterations option", () => {
    wikilinkService.indexNote("a.md", "[[B]]");
    wikilinkService.indexNote("b.md", "");
    // No debe crashear con pocas o muchas iteraciones
    expect(() => graphService.generateGraph({ iterations: 1 })).not.toThrow();
    expect(() => graphService.generateGraph({ iterations: 500 })).not.toThrow();
  });
});

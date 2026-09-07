// graphService.ts: genera el grafo de notas con nodos y aristas (Fase 2.C).
//
// v0.46: backend pre-computa el grafo (nodos con posición, aristas con peso)
// usando force-directed layout simple. La app solo renderiza.
//
// Layout: posiciona nodos en un plano 2D usando simulación de fuerzas:
// - Repulsión entre nodos (Coulomb)
// - Atracción en aristas (Hooke)
// - Centroide (para mantener el grafo centrado)

import { WikilinkService, Wikilink } from "./wikilinkService.js";

export interface GraphNode {
  id: string;          // path
  label: string;       // title o basename
  x: number;
  y: number;
  /** Tamaño basado en número de links (degree) */
  size: number;
  /** Tags de la nota */
  tags: string[];
  /** In-degree (backlinks) */
  inDegree: number;
  /** Out-degree (forward links) */
  outDegree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Peso (1 si existe el link, mayor si es bidireccional) */
  weight: number;
  /** Si el link es recíproco */
  bidirectional: boolean;
}

export interface NoteGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    orphans: number;
    density: number;
  };
}

export interface GraphLayoutOptions {
  /** Iteraciones del algoritmo de layout (default 100) */
  iterations?: number;
  /** Distancia ideal entre nodos conectados (default 100) */
  idealEdgeLength?: number;
  /** Fuerza de repulsión entre nodos (default 50) */
  repulsionStrength?: number;
  /** Grafo aleatorio determinista (seed) */
  seed?: number;
}

export class GraphService {
  private wikilinkService: WikilinkService;

  constructor(wikilinkService: WikilinkService) {
    this.wikilinkService = wikilinkService;
  }

  /**
   * Genera el grafo con layout force-directed.
   */
  generateGraph(options: GraphLayoutOptions = {}): NoteGraphData {
    const iterations = options.iterations ?? 100;
    const idealEdge = options.idealEdgeLength ?? 100;
    const repulsion = options.repulsionStrength ?? 50;
    const seed = options.seed ?? 42;

    const notePaths = this.wikilinkService.listNotes();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();

    // Crear nodos
    for (const path of notePaths) {
      const outgoing = this.wikilinkService.getOutgoingLinks(path);
      const incoming = this.wikilinkService.getBacklinks(path);
      const degree = outgoing.length + incoming.length;
      nodes.push({
        id: path,
        label: this.basenameOf(path),
        x: this.seededRandom(seed, path) * 400 - 200,
        y: this.seededRandom(seed + 1, path) * 400 - 200,
        size: 5 + Math.min(15, degree * 1.5),
        tags: [],
        inDegree: incoming.length,
        outDegree: outgoing.length,
      });
    }

    // Crear aristas (deduplicadas)
    for (const sourcePath of notePaths) {
      const links = this.wikilinkService.getOutgoingLinks(sourcePath);
      for (const link of links) {
        const targetPath = this.wikilinkService.resolveLink(link.target);
        if (!targetPath || targetPath === sourcePath) continue;
        const edgeKey = sourcePath < targetPath ? `${sourcePath}|${targetPath}` : `${targetPath}|${sourcePath}`;
        if (edgeSet.has(edgeKey)) continue;
        edgeSet.add(edgeKey);
        // Verificar si es bidireccional
        const reverseLinks = this.wikilinkService.getOutgoingLinks(targetPath);
        const isBidirectional = reverseLinks.some((rl) => {
          const rlTarget = this.wikilinkService.resolveLink(rl.target);
          return rlTarget === sourcePath;
        });
        edges.push({
          source: sourcePath,
          target: targetPath,
          weight: 1,
          bidirectional: isBidirectional,
        });
      }
    }

    // Force-directed layout simulation
    for (let iter = 0; iter < iterations; iter++) {
      const forces = new Map<string, { fx: number; fy: number }>();
      for (const n of nodes) forces.set(n.id, { fx: 0, fy: 0 });

      // Repulsión entre todos los pares de nodos
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distSq = Math.max(1, dx * dx + dy * dy);
          const dist = Math.sqrt(distSq);
          const force = repulsion / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          forces.get(a.id)!.fx += fx;
          forces.get(a.id)!.fy += fy;
          forces.get(b.id)!.fx -= fx;
          forces.get(b.id)!.fy -= fy;
        }
      }

      // Atracción en aristas
      for (const edge of edges) {
        const a = nodes.find((n) => n.id === edge.source);
        const b = nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (dist - idealEdge) * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces.get(a.id)!.fx -= fx;
        forces.get(a.id)!.fy -= fy;
        forces.get(b.id)!.fx += fx;
        forces.get(b.id)!.fy += fy;
      }

      // Aplicar fuerzas con damping
      const damping = 0.5 * (1 - iter / iterations);
      for (const n of nodes) {
        const f = forces.get(n.id)!;
        n.x += f.fx * damping;
        n.y += f.fy * damping;
      }
    }

    // Stats
    const orphans = nodes.filter((n) => n.inDegree === 0 && n.outDegree === 0).length;
    const maxEdges = (nodes.length * (nodes.length - 1)) / 2;
    const density = maxEdges > 0 ? edges.length / maxEdges : 0;

    return {
      nodes,
      edges,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        orphans,
        density,
      },
    };
  }

  private basenameOf(path: string): string {
    const parts = path.split("/");
    const name = parts[parts.length - 1] ?? path;
    return name.replace(/\.md$/, "");
  }

  private seededRandom(seed: number, key: string): number {
    // Simple hash-based pseudo-random para determinismo
    let h = seed;
    for (let i = 0; i < key.length; i++) {
      h = ((h << 5) - h + key.charCodeAt(i)) | 0;
    }
    return Math.abs(Math.sin(h)) % 1;
  }
}

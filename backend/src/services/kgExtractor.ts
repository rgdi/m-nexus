/* ============================================================
 * services/kgExtractor.ts — Knowledge Graph extraction.
 *
 * v2.31.0 — Extrae entidades (conceptos) y relaciones desde
 *   notes + flashcards + journal entries y construye un grafo
 *   navegable.
 *
 * Estrategia:
 *   1. Tokenizar + lematizar (lowercased, sin acentos, sin stopwords)
 *   2. Detectar entidades multi-palabra con n-gramas (1..3) + frecuencia
 *   3. Score: TF (frecuencia en el corpus) + co-ocurrencia en la misma nota
 *   4. Relaciones: edges entre entidades que co-ocurren en la misma nota;
 *      peso = número de co-ocurrencias.
 *   5. Communities: greedy label propagation sobre el grafo (asigna
 *      comunidades que agrupan conceptos afines).
 *
 * Persistencia: backend/data/kg.json
 *   {
 *     nodes: [{ id, label, freq, community, weight }],
 *     edges: [{ source, target, weight }],
 *     documents: [{ id, entityIds[] }]
 *   }
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const DATA_DIR = join(process.cwd(), "data");
const FILE = join(DATA_DIR, "kg.json");

export interface KgNode {
  id: string;
  label: string;
  freq: number;
  community: number;
  weight: number; // pagerank-like (pageRank * 100)
}

export interface KgEdge {
  source: string;
  target: string;
  weight: number; // co-occurrence count
}

export interface KgDocument {
  id: string;
  type: "note" | "card" | "journal";
  title?: string;
  entityIds: string[];
}

export interface KgGraph {
  nodes: KgNode[];
  edges: KgEdge[];
  documents: KgDocument[];
  /** Stats globales: totalFreq, totalDocs. */
  totalFreq: number;
  totalDocs: number;
  updatedAt: number;
}

// ============ Tokenization ============

const STOPWORDS = new Set([
  "el","la","los","las","un","una","unos","unas","y","o","pero","si","no","se","le","lo",
  "de","del","al","a","en","que","qué","cuál","cuáles","cómo","dónde","cuándo","quién",
  "con","por","para","sin","sobre","entre","hasta","desde","hacia","durante","mediante",
  "es","son","fue","fueron","ser","estar","está","están","estaba","eran","sido","ser",
  "ha","han","había","he","has","hay","tener","tiene","tienen","tenía","tenían",
  "the","a","an","and","or","but","if","in","on","at","by","for","of","to","is","are",
  "was","were","be","been","being","have","has","had","do","does","did","will","would",
  "should","could","may","might","must","can","this","that","these","those","i","you",
  "he","she","it","we","they","me","him","her","us","them","my","your","his","its",
  "our","their","como","más","menos","muy","tan","también","sólo","solo","aquí","allí",
  "esto","esa","eso","este","esa","ese","estos","esas","esos","ya","aún","todavía",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function ngrams(tokens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    out.push(tokens.slice(i, i + n).join(" "));
  }
  return out;
}

function hashId(label: string): string {
  return createHash("sha1").update(label).digest("hex").slice(0, 12);
}

// ============ Extraction ============

export interface ExtractInput {
  id: string;
  type: KgDocument["type"];
  title?: string;
  text: string;
}

export interface ExtractOptions {
  /** Min frequency for a candidate entity to be promoted. */
  minFreq?: number;
  /** Max n-gram size (default 3). */
  maxNgram?: number;
}

export function extractEntities(doc: ExtractInput, opts: ExtractOptions = {}): {
  entityIds: string[];
  candidateCounts: Map<string, number>;
} {
  const maxNgram = opts.maxNgram ?? 3;
  const tokens = tokenize(doc.text);
  const counts = new Map<string, number>();
  // 1-grams
  for (const t of tokens) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // 2-3 grams
  for (let n = 2; n <= maxNgram; n++) {
    for (const ng of ngrams(tokens, n)) {
      counts.set(ng, (counts.get(ng) ?? 0) + 1);
    }
  }
  // Pick top candidates: highest count. Prefer longer n-grams when counts tie.
  const sorted = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].split(" ").length - a[0].split(" ").length;
    });
  // Limit: top 12 per document, filtered by minFreq
  const minFreq = opts.minFreq ?? 1;
  const entityIds: string[] = [];
  for (const [label, count] of sorted) {
    if (count < minFreq) break;
    entityIds.push(hashId(label));
    if (entityIds.length >= 12) break;
  }
  return { entityIds, candidateCounts: counts };
}

// ============ Graph construction ============

interface RawGraph {
  nodes: Map<string, { label: string; freq: number; docs: Set<string> }>;
  edges: Map<string, number>;
  documents: KgDocument[];
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildGraph(docs: ExtractInput[], opts: ExtractOptions = {}): KgGraph {
  const g: RawGraph = {
    nodes: new Map(),
    edges: new Map(),
    documents: [],
  };

  // Per-document entity extraction
  const docEntityLabels = new Map<string, Map<string, string>>(); // docId → id → label
  for (const doc of docs) {
    const { entityIds, candidateCounts } = extractEntities(doc, opts);
    const idToLabel = new Map<string, string>();
    for (const [label, count] of candidateCounts) {
      if (count < (opts.minFreq ?? 1)) continue;
      const id = hashId(label);
      if (entityIds.includes(id)) {
        idToLabel.set(id, label);
        const node = g.nodes.get(id) ?? { label, freq: 0, docs: new Set() };
        node.freq += count;
        node.docs.add(doc.id);
        node.label = label;
        g.nodes.set(id, node);
      }
    }
    docEntityLabels.set(doc.id, idToLabel);
    g.documents.push({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      entityIds,
    });
  }

  // Edges = co-occurrence within same doc (pairwise)
  for (const doc of docs) {
    const idToLabel = docEntityLabels.get(doc.id);
    if (!idToLabel) continue;
    const ids = Array.from(idToLabel.keys());
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = edgeKey(ids[i], ids[j]);
        g.edges.set(key, (g.edges.get(key) ?? 0) + 1);
      }
    }
  }

  // Communities: simple greedy label propagation
  const nodesArr = Array.from(g.nodes.entries());
  const community = new Map<string, number>();
  for (let i = 0; i < nodesArr.length; i++) {
    community.set(nodesArr[i][0], i);
  }
  // Iterate 3 times: each node adopts the most common community of its neighbors.
  for (let iter = 0; iter < 3; iter++) {
    for (const [a] of nodesArr) {
      const neighbors: number[] = [];
      for (const [key, w] of g.edges) {
        const [x, y] = key.split("|");
        if (x === a) neighbors.push(community.get(y) ?? 0);
        else if (y === a) neighbors.push(community.get(x) ?? 0);
      }
      if (neighbors.length === 0) continue;
      // Most common neighbor community
      const tally = new Map<number, number>();
      for (const c of neighbors) tally.set(c, (tally.get(c) ?? 0) + 1);
      let best = community.get(a) ?? 0;
      let bestCount = 0;
      for (const [c, n] of tally) {
        if (n > bestCount) {
          best = c;
          bestCount = n;
        }
      }
      community.set(a, best);
    }
  }

  // PageRank-lite: weight = freq * (1 + log(communityDensity + 1))
  const communityDensity = new Map<number, number>();
  for (const [, c] of community) {
    communityDensity.set(c, (communityDensity.get(c) ?? 0) + 1);
  }
  const nodesOut: KgNode[] = nodesArr.map(([id, n]) => ({
    id,
    label: n.label,
    freq: n.freq,
    community: community.get(id) ?? 0,
    weight: Math.round(n.freq * (1 + Math.log(communityDensity.get(community.get(id) ?? 0) ?? 1))),
  }));
  // Sort by weight desc
  nodesOut.sort((a, b) => b.weight - a.weight);

  const edgesOut: KgEdge[] = Array.from(g.edges.entries())
    .map(([key, w]) => {
      const [s, t] = key.split("|");
      return { source: s, target: t, weight: w };
    })
    .sort((a, b) => b.weight - a.weight);

  const totalFreq = nodesOut.reduce((s, n) => s + n.freq, 0);

  return {
    nodes: nodesOut,
    edges: edgesOut,
    documents: g.documents,
    totalFreq,
    totalDocs: docs.length,
    updatedAt: Date.now(),
  };
}

// ============ Persistence ============

async function persist(g: KgGraph): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(g, null, 2), "utf-8");
}

async function load(): Promise<KgGraph> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { nodes: [], edges: [], documents: [], totalFreq: 0, totalDocs: 0, updatedAt: 0 };
  }
}

export const kgExtractor = {
  async getGraph(): Promise<KgGraph> {
    return load();
  },

  async rebuild(docs: ExtractInput[], opts: ExtractOptions = {}): Promise<KgGraph> {
    const g = buildGraph(docs, opts);
    await persist(g);
    return g;
  },

  /** Filter the graph by entity or community. */
  async neighbors(entityId: string, hops: number = 1): Promise<{
    center: string;
    nodes: KgNode[];
    edges: KgEdge[];
  }> {
    const g = await load();
    if (!g.nodes.find((n) => n.id === entityId)) {
      return { center: entityId, nodes: [], edges: [] };
    }
    const visited = new Set<string>([entityId]);
    let frontier = new Set<string>([entityId]);
    for (let h = 0; h < hops; h++) {
      const next = new Set<string>();
      for (const e of g.edges) {
        if (frontier.has(e.source) && !visited.has(e.target)) next.add(e.target);
        if (frontier.has(e.target) && !visited.has(e.source)) next.add(e.source);
      }
      for (const n of next) visited.add(n);
      frontier = next;
    }
    return {
      center: entityId,
      nodes: g.nodes.filter((n) => visited.has(n.id)),
      edges: g.edges.filter((e) => visited.has(e.source) && visited.has(e.target)),
    };
  },

  /** List community summaries (label = top node by weight). */
  async communities(): Promise<Array<{ id: number; size: number; topLabel: string }>> {
    const g = await load();
    const byCommunity = new Map<number, KgNode[]>();
    for (const n of g.nodes) {
      const arr = byCommunity.get(n.community) ?? [];
      arr.push(n);
      byCommunity.set(n.community, arr);
    }
    return Array.from(byCommunity.entries())
      .map(([id, members]) => ({
        id,
        size: members.length,
        topLabel: members.sort((a, b) => b.weight - a.weight)[0]?.label ?? "?",
      }))
      .sort((a, b) => b.size - a.size);
  },

  _reset: async () => {
    try { await fs.unlink(FILE); } catch {}
  },
};

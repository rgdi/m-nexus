// autoTagger.ts — Extracts relevant tags from flashcard content (v2.11.0).
//
// Heurística:
//   - Anatomical structures (Spanish + Latin) detected by dictionary
//   - Topic keywords (lunes, meses, etc.)
//   - Generic nouns from front+back content (word freq)
//
// Real implementation would use LLM/NLP. This is a deterministic
// baseline that improves tag coverage without external API calls.

const ANATOMY_ES = [
  "húmero", "fémur", "tibia", "peroné", "radio", "cúbito", "escápula", "clavícula",
  "carpo", "metacarpo", "falanges", "tarso", "metatarso",
  "trocánter", "tróclea", "cóndilo", "epicóndilo", "troquiter", "troquín",
  "acetábulo", "glenoidea", "corredera", "fosa", "olécranon", "coronoides",
  "tibia", "peroné", "calcáneo", "astrágalo", "navicular", "cuboides",
  "hígado", "riñón", "páncreas", "bazo", "pulmón", "corazón", "estómago",
  "duodeno", "yeyuno", "íleon", "colon", "ciego", "apéndice", "recto",
  "vena", "arteria", "nervio", "músculo", "tendón", "ligamento", "fascia",
  "cerebro", "cerebelo", "médula", "tronco", "encéfalo",
];

const ANATOMY_LATIN = [
  "humerus", "femur", "tibia", "fibula", "radius", "ulna", "scapula", "clavicula",
  "carpus", "metacarpus", "tarsus", "metatarsus",
  "trochanter", "trochlea", "condylus", "epicondylus", "capitulum",
  "acetabulum", "glenoid", "fossa", "olecranon", "coronoid", "scaphoid",
  "hepar", "ren", "pancreas", "lien", "pulmo", "cor", "gaster",
  "duodenum", "jejunum", "ileum", "colon", "caecum", "appendix", "rectum",
  "vena", "arteria", "nervus", "musculus", "tendo", "ligamentum",
  "cerebrum", "cerebellum", "medulla", "encephalon",
];

const TOPIC_KEYWORDS = [
  "anatomía", "fisiología", "histología", "embriología", "bioquímica",
  "farmacología", "patología", "microbiología", "inmunología",
  "hueso", "articulación", "músculo", "nervio", "vaso", "órgano",
  "extremidad", "superior", "inferior", "tórax", "abdomen", "pelvis", "cráneo",
];

/** Extract candidate tags from text (case-insensitive, accent-insensitive). */
export function extractTags(text: string, maxTags = 5): string[] {
  if (!text) return [];
  const norm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const found = new Set<string>();
  for (const term of ANATOMY_ES) {
    const n = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (norm.includes(n)) found.add(term);
  }
  for (const term of ANATOMY_LATIN) {
    if (norm.includes(term)) found.add(term);
  }
  for (const term of TOPIC_KEYWORDS) {
    const n = term.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (norm.includes(n)) found.add(term);
  }
  // Cap and prefer longer/more specific tags
  const arr = Array.from(found);
  arr.sort((a: string, b: string) => b.length - a.length);
  return arr.slice(0, maxTags);
}

/** Extract tags for a flashcard from front+back content. */
export function tagsForFlashcard(front: string, back: string, existingTags: string[] = []): string[] {
  const combined = [front, back].filter(Boolean).join(" ");
  const extracted = extractTags(combined, 5);
  // Merge with existing (avoid duplicates), existing first
  const merged = [...new Set([...existingTags, ...extracted])];
  return merged.slice(0, 6); // cap
}

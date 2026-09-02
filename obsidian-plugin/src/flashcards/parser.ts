// Parser de respuestas del LLM → FlashcardDraft[].
// Tres estrategias:
//   - "json":   parsea JSON; usa jsonExample como schema para prompt.
//   - "markdown": extrae pares **Pregunta:** ... **Respuesta:** ... de markdown.
//   - "regex":   aplica un patrón regex custom con grupos nombrados.
//
// Diseñado para ser tolerante: si una parte falla, devuelve lo que pudo y avisa.

import { FlashcardDraft, FlashcardTemplate } from "../types";

export interface ParseResult {
  cards: FlashcardDraft[];
  warnings: string[];
  raw: string;
}

export function parseLlmResponse(
  raw: string,
  template: FlashcardTemplate,
  notePath: string
): ParseResult {
  const warnings: string[] = [];
  let cards: FlashcardDraft[] = [];

  const strategy = template.parserStrategy;
  try {
    if (strategy === "json") {
      cards = parseJsonStrategy(raw, template, notePath, warnings);
    } else if (strategy === "markdown") {
      cards = parseMarkdownStrategy(raw, template, notePath, warnings);
    } else if (strategy === "regex") {
      cards = parseRegexStrategy(raw, template, notePath, warnings);
    } else {
      warnings.push(`Estrategia desconocida: ${strategy}. Sin tarjetas.`);
    }
  } catch (e) {
    warnings.push(`Parser error: ${(e as Error).message}`);
  }

  // Asignar IDs únicos
  cards = cards.map((c, i) => {
    const withTags = autoTags(template, c, i);
    return {
      ...withTags,
      id: `${notePath}#${template.id}#${i}-${Date.now()}`,
      templateId: template.id,
      cardType: template.cardType,
    };
  });

  return { cards, warnings, raw };
}

function autoTags(template: FlashcardTemplate, c: FlashcardDraft, i: number) {
  const tags = new Set([...c.tags, ...template.autoTags]);
  c.tags = Array.from(tags);
  return c;
}

// ─── Estrategia: JSON ────────────────────────────────────────────────────

function parseJsonStrategy(
  raw: string,
  template: FlashcardTemplate,
  notePath: string,
  warnings: string[]
): FlashcardDraft[] {
  const trimmed = raw.trim();
  let data: unknown;

  // 1) JSON directo
  try {
    data = JSON.parse(trimmed);
  } catch {
    // 2) ```json ... ```
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try {
        data = JSON.parse(fence[1].trim());
      } catch {
        /* sigue */
      }
    }
  }
  // 3) Primer array/objeto balanceado
  if (data === undefined) {
    const arrStart = trimmed.indexOf("[");
    const objStart = trimmed.indexOf("{");
    let start = -1;
    let end = -1;
    if (arrStart >= 0 && (objStart < 0 || arrStart < objStart)) {
      start = arrStart;
      end = trimmed.lastIndexOf("]");
    } else if (objStart >= 0) {
      start = objStart;
      end = trimmed.lastIndexOf("}");
    }
    if (start >= 0 && end > start) {
      try {
        data = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* sigue */
      }
    }
  }

  if (data === undefined) {
    warnings.push("No se pudo extraer JSON de la respuesta. Caer a fallback markdown.");
    return parseMarkdownStrategy(raw, template, notePath, warnings);
  }

  // Aceptar tanto array como objeto {cards: [...]} o {flashcards: [...]}
  let arr: unknown[] = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.cards)) arr = obj.cards;
    else if (Array.isArray(obj.flashcards)) arr = obj.flashcards;
    else if (Array.isArray(obj.items)) arr = obj.items;
  }
  if (arr.length === 0) {
    warnings.push("JSON parseado pero no contiene tarjetas.");
    return [];
  }

  const cards: FlashcardDraft[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const front = pickString(it.front, it.question, it.q);
    const back = pickString(it.back, it.answer, it.a);
    if (!front || !back) {
      warnings.push(`Item descartado: front/back faltante → ${JSON.stringify(it).slice(0, 100)}`);
      continue;
    }
    const tags = Array.isArray(it.tags) ? (it.tags as string[]).map(String) : [];
    const sourceBlock = typeof it.section === "string" ? it.section : undefined;
    const extra: Record<string, unknown> = {};
    if (typeof it.cloze === "string") extra.cloze = it.cloze;
    if (Array.isArray(it.clozes)) extra.clozes = it.clozes;
    if (typeof it.imageRef === "string") extra.imageRef = it.imageRef;
    if (Array.isArray(it.occlusions)) extra.occlusions = it.occlusions;
    cards.push({
      id: "", // se asigna fuera
      notePath,
      templateId: template.id,
      cardType: template.cardType,
      front: cleanMarkdown(front),
      back: cleanMarkdown(back),
      tags,
      sourceBlock,
      createdAt: new Date().toISOString(),
      status: "draft",
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    });
  }
  return cards;
}

function pickString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  return undefined;
}

function cleanMarkdown(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^["']|["']$/g, "")
    .replace(/^\*+\s*|\s*\*+$/g, "")
    .replace(/\*\*\s*$/g, "")
    .trim();
}

// ─── Estrategia: Markdown ────────────────────────────────────────────────

function parseMarkdownStrategy(
  raw: string,
  template: FlashcardTemplate,
  notePath: string,
  warnings: string[]
): FlashcardDraft[] {
  const cards: FlashcardDraft[] = [];
  // Patrones aceptados (robustos, ignoran ** opcionales antes de la palabra clave):
  // **Pregunta:** <contenido>  \n  **Respuesta:** <contenido>
  // Pregunta: ...  \n  Respuesta: ...
  // Q: ... \n A: ...
  // Separador entre tarjetas: --- o línea en blanco
  const blocks = raw.split(/(?:\n\s*---\s*\n|\n\s*\n)/);
  for (const b of blocks) {
    const block = b.trim();
    if (!block) continue;
    // Capturar con grupo "front" no greedy hasta "Respuesta"/"A:"/"Back"
    const re = /^(?:\*\*)?(?:Pregunta|Question|Q|Front)(?:\*\*)?\s*[:\-—]\s*([\s\S]+?)\s*(?:\*\*)?(?:Respuesta|Answer|A|Back)(?:\*\*)?\s*[:\-—]\s*([\s\S]+?)\s*$/i;
    const m = block.match(re);
    if (m) {
      cards.push(makeCard(m[1].trim(), m[2].trim(), template, notePath));
    }
  }
  if (cards.length === 0) {
    warnings.push("Markdown: no se encontraron pares Pregunta/Respuesta.");
  }
  return cards;
}

function makeCard(front: string, back: string, template: FlashcardTemplate, notePath: string): FlashcardDraft {
  return {
    id: "",
    notePath,
    templateId: template.id,
    cardType: template.cardType,
    front: cleanMarkdown(front),
    back: cleanMarkdown(back),
    tags: [],
    createdAt: new Date().toISOString(),
    status: "draft",
  };
}

// ─── Estrategia: Regex ──────────────────────────────────────────────────

function parseRegexStrategy(
  raw: string,
  template: FlashcardTemplate,
  notePath: string,
  warnings: string[]
): FlashcardDraft[] {
  const pattern = template.parserConfig?.pattern;
  if (!pattern) {
    warnings.push("Regex strategy sin parserConfig.pattern. Sin tarjetas.");
    return [];
  }
  let re: RegExp;
  try {
    re = new RegExp(pattern, "gm");
  } catch (e) {
    warnings.push(`Regex inválido: ${(e as Error).message}`);
    return [];
  }
  const cards: FlashcardDraft[] = [];
  for (const m of raw.matchAll(re)) {
    const front = m[1]?.trim();
    const back = m[2]?.trim();
    if (!front || !back) continue;
    const tags = m[3] ? m[3].split(",").map((t) => t.trim()).filter(Boolean) : [];
    cards.push(makeCard(front, back, template, notePath));
    if (cards[cards.length - 1]) cards[cards.length - 1].tags = tags;
  }
  if (cards.length === 0) {
    warnings.push("Regex: no se encontraron matches.");
  }
  return cards;
}

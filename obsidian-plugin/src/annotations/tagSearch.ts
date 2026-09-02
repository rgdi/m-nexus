// v0.27: Sistema de tags y búsqueda de anotaciones.
// Como Samsung Notes — buscar por tag, contenido, tipo.

import type { Annotation, AnnotationStore } from "./noteAnnotations";

export interface AnnotationSearchQuery {
  /** Texto a buscar en el contenido. */
  text?: string;
  /** Tipos a incluir. */
  types?: string[];
  /** Tags a incluir (AND). */
  tags?: string[];
  /** Path de la nota (opcional, si no se especifica busca en todo el vault). */
  notePath?: string;
  /** Rango de fechas. */
  from?: string;
  to?: string;
  /** Autor. */
  author?: string;
}

export interface SearchResult {
  annotation: Annotation;
  /** Score de relevancia. */
  score: number;
  /** Fragmentos que coincidieron. */
  highlights: string[];
}

export class AnnotationSearch {
  constructor(private store: AnnotationStore) {}

  search(query: AnnotationSearchQuery): SearchResult[] {
    let candidates: Annotation[] = [];
    if (query.notePath) {
      candidates = this.store.get(query.notePath);
    } else {
      candidates = this.store.getAll();
    }

    // Filtrar por tipo
    if (query.types && query.types.length > 0) {
      candidates = candidates.filter((a) => query.types!.includes(a.type));
    }

    // Filtrar por tag
    if (query.tags && query.tags.length > 0) {
      candidates = candidates.filter((a) =>
        query.tags!.every((t) => a.tags?.includes(t))
      );
    }

    // Filtrar por autor
    if (query.author) {
      candidates = candidates.filter((a) => a.author === query.author);
    }

    // Filtrar por fecha
    if (query.from) {
      candidates = candidates.filter((a) => a.createdAt >= query.from!);
    }
    if (query.to) {
      candidates = candidates.filter((a) => a.createdAt <= query.to!);
    }

    // Buscar texto y calcular score
    const results: SearchResult[] = [];
    for (const ann of candidates) {
      // Type-safe: extraer texto de cada tipo de anotación
      let searchText = "";
      const annAny = ann as { text?: string; range?: { text?: string }; content?: string };
      searchText += annAny.text ?? "";
      if (annAny.range && typeof annAny.range === "object" && "text" in annAny.range) {
        searchText += " " + (annAny.range.text ?? "");
      }
      searchText += " " + (annAny.content ?? "");
      if (query.text) {
        const textLower = query.text.toLowerCase();
        const searchLower = searchText.toLowerCase();
        if (!searchLower.includes(textLower)) continue;
        // Score basado en frecuencia y posición
        const occurrences = (searchLower.match(new RegExp(escapeRegex(textLower), "g")) ?? []).length;
        const score = occurrences * (1 - (searchLower.indexOf(textLower) / Math.max(1, searchLower.length)));
        results.push({ annotation: ann, score, highlights: this.extractHighlights(searchText, query.text) });
      } else {
        results.push({ annotation: ann, score: 1, highlights: [] });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /** Tags únicos en el vault. */
  getAllTags(): string[] {
    const set = new Set<string>();
    for (const ann of this.store.getAll()) {
      if (ann.tags) {
        for (const t of ann.tags) set.add(t);
      }
    }
    return Array.from(set).sort();
  }

  /** Añade un tag a múltiples anotaciones. */
  async addTagToNote(notePath: string, tag: string): Promise<number> {
    const anns = this.store.get(notePath);
    let count = 0;
    for (const ann of anns) {
      const tags = new Set(ann.tags ?? []);
      tags.add(tag);
      await this.store.update(ann.id, notePath, { tags: Array.from(tags) });
      count++;
    }
    return count;
  }

  private extractHighlights(text: string, query: string): string[] {
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return [];
    const start = Math.max(0, idx - 20);
    const end = Math.min(text.length, idx + query.length + 20);
    return [text.slice(start, end)];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

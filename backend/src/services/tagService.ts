// tagService.ts: gestiona tags de notas (Fase 2.E).
//
// v0.46: sistema completo de tags con:
//   - Extracción de #tags de markdown
//   - Índice de tag -> notes[]
//   - Tag pages (query notas con un tag)
//   - Tag autocomplete
//   - Rename/merge de tags
//   - Stats (tags más usados, huérfanos)

export interface TagInfo {
  tag: string;
  noteCount: number;
  /** Notas que tienen este tag (paths) */
  notes: string[];
}

export class TagService {
  /** tag (lowercase) -> set de notePaths */
  private tagIndex: Map<string, Set<string>> = new Map();
  /** notePath -> set de tags */
  private noteTags: Map<string, Set<string>> = new Map();
  /** Aliases: tag (lowercase) -> tag canónico */
  private aliases: Map<string, string> = new Map();

  /**
   * Extrae todos los #tags de un texto.
   * Soporta #tag, #nested/tag, #tag-with-dashes, #tag_with_underscores.
   */
  static extractTags(content: string): string[] {
    const tags = new Set<string>();
    // Regex: # seguido de letras, números, guiones, underscores, slashes
    // No debe estar precedido por un word char (para evitar emails como user@example.com)
    const regex = /(?:^|[^\w/])#([a-zA-Z][a-zA-Z0-9_\-/]*)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      tags.add(m[1].toLowerCase());
    }
    // También buscar en frontmatter (formato YAML tags: [a, b, c] o tags: a, b)
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const fm = fmMatch[1];
      // tags: [tag1, tag2]
      const arrMatch = fm.match(/^tags:\s*\[(.*?)\]/m);
      if (arrMatch) {
        arrMatch[1].split(",").forEach((t) => {
          const tag = t.trim().replace(/['"]/g, "");
          if (tag) tags.add(tag.toLowerCase());
        });
      } else {
        // tags: tag1, tag2 (inline)
        const inlineMatch = fm.match(/^tags:\s*(.+)$/m);
        if (inlineMatch) {
          inlineMatch[1].split(",").forEach((t) => {
            const tag = t.trim().replace(/['"]/g, "");
            if (tag && !tag.startsWith("[")) tags.add(tag.toLowerCase());
          });
        }
      }
    }
    return Array.from(tags);
  }

  /**
   * Indexa los tags de una nota.
   */
  indexNote(path: string, content: string): string[] {
    const normalizedPath = path.trim().toLowerCase();
    // Limpiar tags anteriores
    this.removeNote(path);

    const tags = TagService.extractTags(content);
    const tagSet = new Set<string>();
    for (const tag of tags) {
      const canonical = this.aliases.get(tag) ?? tag;
      tagSet.add(canonical);
      if (!this.tagIndex.has(canonical)) {
        this.tagIndex.set(canonical, new Set());
      }
      this.tagIndex.get(canonical)!.add(normalizedPath);
    }
    this.noteTags.set(normalizedPath, tagSet);
    return Array.from(tagSet);
  }

  /**
   * Remueve una nota del índice.
   */
  removeNote(path: string): void {
    const normalizedPath = path.trim().toLowerCase();
    const oldTags = this.noteTags.get(normalizedPath);
    if (oldTags) {
      for (const tag of oldTags) {
        const set = this.tagIndex.get(tag);
        if (set) {
          set.delete(normalizedPath);
          if (set.size === 0) this.tagIndex.delete(tag);
        }
      }
    }
    this.noteTags.delete(normalizedPath);
  }

  /**
   * Lista todos los tags con sus counts.
   */
  list(): TagInfo[] {
    const result: TagInfo[] = [];
    for (const [tag, notes] of this.tagIndex) {
      result.push({
        tag,
        noteCount: notes.size,
        notes: Array.from(notes).sort(),
      });
    }
    return result.sort((a, b) => b.noteCount - a.noteCount);
  }

  /**
   * Obtiene info de un tag.
   */
  get(tag: string): TagInfo | null {
    const normalized = tag.trim().toLowerCase();
    const notes = this.tagIndex.get(normalized);
    if (!notes) return null;
    return {
      tag: normalized,
      noteCount: notes.size,
      notes: Array.from(notes).sort(),
    };
  }

  /**
   * Obtiene todas las notas con un tag.
   */
  getNotes(tag: string): string[] {
    return this.get(tag)?.notes ?? [];
  }

  /**
   * Tags de una nota específica.
   */
  getTagsForNote(path: string): string[] {
    return Array.from(this.noteTags.get(path.trim().toLowerCase()) ?? []);
  }

  /**
   * Autocompleta tags que empiezan con el query.
   */
  autocomplete(query: string, limit = 10): string[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const all = Array.from(this.tagIndex.keys());
    const starts = all.filter((t) => t.startsWith(q));
    const contains = all.filter((t) => !t.startsWith(q) && t.includes(q));
    return [...starts, ...contains].slice(0, limit);
  }

  /**
   * Renombra un tag en TODAS las notas indexadas.
   * Útil para corregir typos.
   */
  rename(oldTag: string, newTag: string): number {
    const oldN = oldTag.trim().toLowerCase();
    const newN = newTag.trim().toLowerCase();
    if (oldN === newN) return 0;
    const oldNotes = this.tagIndex.get(oldN);
    if (!oldNotes) return 0;
    let count = 0;
    // Mover notas al nuevo tag
    if (!this.tagIndex.has(newN)) this.tagIndex.set(newN, new Set());
    const newSet = this.tagIndex.get(newN)!;
    for (const notePath of oldNotes) {
      newSet.add(notePath);
      // Actualizar noteTags
      const tags = this.noteTags.get(notePath);
      if (tags) {
        tags.delete(oldN);
        tags.add(newN);
      }
      count++;
    }
    this.tagIndex.delete(oldN);
    return count;
  }

  /**
   * Crea un alias: cuando alguien use `alias`, se trata como `canonical`.
   */
  setAlias(alias: string, canonical: string): void {
    this.aliases.set(alias.trim().toLowerCase(), canonical.trim().toLowerCase());
  }

  /**
   * Tags huérfanos (con solo 1 nota).
   */
  orphans(): TagInfo[] {
    return this.list().filter((t) => t.noteCount === 1);
  }

  /**
   * Tags más usados.
   */
  top(n = 10): TagInfo[] {
    return this.list().slice(0, n);
  }

  /**
   * Stats globales.
   */
  stats(): { totalTags: number; totalTagInstances: number; orphanTags: number } {
    const totalTagInstances = Array.from(this.tagIndex.values()).reduce((s, set) => s + set.size, 0);
    return {
      totalTags: this.tagIndex.size,
      totalTagInstances,
      orphanTags: this.orphans().length,
    };
  }

  /**
   * Limpia el índice.
   */
  clear(): void {
    this.tagIndex.clear();
    this.noteTags.clear();
    this.aliases.clear();
  }
}

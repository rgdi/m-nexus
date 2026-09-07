// wikilinkService.ts: parser de [[wikilinks]] y backlinks (Fase 2.B).
//
// v0.46: parser completo que extrae wikilinks, embeds, y block references
// del texto markdown. Mantiene un grafo de notas en memoria + opcional
// persistencia en SQLite.
//
// Sintaxis soportada:
//   [[Note Name]]              → wikilink básico
//   [[Note Name|Display Text]] → wikilink con alias
//   [[Note Name#Section]]      → wikilink a sección
//   [[Note Name#^b-1234]]      → wikilink a bloque
//   ![[image.png]]             → embed
//   ![[Note Name]]             → embed de nota

export interface Wikilink {
  /** Texto mostrado (alias si hay, si no el target) */
  displayText: string;
  /** Nombre de la nota target (sin .md, sin section) */
  target: string;
  /** Path normalizado (lowercase, sin espacios extras) */
  targetPath: string;
  /** Sección opcional (#Section) */
  section?: string;
  /** Block ID opcional (#^b-xxx) */
  blockId?: string;
  /** Posición en el texto (offset) */
  offset: number;
  /** Length en el texto */
  length: number;
  /** Si es un embed (![[...]]) */
  isEmbed: boolean;
  /** Texto crudo matched */
  raw: string;
}

export interface NoteGraph {
  /** Mapa de notePath → wikilinks salientes */
  outgoing: Map<string, Wikilink[]>;
  /** Mapa de notePath → notes que la linkean (backlinks) */
  incoming: Map<string, Set<string>>;
  /** Mapa de notePath → note content (para resolver aliases) */
  notes: Map<string, string>;
  /** Mapa de alias → notePath real */
  aliases: Map<string, string>;
}

const WIKILINK_REGEX = /(!?)\[\[([^\]\n]+?)\]\]/g;

export class WikilinkService {
  private graph: NoteGraph = {
    outgoing: new Map(),
    incoming: new Map(),
    notes: new Map(),
    aliases: new Map(),
  };

  /**
   * Extrae todos los wikilinks de un texto.
   */
  static parseWikilinks(content: string): Wikilink[] {
    const links: Wikilink[] = [];
    const regex = new RegExp(WIKILINK_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const [raw, embed, inner] = match;
      const isEmbed = embed === "!";
      const offset = match.index;

      // Parsear: "Note Name|Display" o "Note Name#Section" o "Note Name#^block"
      let target = inner;
      let displayText = inner;
      let section: string | undefined;
      let blockId: string | undefined;

      // Alias: "Target|Display"
      if (target.includes("|")) {
        const parts = target.split("|");
        target = parts[0];
        displayText = parts[1];
      }

      // Section: "Target#Section" o "Target#^blockId"
      if (target.includes("#")) {
        const [t, hash] = target.split("#");
        target = t;
        if (hash.startsWith("^")) {
          blockId = hash.slice(1);
        } else {
          section = hash;
        }
      }

      // Normalizar target path (lowercase, sin acentos, sin espacios extra)
      const targetPath = target.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      links.push({
        displayText: displayText.trim(),
        target: target.trim(),
        targetPath,
        section,
        blockId,
        offset,
        length: raw.length,
        isEmbed,
        raw,
      });
    }
    return links;
  }

  /**
   * Indexa una nota en el grafo.
   * Actualiza outgoing y incoming links.
   */
  indexNote(path: string, content: string): void {
    const normalizedPath = this.normalizePath(path);
    // Si ya existía, limpiar incoming links viejos
    this.removeNote(path);

    const links = WikilinkService.parseWikilinks(content);
    this.graph.outgoing.set(normalizedPath, links);
    this.graph.notes.set(normalizedPath, content);

    // Actualizar incoming
    for (const link of links) {
      if (!this.graph.incoming.has(link.targetPath)) {
        this.graph.incoming.set(link.targetPath, new Set());
      }
      this.graph.incoming.get(link.targetPath)!.add(normalizedPath);
    }
  }

  /**
   * Remueve una nota del grafo.
   */
  removeNote(path: string): void {
    const normalizedPath = this.normalizePath(path);
    const oldLinks = this.graph.outgoing.get(normalizedPath) ?? [];
    // Limpiar incoming references
    for (const link of oldLinks) {
      const set = this.graph.incoming.get(link.targetPath);
      if (set) {
        set.delete(normalizedPath);
        if (set.size === 0) this.graph.incoming.delete(link.targetPath);
      }
    }
    this.graph.outgoing.delete(normalizedPath);
    this.graph.notes.delete(normalizedPath);
  }

  /**
   * Obtiene los backlinks (notas que linkean a esta).
   */
  getBacklinks(path: string): string[] {
    const normalizedPath = this.normalizePath(path);
    return Array.from(this.graph.incoming.get(normalizedPath) ?? []);
  }

  /**
   * Obtiene los outgoing links de una nota.
   */
  getOutgoingLinks(path: string): Wikilink[] {
    const normalizedPath = this.normalizePath(path);
    return this.graph.outgoing.get(normalizedPath) ?? [];
  }

  /**
   * Resuelve un wikilink target a un path real.
   * Si no existe la nota, retorna null.
   * Prueba: target exacto, target + .md, basename sin path.
   */
  resolveLink(target: string): string | null {
    const targetPath = this.normalizePath(target);
    // 1) Match exacto
    if (this.graph.notes.has(targetPath)) return targetPath;
    // 2) Match con .md agregado
    if (this.graph.notes.has(targetPath + ".md")) return targetPath + ".md";
    // 3) Match por basename (último segmento del path)
    const basename = targetPath.split("/").pop() ?? targetPath;
    for (const notePath of this.graph.notes.keys()) {
      const noteBasename = notePath.split("/").pop()?.replace(/\.md$/, "") ?? "";
      if (noteBasename === basename) return notePath;
    }
    // 4) Buscar por alias
    const viaAlias = this.graph.aliases.get(targetPath);
    if (viaAlias) return viaAlias;
    return null;
  }

  /** Normaliza un path: lowercase + sin acentos. */
  private normalizePath(p: string): string {
    return p.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /**
   * Registra un alias para una nota.
   */
  registerAlias(alias: string, realPath: string): void {
    this.graph.aliases.set(alias.trim().toLowerCase(), realPath.trim().toLowerCase());
  }

  /**
   * Lista todas las notas indexadas.
   */
  listNotes(): string[] {
    return Array.from(this.graph.notes.keys());
  }

  /**
   * Stats del grafo.
   */
  stats(): { totalNotes: number; totalLinks: number; orphans: number } {
    const totalNotes = this.graph.notes.size;
    const totalLinks = Array.from(this.graph.outgoing.values()).reduce((s, l) => s + l.length, 0);
    // Orphans = notas sin incoming ni outgoing
    const orphans = Array.from(this.graph.notes.keys()).filter((p) => {
      const outgoing = this.graph.outgoing.get(p) ?? [];
      const incoming = this.graph.incoming.get(p) ?? new Set();
      return outgoing.length === 0 && incoming.size === 0;
    }).length;
    return { totalNotes, totalLinks, orphans };
  }

  /**
   * Encuentra notas que matchean un query (autocomplete).
   * Usado por [[popup de notas al escribir.
   */
  autocomplete(query: string, limit = 10): string[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const all = Array.from(this.graph.notes.keys());
    // Coincidencias que empiezan con el query primero
    const starts = all.filter((p) => p.toLowerCase().startsWith(q));
    const contains = all.filter((p) => !p.toLowerCase().startsWith(q) && p.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, limit);
  }

  /**
   * Limpia el grafo.
   */
  clear(): void {
    this.graph.outgoing.clear();
    this.graph.incoming.clear();
    this.graph.notes.clear();
    this.graph.aliases.clear();
  }
}

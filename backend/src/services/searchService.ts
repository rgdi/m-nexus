// searchService.ts: búsqueda full-text sobre notas (Fase 2.A).
//
// v0.46: usa FTS5 virtual table de better-sqlite3 (si SQLite lo soporta)
// con fallback a LIKE search si FTS5 no está disponible.
//
// Estrategia:
//   1) Indexar notas en tabla `notes_fts` con porter stemming
//   2) Query con `MATCH` (full-text) cuando hay términos multi-word
//   3) Fallback a `LIKE %term%` para queries simples o single-word cortos
//
// FTS5 vs LIKE:
//   - FTS5: tokeniza, stemming, ranking BM25, sub-50ms en 10K notas
//   - LIKE: O(n*m), sin ranking, pero compatible con todo

import Database from "better-sqlite3";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCall } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
import * as path from "node:path";
import * as fs from "node:fs";

export interface SearchResult {
  path: string;
  title: string;
  snippet: string;  // primeros 200 chars con highlight
  score: number;    // 0-1, ranking
  matchedTerms: string[];
  modified: number;  // epoch ms
  tags: string[];
}

export interface SearchOptions {
  /** Limitar a N resultados (default 50) */
  limit?: number;
  /** Filtrar por tags (AND) */
  tags?: string[];
  /** Filtrar por tipo de archivo */
  fileType?: "note" | "flashcard";
}

export class SearchService {
  private db: Database.Database;
  private dbPath: string;
  private fts5Available: boolean = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(process.cwd(), ".mnexus-search.db");
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    // Detectar FTS5
    try {
      // Probar crear tabla FTS5
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts5_test USING fts5(x)");
      this.db.exec("DROP TABLE _fts5_test");
      this.fts5Available = true;
    } catch (e) {
      this.fts5Available = false;
      logError("search", {
        code: "EC-SEARCH-001",
        category: "EXT",
        message: "FTS5 not available in this SQLite build, falling back to LIKE",
        context: { err: e instanceof Error ? e.message : String(e) },
        hint: "better-sqlite3 needs to be built with FTS5 support; on most platforms this works by default",
      });
    }

    // Tabla principal de notas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        modified INTEGER NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_notes_modified ON notes(modified DESC)");

    // FTS5 virtual table
    if (this.fts5Available) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title, content, tags,
          content='notes', content_rowid='rowid',
          tokenize='porter unicode61'
        )
      `);
      // Triggers para mantener FTS sincronizado
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
        END
      `);
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content, tags) VALUES('delete', old.rowid, old.title, old.content, old.tags);
          INSERT INTO notes_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
        END
      `);
    }
  }

  /** Indexa o actualiza una nota. */
  indexNote(note: { path: string; title: string; content: string; tags?: string[]; modified: number }): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO notes (path, title, content, tags, modified, word_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const wordCount = note.content.split(/\s+/).filter((w) => w.length > 0).length;
    stmt.run(
      note.path,
      note.title,
      note.content,
      JSON.stringify(note.tags ?? []),
      note.modified,
      wordCount
    );
  }

  /** Indexa múltiples notas en una transacción. */
  indexNotes(notes: Array<{ path: string; title: string; content: string; tags?: string[]; modified: number }>): number {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO notes (path, title, content, tags, modified, word_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: typeof notes) => {
      for (const n of items) {
        const wc = n.content.split(/\s+/).filter((w) => w.length > 0).length;
        insert.run(n.path, n.title, n.content, JSON.stringify(n.tags ?? []), n.modified, wc);
      }
    });
    tx(notes);
    return notes.length;
  }

  /** Borra una nota del índice. */
  removeNote(path: string): void {
    this.db.prepare("DELETE FROM notes WHERE path = ?").run(path);
  }

  /** Cuenta notas indexadas. */
  count(): number {
    const r = this.db.prepare("SELECT COUNT(*) as c FROM notes").get() as { c: number };
    return r.c;
  }

  /**
   * Busca notas por query.
   * - Si query tiene 2+ palabras: usa FTS5 con OR (más flexible que phrase)
   * - Si es single word: usa FTS5 si disponible, sino LIKE
   * - Si FTS5 no disponible: LIKE search
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 50;
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    // Construir query FTS5: cada palabra como término OR (no phrase)
    // Ej: "ciclo krebs" -> "ciclo OR krebs"
    const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
    const ftsQuery = words.map((w) => {
      const escaped = w.replace(/"/g, '""');
      return `"${escaped}"`;
    }).join(" OR ");

    let rows: Array<{ path: string; title: string; content: string; tags: string; modified: number; rank?: number }> = [];

    if (this.fts5Available && trimmed.split(/\s+/).length >= 1) {
      try {
        // BM25 ranking: menor rank = mejor match
        const stmt = this.db.prepare(`
          SELECT n.path, n.title, n.content, n.tags, n.modified, bm25(notes_fts) as rank
          FROM notes_fts
          JOIN notes n ON n.rowid = notes_fts.rowid
          WHERE notes_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `);
        rows = stmt.all(ftsQuery, limit) as typeof rows;
      } catch (e) {
        // Si la query es inválida para FTS5, fallback a LIKE
        logError("search", {
          code: "EC-SEARCH-002",
          category: "EXT",
          message: "FTS5 query failed, falling back to LIKE",
          context: { query: trimmed, err: e instanceof Error ? e.message : String(e) },
        });
        rows = this.likeSearch(trimmed, limit);
      }
    } else {
      rows = this.likeSearch(trimmed, limit);
    }

    // Filtrar por tags si se especificaron
    let filtered = rows;
    if (options.tags && options.tags.length > 0) {
      filtered = rows.filter((r) => {
        try {
          const noteTags = JSON.parse(r.tags) as string[];
          return options.tags!.every((t) => noteTags.includes(t));
        } catch {
          return false;
        }
      });
    }

    // Convertir a SearchResult
    return filtered.map((r) => {
      const snippet = this.makeSnippet(r.content, trimmed);
      const matchedTerms = this.extractMatchedTerms(r.content, trimmed);
      // BM25 rank es negativo, menor = mejor. Normalizar a 0-1 (aprox)
      const score = r.rank != null ? Math.max(0, Math.min(1, 1 / (1 + Math.abs(r.rank)))) : 0.5;
      let tags: string[] = [];
      try {
        tags = JSON.parse(r.tags);
      } catch {}
      return {
        path: r.path,
        title: r.title,
        snippet,
        score,
        matchedTerms,
        modified: r.modified,
        tags,
      };
    });
  }

  private likeSearch(query: string, limit: number): Array<{ path: string; title: string; content: string; tags: string; modified: number }> {
    const stmt = this.db.prepare(`
      SELECT path, title, content, tags, modified
      FROM notes
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY modified DESC
      LIMIT ?
    `);
    const pattern = `%${query}%`;
    return stmt.all(pattern, pattern, limit) as Array<{ path: string; title: string; content: string; tags: string; modified: number }>;
  }

  private makeSnippet(content: string, query: string, maxLen = 200): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerContent.indexOf(lowerQuery.split(/\s+/)[0]);
    if (idx === -1) {
      return content.slice(0, maxLen).trim() + (content.length > maxLen ? "…" : "");
    }
    const start = Math.max(0, idx - 50);
    const end = Math.min(content.length, idx + 150);
    return (start > 0 ? "…" : "") + content.slice(start, end).trim() + (end < content.length ? "…" : "");
  }

  private extractMatchedTerms(content: string, query: string): string[] {
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    const lower = content.toLowerCase();
    return terms.filter((t) => lower.includes(t));
  }

  /** Stats del índice. */
  stats(): { total: number; fts5: boolean; dbPath: string } {
    return {
      total: this.count(),
      fts5: this.fts5Available,
      dbPath: this.dbPath,
    };
  }

  /** Cierra la DB. */
  close(): void {
    this.db.close();
  }

  /** Borra todo el índice. */
  clear(): void {
    this.db.exec("DELETE FROM notes");
    if (this.fts5Available) {
      this.db.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
    }
  }
}

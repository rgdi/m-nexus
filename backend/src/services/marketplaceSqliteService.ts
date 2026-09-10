// marketplaceSqliteService.ts: marketplace con persistencia REAL en SQLite.
//
// v0.61.0: migracion desde in-memory (v0.60) a better-sqlite3.
// Las reviews, installs y deck metadata persisten entre reinicios.

import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { logOp } from "../utils/log.js";

export interface DeckRow {
  id: string;
  name: string;
  description: string;
  author_id: string;
  author_name: string;
  tags: string; // JSON array
  card_count: number;
  language: string;
  category: string;
  official: number; // 0/1
  created_at: number;
  updated_at: number;
  total_installs: number;
  rating: number;
  rating_count: number;
  price_cents: number;
}

export interface ReviewRow {
  id: string;
  deck_id: string;
  user_id: string;
  user_name: string;
  rating: number;
  comment: string;
  created_at: number;
}

export interface InstallRow {
  id: string;
  user_id: string;
  deck_id: string;
  version: string;
  installed_at: number;
  subscribed: number;
}

export interface DeckVersionRow {
  id: string;
  deck_id: string;
  version: string;
  changelog: string;
  apkg_url: string;
  size_bytes: number;
  card_count: number;
  created_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  card_count INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL DEFAULT 'general',
  official INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  total_installs INTEGER NOT NULL DEFAULT 0,
  rating REAL NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_decks_category ON decks(category);
CREATE INDEX IF NOT EXISTS idx_decks_language ON decks(language);
CREATE INDEX IF NOT EXISTS idx_decks_rating ON decks(rating DESC);

CREATE TABLE IF NOT EXISTS deck_versions (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  version TEXT NOT NULL,
  changelog TEXT NOT NULL DEFAULT '',
  apkg_url TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  card_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_versions_deck ON deck_versions(deck_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reviews_deck ON reviews(deck_id);

CREATE TABLE IF NOT EXISTS installs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  version TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  subscribed INTEGER NOT NULL DEFAULT 1,
  UNIQUE (user_id, deck_id),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_installs_user ON installs(user_id);

CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0,
  total_decks INTEGER NOT NULL DEFAULT 0,
  total_earnings_cents INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL
);
`;

class MarketplaceSqliteService {
  private db: Database.Database;
  private stmts: {
    insertDeck: Database.Statement;
    getDeck: Database.Statement;
    listDecks: Database.Statement;
    updateDeckRating: Database.Statement;
    incInstalls: Database.Statement;
    insertVersion: Database.Statement;
    getVersions: Database.Statement;
    insertReview: Database.Statement;
    getReviews: Database.Statement;
    insertInstall: Database.Statement;
    getInstall: Database.Statement;
    getUserInstalls: Database.Statement;
    isInstalled: Database.Statement;
  };

  constructor(dbPath: string = "./marketplace.db") {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.stmts = this.prepareStmts();
    if (this.countDecks() === 0) this.seed();
    logOp("marketplace-sqlite", "initialized", true, { path: dbPath });
  }

  private prepareStmts() {
    return {
      insertDeck: this.db.prepare(`INSERT INTO decks
        (id, name, description, author_id, author_name, tags, card_count, language, category, official, created_at, updated_at, total_installs, rating, rating_count, price_cents)
        VALUES (@id, @name, @description, @author_id, @author_name, @tags, @card_count, @language, @category, @official, @created_at, @updated_at, @total_installs, @rating, @rating_count, @price_cents)`),
      getDeck: this.db.prepare("SELECT * FROM decks WHERE id = ?"),
      listDecks: this.db.prepare("SELECT * FROM decks ORDER BY rating DESC, total_installs DESC"),
      updateDeckRating: this.db.prepare("UPDATE decks SET rating = ?, rating_count = ?, updated_at = ? WHERE id = ?"),
      incInstalls: this.db.prepare("UPDATE decks SET total_installs = total_installs + 1, updated_at = ? WHERE id = ?"),
      insertVersion: this.db.prepare(`INSERT INTO deck_versions
        (id, deck_id, version, changelog, apkg_url, size_bytes, card_count, created_at)
        VALUES (@id, @deck_id, @version, @changelog, @apkg_url, @size_bytes, @card_count, @created_at)`),
      getVersions: this.db.prepare("SELECT * FROM deck_versions WHERE deck_id = ? ORDER BY created_at ASC"),
      insertReview: this.db.prepare(`INSERT INTO reviews
        (id, deck_id, user_id, user_name, rating, comment, created_at)
        VALUES (@id, @deck_id, @user_id, @user_name, @rating, @comment, @created_at)`),
      getReviews: this.db.prepare("SELECT * FROM reviews WHERE deck_id = ? ORDER BY created_at DESC"),
      insertInstall: this.db.prepare(`INSERT OR REPLACE INTO installs
        (id, user_id, deck_id, version, installed_at, subscribed)
        VALUES (@id, @user_id, @deck_id, @version, @installed_at, @subscribed)`),
      getInstall: this.db.prepare("SELECT * FROM installs WHERE user_id = ? AND deck_id = ?"),
      getUserInstalls: this.db.prepare("SELECT * FROM installs WHERE user_id = ?"),
      isInstalled: this.db.prepare("SELECT 1 as x FROM installs WHERE user_id = ? AND deck_id = ?"),
    };
  }

  private countDecks(): number {
    const r = this.db.prepare("SELECT COUNT(*) as c FROM decks").get() as { c: number };
    return r.c;
  }

  private seed() {
    const now = Date.now();
    // Autor oficial
    this.db.prepare(`INSERT OR IGNORE INTO authors (id, name, bio, verified, total_decks, total_earnings_cents, joined_at)
      VALUES ('mnexus', 'M-NEXUS Team', 'Equipo oficial', 1, 3, 0, ?)`).run(now - 86400000 * 1000);
    const seedDecks = [
      { id: "anatomia-clinica-es", name: "Anatomía Clínica (español)", category: "anatomy", card_count: 850,
        description: "Deck de anatomía con enfoque clínico. Imágenes, relaciones, casos.",
        tags: ["anatomia", "clinica", "espanol", "medicina"] },
      { id: "farmacologia-basica", name: "Farmacología Básica", category: "pharmacology", card_count: 1200,
        description: "Mecanismos de acción, famacocinética, efectos adversos de los fármacos más comunes.",
        tags: ["farmacologia", "medicina", "espanol"] },
      { id: "histologia-celulas", name: "Histología: Células y Tejidos", category: "pathology", card_count: 600,
        description: "Imágenes de microscopía con descripciones detalladas. Ideal para bio y med.",
        tags: ["histologia", "biologia", "medicina"] },
    ];
    for (const sd of seedDecks) {
      this.stmts.insertDeck.run({
        id: sd.id,
        name: sd.name,
        description: sd.description,
        author_id: "mnexus",
        author_name: "M-NEXUS Team",
        tags: JSON.stringify(sd.tags),
        card_count: sd.card_count,
        language: "es",
        category: sd.category,
        official: 1,
        created_at: now - 86400000 * 1000,
        updated_at: now,
        total_installs: 2000 + Math.floor(Math.random() * 1000),
        rating: 4.0 + Math.random() * 0.9,
        rating_count: 100 + Math.floor(Math.random() * 300),
        price_cents: 0,
      });
      this.stmts.insertVersion.run({
        id: `${sd.id}-1.0.0`,
        deck_id: sd.id,
        version: "1.0.0",
        changelog: "Version inicial",
        apkg_url: `/api/v1/marketplace/${sd.id}/download/1.0.0`,
        size_bytes: sd.card_count * 1024,
        card_count: sd.card_count,
        created_at: now,
      });
    }
  }

  // ── Decks ──
  listDecks(opts?: { category?: string; language?: string; search?: string; official?: boolean }): DeckRow[] {
    let list = this.stmts.listDecks.all() as DeckRow[];
    if (opts?.category) list = list.filter(d => d.category === opts.category);
    if (opts?.language) list = list.filter(d => d.language === opts.language);
    if (opts?.official !== undefined) list = list.filter(d => (d.official === 1) === opts.official);
    if (opts?.search) {
      const s = opts.search.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      list = list.filter(d => {
        const n = d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const desc = d.description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return n.includes(s) || desc.includes(s);
      });
    }
    return list;
  }

  getDeck(id: string): DeckRow | undefined {
    return this.stmts.getDeck.get(id) as DeckRow | undefined;
  }

  getVersions(deckId: string): DeckVersionRow[] {
    return this.stmts.getVersions.all(deckId) as DeckVersionRow[];
  }

  getLatestVersion(deckId: string): DeckVersionRow | undefined {
    const vs = this.getVersions(deckId);
    return vs.length > 0 ? vs[vs.length - 1] : undefined;
  }

  /// v0.61.0: crear deck user-uploaded.
  createDeck(input: Omit<DeckRow, "created_at" | "updated_at" | "total_installs" | "rating" | "rating_count">): DeckRow {
    const now = Date.now();
    const row: DeckRow = { ...input, created_at: now, updated_at: now, total_installs: 0, rating: 0, rating_count: 0 };
    this.stmts.insertDeck.run(row);
    // Version inicial
    this.stmts.insertVersion.run({
      id: `${row.id}-1.0.0`,
      deck_id: row.id,
      version: "1.0.0",
      changelog: "Version inicial",
      apkg_url: `/api/v1/marketplace/${row.id}/download/1.0.0`,
      size_bytes: row.card_count * 1024,
      card_count: row.card_count,
      created_at: now,
    });
    logOp("marketplace-sqlite", "deck created", true, { id: row.id });
    return this.getDeck(row.id)!;
  }

  // ── Reviews ──
  getReviews(deckId: string): ReviewRow[] {
    return this.stmts.getReviews.all(deckId) as ReviewRow[];
  }

  addReview(input: Omit<ReviewRow, "id" | "created_at">): ReviewRow {
    if (input.rating < 1 || input.rating > 5) throw new Error("rating fuera de rango");
    const r: ReviewRow = { ...input, id: `rev-${randomUUID()}`, created_at: Date.now() };
    // v0.61.0: transaccion para atomic update
    const tx = this.db.transaction(() => {
      this.stmts.insertReview.run(r);
      const deck = this.getDeck(input.deck_id);
      if (deck) {
        const total = deck.rating * deck.rating_count + input.rating;
        const count = deck.rating_count + 1;
        const avg = total / count;
        this.stmts.updateDeckRating.run(avg, count, Date.now(), input.deck_id);
      }
    });
    tx();
    return r;
  }

  // ── Installs ──
  install(userId: string, deckId: string, subscribed = true): InstallRow | null {
    const deck = this.getDeck(deckId);
    if (!deck) return null;
    const latest = this.getLatestVersion(deckId);
    if (!latest) return null;
    const existing = this.stmts.getInstall.get(userId, deckId) as InstallRow | undefined;
    const i: InstallRow = {
      id: existing?.id ?? `inst-${randomUUID()}`,
      user_id: userId,
      deck_id: deckId,
      version: latest.version,
      installed_at: Date.now(),
      subscribed: subscribed ? 1 : 0,
    };
    this.stmts.insertInstall.run(i);
    if (!existing) {
      this.stmts.incInstalls.run(Date.now(), deckId);
    }
    logOp("marketplace-sqlite", "installed", true, { userId, deckId, version: latest.version });
    return i;
  }

  isInstalled(userId: string, deckId: string): boolean {
    return !!this.stmts.isInstalled.get(userId, deckId);
  }

  getUserInstalls(userId: string): InstallRow[] {
    return this.stmts.getUserInstalls.all(userId) as InstallRow[];
  }

  // ── Stats ──
  stats() {
    const totalDecks = (this.db.prepare("SELECT COUNT(*) as c FROM decks").get() as any).c;
    const totalInstalls = (this.db.prepare("SELECT SUM(total_installs) as s FROM decks").get() as any).s || 0;
    const totalAuthors = (this.db.prepare("SELECT COUNT(*) as c FROM authors").get() as any).c;
    const totalReviews = (this.db.prepare("SELECT COUNT(*) as c FROM reviews").get() as any).c;
    const avgRating = (this.db.prepare("SELECT AVG(rating) as a FROM decks WHERE rating_count > 0").get() as any).a || 0;
    const topCategories = this.db.prepare(`SELECT category, COUNT(*) as c FROM decks GROUP BY category ORDER BY c DESC LIMIT 5`).all();
    return { totalDecks, totalInstalls, totalAuthors, totalReviews, avgRating, topCategories };
  }

  /// v0.61.0: cierre de la DB.
  close() {
    this.db.close();
  }
}

let _instance: MarketplaceSqliteService | null = null;
export function getMarketplaceSqliteService(dbPath?: string): MarketplaceSqliteService {
  if (!_instance) _instance = new MarketplaceSqliteService(dbPath);
  return _instance;
}
/// Para tests: reset singleton
export function __resetMarketplaceSqlite() {
  if (_instance) { try { _instance.close(); } catch {} }
  _instance = null;
}

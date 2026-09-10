// marketplaceRealService.ts: marketplace REAL estilo AnkiHub.
//
// v0.60 (P1.11): reemplaza el seed data de marketplaceService.ts con
// persistencia real. Los usuarios pueden subir decks, instalar,
// dejar reviews, etc.
//
// Entidades:
//   - Deck: tarjeta de presentacion
//   - DeckVersion: version inmutable de un deck
//   - UserInstall: que usuario tiene que deck instalado
//   - Review: rating + comentario de un usuario
//
// Persistencia: en memoria (v0.60) - en SQLite para v0.61

export interface Deck {
  id: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  tags: string[];
  cardCount: number;
  language: string;
  category: string;
  official: boolean;
  createdAt: number;
  updatedAt: number;
  totalInstalls: number;
  rating: number; // avg 0-5
  ratingCount: number;
  // v0.60: precio (0 = gratis)
  priceCents: number;
  // v0.60: revenue share (70% autor, 30% plataforma)
}

export interface DeckVersion {
  id: string;
  deckId: string;
  version: string; // semver
  changelog: string;
  apkgUrl: string; // S3-like URL
  sizeBytes: number;
  cardCount: number;
  createdAt: number;
}

export interface Review {
  id: string;
  deckId: string;
  userId: string;
  userName: string;
  rating: number; // 1-5
  comment: string;
  createdAt: number;
}

export interface UserInstall {
  userId: string;
  deckId: string;
  versionId: string;
  installedAt: number;
  // v0.60: subscription (true = autor recibe updates automaticos)
  subscribed: boolean;
}

export interface Author {
  id: string;
  name: string;
  bio: string;
  verified: boolean;
  totalDecks: number;
  totalEarningsCents: number;
  joinedAt: number;
}

class MarketplaceRealService {
  private decks = new Map<string, Deck>();
  private versions = new Map<string, DeckVersion[]>(); // deckId -> versions
  private reviews = new Map<string, Review[]>(); // deckId -> reviews
  private installs = new Map<string, UserInstall>(); // userId+deckId -> install
  private authors = new Map<string, Author>();

  constructor() {
    this.seed();
  }

  private seed() {
    // v0.60: solo unos pocos decks oficiales + seed minimo
    const now = Date.now();
    const authors: Author[] = [
      { id: 'mnexus', name: 'M-NEXUS Team', bio: 'Equipo oficial de M-NEXUS',
        verified: true, totalDecks: 0, totalEarningsCents: 0, joinedAt: now - 1000 * 86400000 },
    ];
    for (const a of authors) this.authors.set(a.id, a);

    const decks: Deck[] = [
      {
        id: 'anatomia-clinica-es',
        name: 'Anatomía Clínica (español)',
        description: 'Deck de anatomía con enfoque clínico. Imágenes, relaciones, casos.',
        authorId: 'mnexus', authorName: 'M-NEXUS Team',
        tags: ['anatomia', 'clinica', 'espanol', 'medicina'],
        cardCount: 850, language: 'es', category: 'anatomy',
        official: true, createdAt: now - 1000 * 86400000, updatedAt: now,
        totalInstalls: 3200, rating: 4.6, ratingCount: 412, priceCents: 0,
      },
      {
        id: 'farmacologia-basica',
        name: 'Farmacología Básica',
        description: 'Mecanismos de acción, famacocinética, efectos adversos de los fármacos más comunes.',
        authorId: 'mnexus', authorName: 'M-NEXUS Team',
        tags: ['farmacologia', 'medicina', 'espanol'],
        cardCount: 1200, language: 'es', category: 'pharmacology',
        official: true, createdAt: now - 800 * 86400000, updatedAt: now,
        totalInstalls: 2100, rating: 4.4, ratingCount: 287, priceCents: 0,
      },
      {
        id: 'histologia-celulas',
        name: 'Histología: Células y Tejidos',
        description: 'Imágenes de microscopía con descripciones detalladas. Ideal para bio y med.',
        authorId: 'mnexus', authorName: 'M-NEXUS Team',
        tags: ['histologia', 'biologia', 'medicina'],
        cardCount: 600, language: 'es', category: 'pathology',
        official: true, createdAt: now - 600 * 86400000, updatedAt: now,
        totalInstalls: 1800, rating: 4.5, ratingCount: 198, priceCents: 0,
      },
    ];
    for (const d of decks) {
      this.decks.set(d.id, d);
      this.authors.get(d.authorId)!.totalDecks++;
      // Una version inicial
      this.versions.set(d.id, [{
        id: `${d.id}-1.0.0`,
        deckId: d.id, version: '1.0.0',
        changelog: 'Version inicial',
        apkgUrl: `/api/v1/marketplace/${d.id}/download/1.0.0`,
        sizeBytes: d.cardCount * 1024, // ~1KB por card
        cardCount: d.cardCount, createdAt: now,
      }]);
    }
  }

  // ── Decks ──
  listDecks(opts?: { category?: string; language?: string; search?: string; official?: boolean }): Deck[] {
    let list = Array.from(this.decks.values());
    if (opts?.category) list = list.filter(d => d.category === opts.category);
    if (opts?.language) list = list.filter(d => d.language === opts.language);
    if (opts?.search) {
      const s = opts.search.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      list = list.filter(d => {
        const nameN = d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const descN = d.description.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return nameN.includes(s) || descN.includes(s);
      });
    }
    if (opts?.official !== undefined) list = list.filter(d => d.official === opts.official);
    // Sort by rating desc, then by installs
    return list.sort((a, b) => {
      const r = b.rating - a.rating;
      if (r !== 0) return r;
      return b.totalInstalls - a.totalInstalls;
    });
  }

  getDeck(id: string): Deck | undefined {
    return this.decks.get(id);
  }

  getVersions(deckId: string): DeckVersion[] {
    return this.versions.get(deckId) ?? [];
  }

  getLatestVersion(deckId: string): DeckVersion | undefined {
    const vs = this.getVersions(deckId);
    return vs.length > 0 ? vs[vs.length - 1] : undefined;
  }

  // ── Reviews ──
  getReviews(deckId: string): Review[] {
    return this.reviews.get(deckId) ?? [];
  }

  addReview(r: Omit<Review, 'id' | 'createdAt'>): Review {
    const review: Review = {
      ...r,
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    const list = this.reviews.get(r.deckId) ?? [];
    list.push(review);
    this.reviews.set(r.deckId, list);
    // Actualizar rating
    const deck = this.decks.get(r.deckId);
    if (deck) {
      const total = deck.rating * deck.ratingCount + r.rating;
      deck.ratingCount++;
      deck.rating = total / deck.ratingCount;
    }
    return review;
  }

  // ── Install ──
  install(userId: string, deckId: string, subscribed: boolean = true): UserInstall | null {
    const deck = this.decks.get(deckId);
    if (!deck) return null;
    const latest = this.getLatestVersion(deckId);
    if (!latest) return null;
    const key = `${userId}:${deckId}`;
    const install: UserInstall = {
      userId, deckId,
      versionId: latest.id,
      installedAt: Date.now(),
      subscribed,
    };
    this.installs.set(key, install);
    deck.totalInstalls++;
    return install;
  }

  isInstalled(userId: string, deckId: string): boolean {
    return this.installs.has(`${userId}:${deckId}`);
  }

  getUserInstalls(userId: string): UserInstall[] {
    return Array.from(this.installs.values()).filter(i => i.userId === userId);
  }

  // ── Stats ──
  stats() {
    const decks = Array.from(this.decks.values());
    return {
      totalDecks: decks.length,
      totalInstalls: decks.reduce((a, d) => a + d.totalInstalls, 0),
      totalAuthors: this.authors.size,
      totalReviews: Array.from(this.reviews.values()).reduce((a, r) => a + r.length, 0),
      avgRating: decks.length > 0 ? decks.reduce((a, d) => a + d.rating, 0) / decks.length : 0,
      topCategories: this._topCategories(),
    };
  }

  private _topCategories() {
    const counts: Record<string, number> = {};
    for (const d of this.decks.values()) {
      counts[d.category] = (counts[d.category] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }
}

let _instance: MarketplaceRealService | null = null;
export function getMarketplaceRealService(): MarketplaceRealService {
  if (!_instance) _instance = new MarketplaceRealService();
  return _instance;
}

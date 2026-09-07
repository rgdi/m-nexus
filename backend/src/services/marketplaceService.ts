// marketplaceService.ts: marketplace de decks/plantillas (Fase 5).
//
// v0.46: marketplace local (sin HTTP real) con seed data de decks médicos
// populares estilo Anki. La idea es que el cliente pueda descargar
// decks de ejemplo y empezar a estudiar inmediatamente.

export interface Deck {
  id: string;
  name: string;
  description: string;
  author: string;
  /** Tags del deck */
  tags: string[];
  /** Número de cards en el deck */
  cardCount: number;
  /** Idioma del deck */
  language: "en" | "es" | "pt" | "multi";
  /** Rating promedio (0-5) */
  rating: number;
  /** Número de instalaciones */
  installs: number;
  /** Categoría */
  category: "medical" | "anatomy" | "pharmacology" | "pathology" | "general" | "language";
  /** Última actualización */
  updatedAt: string;
  /** Si es oficial (mantenido por el equipo de M-NEXUS) */
  official: boolean;
  /** URL o path del deck file */
  downloadUrl?: string;
  /** Tamaño aproximado del deck en MB */
  sizeMB?: number;
}

const SEED_DECKS: Deck[] = [
  {
    id: "usmle-step1",
    name: "USMLE Step 1 — Anki deck clásico",
    description: "El deck más usado para preparar el USMLE Step 1. ~25K cards basadas en First Aid.",
    author: "u/AnKingMed",
    tags: ["usmle", "step1", "medicina", "english"],
    cardCount: 25000,
    language: "en",
    rating: 4.8,
    installs: 1250000,
    category: "medical",
    updatedAt: "2026-08-15",
    official: false,
    sizeMB: 145,
  },
  {
    id: "anatomia-clinica-es",
    name: "Anatomía Clínica (español)",
    description: "Deck de anatomía con enfoque clínico. Imágenes, relaciones, casos.",
    author: "M-NEXUS",
    tags: ["anatomia", "clinica", "espanol"],
    cardCount: 850,
    language: "es",
    rating: 4.6,
    installs: 3200,
    category: "anatomy",
    updatedAt: "2026-09-01",
    official: true,
    sizeMB: 28,
  },
  {
    id: "farmacologia-essencial",
    name: "Farmacología Esencial",
    description: "Los 200 fármacos más usados en clínica. Mecanismo, indicaciones, AEs.",
    author: "M-NEXUS",
    tags: ["farmacologia", "clinica", "espanol"],
    cardCount: 200,
    language: "es",
    rating: 4.7,
    installs: 5100,
    category: "pharmacology",
    updatedAt: "2026-08-20",
    official: true,
    sizeMB: 4,
  },
  {
    id: "patologia-robbins",
    name: "Patología — Robbins básico",
    description: "Resumen de Robbins. Patogenia, morfología, clínica.",
    author: "medstudent_share",
    tags: ["patologia", "robbins", "espanol"],
    cardCount: 1500,
    language: "es",
    rating: 4.4,
    installs: 1200,
    category: "pathology",
    updatedAt: "2026-07-10",
    official: false,
    sizeMB: 18,
  },
  {
    id: "kaiser-permanente-medical",
    name: "Kaiser Permanente — Boards",
    description: "Cards de repaso rápido para board review médico.",
    author: "kp_meded",
    tags: ["boards", "review", "english"],
    cardCount: 1200,
    language: "en",
    rating: 4.5,
    installs: 45000,
    category: "medical",
    updatedAt: "2026-08-01",
    official: false,
    sizeMB: 32,
  },
  {
    id: "histologia-basica",
    name: "Histología Básica",
    description: "Tejidos, órganos al microscopio. Imágenes + descripciones.",
    author: "M-NEXUS",
    tags: ["histologia", "espanol"],
    cardCount: 320,
    language: "es",
    rating: 4.3,
    installs: 850,
    category: "anatomy",
    updatedAt: "2026-06-15",
    official: true,
    sizeMB: 12,
  },
  {
    id: "gre-general",
    name: "GRE General Vocabulary",
    description: "3000 palabras más frecuentes del GRE.",
    author: "study_share",
    tags: ["gre", "ingles", "vocabulario"],
    cardCount: 3000,
    language: "en",
    rating: 4.2,
    installs: 28000,
    category: "language",
    updatedAt: "2026-05-20",
    official: false,
    sizeMB: 6,
  },
];

export class MarketplaceService {
  private decks: Map<string, Deck> = new Map();
  private installed: Set<string> = new Set();

  constructor() {
    for (const d of SEED_DECKS) {
      this.decks.set(d.id, d);
    }
  }

  /**
   * Lista todos los decks. Filtra por categoría o tags.
   */
  list(filters: { category?: Deck["category"]; language?: Deck["language"]; tag?: string } = {}): Deck[] {
    let result = Array.from(this.decks.values());
    if (filters.category) result = result.filter((d) => d.category === filters.category);
    if (filters.language) result = result.filter((d) => d.language === filters.language);
    if (filters.tag) {
      const tag = filters.tag.toLowerCase();
      result = result.filter((d) => d.tags.some((t) => t.toLowerCase().includes(tag)));
    }
    return result.sort((a, b) => b.installs - a.installs);
  }

  /**
   * Obtiene un deck por ID.
   */
  get(id: string): Deck | null {
    return this.decks.get(id) ?? null;
  }

  /**
   * Búsqueda por texto (nombre, descripción, tags).
   */
  search(query: string): Deck[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  /**
   * Top N más instalados.
   */
  top(n = 5): Deck[] {
    return this.list().slice(0, n);
  }

  /**
   * Top N por rating.
   */
  topRated(n = 5): Deck[] {
    return [...this.list()].sort((a, b) => b.rating - a.rating).slice(0, n);
  }

  /**
   * Marca un deck como instalado.
   */
  install(id: string): boolean {
    if (!this.decks.has(id)) return false;
    this.installed.add(id);
    return true;
  }

  /**
   * Desinstala un deck.
   */
  uninstall(id: string): boolean {
    return this.installed.delete(id);
  }

  /**
   * Lista los decks instalados.
   */
  installedDecks(): Deck[] {
    return Array.from(this.installed)
      .map((id) => this.decks.get(id)!)
      .filter(Boolean);
  }

  /**
   * Decks oficiales de M-NEXUS.
   */
  official(): Deck[] {
    return this.list().filter((d) => d.official);
  }

  /**
   * Stats del marketplace.
   */
  stats(): { totalDecks: number; totalCards: number; installedDecks: number; categories: number } {
    const categories = new Set(this.list().map((d) => d.category));
    return {
      totalDecks: this.decks.size,
      totalCards: this.list().reduce((s, d) => s + d.cardCount, 0),
      installedDecks: this.installed.size,
      categories: categories.size,
    };
  }
}

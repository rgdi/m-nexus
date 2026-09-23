/* ============================================================
 * services/multiBoard.ts — Multi-board Spaced Repetition (v2.32.0).
 *
 * Decks paralelos con diagnósticos cruzados:
 *   - Cada card pertenece a N boards (subjects: "anatomy", "cardio", ...)
 *   - Cada board tiene su propia FSRS-6 calibration (weights + patience)
 *   - Cross-deck diagnostic: detecta cards que aparecen en N boards
 *     (knowledge overlap) y cards con estado FSRS divergente entre boards
 *     (la misma card aprendida en cardio pero olvidada en cardio-advanced).
 *
 * Persistencia:
 *   - decks.json: lista de boards (id, name, color, calibration)
 *   - card-decks.json: map cardId → [{ deckId, addedAt }]
 *   - diagnostics/: snapshots de cross-deck diagnostics
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logOp } from "../utils/log.js";

const DATA_DIR = join(process.cwd(), "data");
const DECKS_FILE = join(DATA_DIR, "decks.json");
const CARD_DECKS_FILE = join(DATA_DIR, "card-decks.json");
const DIAGNOSTICS_DIR = join(DATA_DIR, "diagnostics");

export interface Deck {
  id: string;
  name: string;
  color: string;
  description?: string;
  /** Per-deck FSRS-7 calibration (mirrors CalibrationStore in fsrs7). */
  calibration?: {
    weights: number[];
    patience: number;
    sampleSize: number;
    calibratedAt: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface CardDeckLink {
  cardId: string;
  deckId: string;
  addedAt: number;
}

export interface CrossDeckDiagnostic {
  id: string;
  generatedAt: number;
  /** Cards that appear in multiple boards. */
  overlap: Array<{
    cardId: string;
    decks: string[];
    /** Per-deck current state (FSRS state field). */
    deckStates: Record<string, { stability: number; difficulty: number; state: string; lastReview: number; due: number }>;
  }>;
  /** Cards with divergent state across boards (need attention). */
  divergent: Array<{
    cardId: string;
    issue: "lapsed-in-one" | "much-newer-in-one" | "stability-mismatch";
    detail: string;
    deckIds: string[];
  }>;
  /** Per-deck summary. */
  deckSummary: Array<{
    deckId: string;
    deckName: string;
    totalCards: number;
    byState: Record<string, number>;
    avgStability: number;
    avgDifficulty: number;
  }>;
  /** Recommendations: cards to add to underweight boards. */
  recommendations: Array<{
    cardId: string;
    reason: string;
    suggestedDecks: string[];
  }>;
}

// ============ Persistence ============

async function loadDecks(): Promise<Deck[]> {
  try {
    const raw = await fs.readFile(DECKS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveDecks(decks: Deck[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DECKS_FILE, JSON.stringify(decks, null, 2), "utf-8");
}

async function loadCardDecks(): Promise<CardDeckLink[]> {
  try {
    const raw = await fs.readFile(CARD_DECKS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveCardDecks(links: CardDeckLink[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CARD_DECKS_FILE, JSON.stringify(links, null, 2), "utf-8");
}

// ============ CRUD ============

export const multiBoard = {
  async listDecks(): Promise<Deck[]> {
    return loadDecks();
  },

  async getDeck(id: string): Promise<Deck | null> {
    const decks = await loadDecks();
    return decks.find((d) => d.id === id) ?? null;
  },

  async createDeck(input: { name: string; color?: string; description?: string }): Promise<Deck> {
    const decks = await loadDecks();
    const now = Date.now();
    const deck: Deck = {
      id: `deck-${randomUUID()}`,
      name: input.name,
      color: input.color ?? "#667eea",
      description: input.description,
      createdAt: now,
      updatedAt: now,
    };
    decks.push(deck);
    await saveDecks(decks);
    logOp("decks", "create", true, { id: deck.id, name: deck.name });
    return deck;
  },

  async updateDeck(id: string, patch: Partial<Pick<Deck, "name" | "color" | "description" | "calibration">>): Promise<Deck | null> {
    const decks = await loadDecks();
    const idx = decks.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    decks[idx] = { ...decks[idx], ...patch, updatedAt: Date.now() };
    await saveDecks(decks);
    return decks[idx];
  },

  async deleteDeck(id: string): Promise<boolean> {
    const decks = await loadDecks();
    const next = decks.filter((d) => d.id !== id);
    if (next.length === decks.length) return false;
    await saveDecks(next);
    // Also remove card-deck links
    const links = await loadCardDecks();
    await saveCardDecks(links.filter((l) => l.deckId !== id));
    return true;
  },

  async assignCard(cardId: string, deckId: string): Promise<CardDeckLink> {
    const links = await loadCardDecks();
    const existing = links.find((l) => l.cardId === cardId && l.deckId === deckId);
    if (existing) return existing;
    const link: CardDeckLink = { cardId, deckId, addedAt: Date.now() };
    links.push(link);
    await saveCardDecks(links);
    return link;
  },

  async unassignCard(cardId: string, deckId: string): Promise<boolean> {
    const links = await loadCardDecks();
    const next = links.filter((l) => !(l.cardId === cardId && l.deckId === deckId));
    if (next.length === links.length) return false;
    await saveCardDecks(next);
    return true;
  },

  async getCardDecks(cardId: string): Promise<string[]> {
    const links = await loadCardDecks();
    return Array.from(new Set(links.filter((l) => l.cardId === cardId).map((l) => l.deckId)));
  },

  async getDeckCards(deckId: string): Promise<string[]> {
    const links = await loadCardDecks();
    return Array.from(new Set(links.filter((l) => l.deckId === deckId).map((l) => l.cardId)));
  },

  /**
   * Cross-deck diagnostic: analyzes cards that appear in multiple boards
   * and identifies inconsistencies.
   *
   * @param cardStates Optional map cardId → FSRS state (if not provided,
   *   uses cached state from the most recent diagnostic or returns empty)
   */
  async diagnostic(cardStates: Map<string, { stability: number; difficulty: number; state: string; lastReview: number; due: number }> = new Map()): Promise<CrossDeckDiagnostic> {
    const decks = await loadDecks();
    const links = await loadCardDecks();

    // Cards by id
    const byCard = new Map<string, string[]>();
    for (const l of links) {
      const arr = byCard.get(l.cardId) ?? [];
      arr.push(l.deckId);
      byCard.set(l.cardId, arr);
    }

    const overlap: CrossDeckDiagnostic["overlap"] = [];
    const divergent: CrossDeckDiagnostic["divergent"] = [];

    for (const [cardId, deckIds] of byCard) {
      if (deckIds.length < 2) continue;
      const deckStates: Record<string, any> = {};
      for (const did of deckIds) {
        const st = cardStates.get(`${cardId}::${did}`) ?? cardStates.get(cardId);
        if (st) deckStates[did] = st;
      }
      overlap.push({ cardId, decks: deckIds, deckStates });

      // Divergence detection
      const states = Object.values(deckStates);
      if (states.length >= 2) {
        const lapsedStates = states.filter((s: any) => s.state === "lapsed" || s.state === "relearning");
        const otherStates = states.filter((s: any) => s.state !== "lapsed" && s.state !== "relearning");
        if (lapsedStates.length > 0 && otherStates.length > 0) {
          divergent.push({
            cardId,
            issue: "lapsed-in-one",
            detail: `Card lapsed in ${lapsedStates.length} deck(s), OK in ${otherStates.length}. Needs review to sync.`,
            deckIds,
          });
        }
        // Stability mismatch (factor of 2x)
        const stabilities = states.map((s: any) => s.stability).filter((s) => s > 0);
        if (stabilities.length >= 2) {
          const min = Math.min(...stabilities);
          const max = Math.max(...stabilities);
          if (min > 0 && max / min >= 2) {
            divergent.push({
              cardId,
              issue: "stability-mismatch",
              detail: `Stability differs by 2x+ across decks (min=${min.toFixed(1)}, max=${max.toFixed(1)}).`,
              deckIds,
            });
          }
        }
      }
    }

    // Per-deck summary
    const deckSummary: CrossDeckDiagnostic["deckSummary"] = decks.map((deck) => {
      const deckCardIds = links.filter((l) => l.deckId === deck.id).map((l) => l.cardId);
      const states = deckCardIds.map((cid) => cardStates.get(cid)).filter(Boolean) as any[];
      const byState: Record<string, number> = {};
      let totalStability = 0, totalDifficulty = 0, count = 0;
      for (const s of states) {
        byState[s.state ?? "unknown"] = (byState[s.state ?? "unknown"] ?? 0) + 1;
        totalStability += s.stability ?? 0;
        totalDifficulty += s.difficulty ?? 0;
        count++;
      }
      return {
        deckId: deck.id,
        deckName: deck.name,
        totalCards: deckCardIds.length,
        byState,
        avgStability: count > 0 ? totalStability / count : 0,
        avgDifficulty: count > 0 ? totalDifficulty / count : 0,
      };
    });

    // Recommendations: cards present in only one deck that should be in multiple
    const recommendations: CrossDeckDiagnostic["recommendations"] = [];
    const cardToDecks = byCard;
    for (const deck of decks) {
      const deckCards = new Set(links.filter((l) => l.deckId === deck.id).map((l) => l.cardId));
      if (deckCards.size === 0) continue;
      // If a card is in cardio and mentions anatomy entities, suggest adding it to anatomy deck.
      // (Simple heuristic: if a card appears in 3+ decks, recommend consolidation.)
      for (const [cardId, deckIds] of cardToDecks) {
        if (deckIds.length >= 3) {
          const missing = decks.filter((d) => !deckIds.includes(d.id) && deckCards.has(cardId)).slice(0, 2);
          if (missing.length > 0) {
            recommendations.push({
              cardId,
              reason: `Card in ${deckIds.length} decks; consider adding to related: ${missing.map((m) => m.name).join(", ")}`,
              suggestedDecks: missing.map((m) => m.id),
            });
          }
        }
      }
    }

    const diagnostic: CrossDeckDiagnostic = {
      id: `diag-${Date.now()}-${randomUUID().slice(0, 8)}`,
      generatedAt: Date.now(),
      overlap,
      divergent,
      deckSummary,
      recommendations: recommendations.slice(0, 20),
    };

    // Persist
    await fs.mkdir(DIAGNOSTICS_DIR, { recursive: true });
    await fs.writeFile(
      join(DIAGNOSTICS_DIR, `${diagnostic.id}.json`),
      JSON.stringify(diagnostic, null, 2),
      "utf-8",
    );
    logOp("decks", "diagnostic", true, {
      overlap: overlap.length,
      divergent: divergent.length,
      recommendations: recommendations.length,
    });
    return diagnostic;
  },

  async listDiagnostics(limit = 10): Promise<CrossDeckDiagnostic[]> {
    try {
      const files = await fs.readdir(DIAGNOSTICS_DIR);
      const sorted = files.sort().reverse().slice(0, limit);
      const out: CrossDeckDiagnostic[] = [];
      for (const f of sorted) {
        try {
          const raw = await fs.readFile(join(DIAGNOSTICS_DIR, f), "utf-8");
          out.push(JSON.parse(raw));
        } catch {}
      }
      return out;
    } catch {
      return [];
    }
  },

  _reset: async () => {
    await fs.unlink(DECKS_FILE).catch(() => {});
    await fs.unlink(CARD_DECKS_FILE).catch(() => {});
  },
};

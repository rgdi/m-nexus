/* ============================================================
 * services/multiBoard.ts — Multi-board spaced repetition.
 *
 * v2.32.0 — Un "board" es un deck paralelo con su propio subject y
 *   schedule. Cada board tiene:
 *     - name, subject, color, icon
 *     - own pool de flashcards con fsrs state independiente
 *     - cross-board diagnostics: detecta cards duplicadas o
 *       complementarias entre boards (mismo front, mismo concepto)
 *     - recomendaciones cruzadas: "estudia X en board B antes de
 *       que se te olvide lo que aprendiste en board A"
 *
 * Persistencia: backend/data/boards.json
 *   { boards: [{ id, name, subject, color, icon, createdAt }],
 *     cardLinks: [{ boardAId, cardAId, boardBId, cardBId, type: 'duplicate'|'complement', similarity }] }
 *
 * Cross-board detection: usa el signature (front::back) para dup,
 * y un Jaccard básico de tokens para complement.
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { logOp } from "../utils/log.js";

const DATA_DIR = join(process.cwd(), "data");
const FILE = join(DATA_DIR, "boards.json");
const FLASHCARDS_FILE = join(DATA_DIR, "flashcards.json");

export interface Board {
  id: string;
  name: string;
  subject: string;
  color: string;
  icon: string;
  createdAt: number;
}

export interface CardLink {
  id: string;
  boardAId: string;
  cardAId: string;
  boardBId: string;
  cardBId: string;
  type: "duplicate" | "complement";
  /** 0..1 similarity score. */
  similarity: number;
}

interface Store {
  boards: Board[];
  cardLinks: CardLink[];
}

async function load(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {
    return { boards: [], cardLinks: [] };
  }
}

async function persist(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf-8");
}

interface FlashcardLiteShape {
  id: string;
  front: string;
  back: string;
  subject?: string;
  boardId?: string;
  tags?: string[];
}

export type FlashcardLite = FlashcardLiteShape;

async function readFlashcards(): Promise<FlashcardLiteShape[]> {
  try {
    const raw = await fs.readFile(FLASHCARDS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as FlashcardLiteShape[];
    if (Array.isArray(parsed.cards)) return parsed.cards as FlashcardLiteShape[];
    return [];
  } catch {
    return [];
  }
}

export const multiBoard = {
  // ============ Boards CRUD ============
  async listBoards(): Promise<Board[]> {
    const s = await load();
    return s.boards.sort((a, b) => a.createdAt - b.createdAt);
  },

  async createBoard(input: { name: string; subject: string; color?: string; icon?: string }): Promise<Board> {
    const s = await load();
    const board: Board = {
      id: `board-${randomUUID().slice(0, 8)}`,
      name: input.name.trim(),
      subject: input.subject.trim(),
      color: input.color ?? "#667eea",
      icon: input.icon ?? "📚",
      createdAt: Date.now(),
    };
    s.boards.push(board);
    await persist(s);
    logOp("board", "create", true, { id: board.id, name: board.name });
    return board;
  },

  async updateBoard(id: string, patch: Partial<Board>): Promise<Board | null> {
    const s = await load();
    const b = s.boards.find((x) => x.id === id);
    if (!b) return null;
    Object.assign(b, patch, { id: b.id, createdAt: b.createdAt });
    await persist(s);
    return b;
  },

  async deleteBoard(id: string): Promise<boolean> {
    const s = await load();
    const i = s.boards.findIndex((x) => x.id === id);
    if (i === -1) return false;
    s.boards.splice(i, 1);
    // Also drop links involving this board
    s.cardLinks = s.cardLinks.filter((l) => l.boardAId !== id && l.boardBId !== id);
    await persist(s);
    return true;
  },

  // ============ Cross-board diagnostics ============
  async diagnose(input?: {
    /** Optional override of cards (for tests / in-memory demo). */
    cards?: FlashcardLite[];
  }): Promise<{
    boards: Board[];
    links: CardLink[];
    stats: {
      totalCards: number;
      duplicatePairs: number;
      complementPairs: number;
      byBoard: Record<string, number>;
    };
  }> {
    const store = await load();
    const cards = input?.cards ?? await readFlashcards();
    // Group by boardId, tags[board-*], or subject (fallback when no boards).
    const byBoard = new Map<string, FlashcardLiteShape[]>();
    for (const c of cards) {
      let key: string | undefined = c.boardId;
      if (!key && Array.isArray((c as any).tags)) {
        const t = (c as any).tags.find((x: any) => typeof x === "string" && x.startsWith("board-"));
        if (t) key = t;
      }
      if (!key && c.subject) {
        // Use subject as a board-group proxy
        key = `subject:${c.subject}`;
      }
      const effective = key ?? "_unassigned";
      const arr = byBoard.get(effective) ?? [];
      arr.push(c);
      byBoard.set(effective, arr);
    }
    function tokenize(s: string): Set<string> {
      return new Set(
        s.toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3),
      );
    }
    function jaccard(a: Set<string>, b: Set<string>): number {
      const inter = new Set([...a].filter((x) => b.has(x)));
      const union = new Set([...a, ...b]);
      return union.size === 0 ? 0 : inter.size / union.size;
    }

    const links: CardLink[] = [];
    const seen = new Set<string>();
    const boardIds = Array.from(byBoard.keys());
    for (let i = 0; i < boardIds.length; i++) {
      for (let j = i + 1; j < boardIds.length; j++) {
        const a = byBoard.get(boardIds[i])!;
        const b = byBoard.get(boardIds[j])!;
        for (const ca of a) {
          for (const cb of b) {
            if (`${ca.front}\u0000${ca.back}` === `${cb.front}\u0000${cb.back}`) {
              const k = `${ca.id}|${cb.id}`;
              if (!seen.has(k)) {
                seen.add(k);
                links.push({
                  id: createHash("sha1").update(k).digest("hex").slice(0, 12),
                  boardAId: boardIds[i],
                  cardAId: ca.id,
                  boardBId: boardIds[j],
                  cardBId: cb.id,
                  type: "duplicate",
                  similarity: 1,
                });
              }
            } else {
              const sim = jaccard(tokenize(ca.front + " " + ca.back), tokenize(cb.front + " " + cb.back));
              if (sim >= 0.4) {
                const k = `${ca.id}|${cb.id}`;
                if (!seen.has(k)) {
                  seen.add(k);
                  links.push({
                    id: createHash("sha1").update(k).digest("hex").slice(0, 12),
                    boardAId: boardIds[i],
                    cardAId: ca.id,
                    boardBId: boardIds[j],
                    cardBId: cb.id,
                    type: "complement",
                    similarity: sim,
                  });
                }
              }
            }
          }
        }
      }
    }
    store.cardLinks = links;
    await persist(store);

    const stats = {
      totalCards: cards.length,
      duplicatePairs: links.filter((l) => l.type === "duplicate").length,
      complementPairs: links.filter((l) => l.type === "complement").length,
      byBoard: Object.fromEntries(
        Array.from(byBoard.entries()).map(([k, v]) => [k, v.length]),
      ) as Record<string, number>,
    };
    return { boards: store.boards, links, stats };
  },

  async recommendCrossBoard(): Promise<Array<{
    fromBoard: Board;
    toBoard: Board;
    fromCardId: string;
    toCardId: string;
    reason: string;
  }>> {
    const { boards, links } = await this.diagnose();
    const recs: Array<any> = [];
    for (const link of links) {
      if (link.type === "complement") {
        const fromBoard = boards.find((b) => b.id === link.boardAId);
        const toBoard = boards.find((b) => b.id === link.boardBId);
        if (fromBoard && toBoard) {
          recs.push({
            fromBoard,
            toBoard,
            fromCardId: link.cardAId,
            toCardId: link.cardBId,
            reason: `Las cards "${link.cardAId.slice(0, 8)}…" y "${link.cardBId.slice(0, 8)}…" comparten ${(link.similarity * 100).toFixed(0)}% de contenido — estudiar juntas mejora la transferencia.`,
          });
        }
      }
    }
    return recs.slice(0, 10);
  },

  _reset: async () => {
    try { await fs.unlink(FILE); } catch {}
  },
};

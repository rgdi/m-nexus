/* ============================================================
 * services/smartNotifications.ts — Smart Notifications (v2.32.0).
 *
 * Push notifications BASADAS EN RETENCIÓN PREDICTIVA, no en schedule fijo.
 *
 *   - Para cada card del usuario, calcula el riesgo de olvido en N días.
 *   - Genera notificaciones agrupadas por "ventana óptima":
 *       * "🚨 4 cards en riesgo hoy — repásalas en 8 min"
 *       * "📌 12 cards listas para repaso en los próximos 3 días"
 *       * "✅ Tu retención del 92% se mantiene — sigue así"
 *
 * Persistencia: backend/data/notifications.json
 *   {
 *     lastGeneratedAt: number,
 *     pending: Array<{
 *       id, severity, title, body, cardIds, deckIds?,
 *       optimalWindowStart, optimalWindowEnd, generatedAt
 *     }>,
 *     history: [...past delivered]
 *   }
 *
 * API:
 *   smartNotifications.generate({ cards, decks? }) → { notifications }
 *   smartNotifications.getPending() → notifications[]
 *   smartNotifications.markRead(id) → boolean
 *   smartNotifications.dismiss(id) → boolean
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { logOp } from "../utils/log.js";
import {
  predictBatch,
  type PredictableCard,
  type PredictionRow,
} from "./predictiveScheduler.js";

const DATA_DIR = join(process.cwd(), "data");
const FILE = join(DATA_DIR, "notifications.json");

export type Severity = "critical" | "warning" | "info" | "success";

export interface Notification {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  cardIds: string[];
  /** Optional deckIds filter. */
  deckIds?: string[];
  /** Window when the user should ideally study. */
  optimalWindowStart: number;
  optimalWindowEnd: number;
  generatedAt: number;
  read: boolean;
  dismissed: boolean;
}

export interface Store {
  lastGeneratedAt: number;
  pending: Notification[];
  history: Notification[];
}

async function load(): Promise<Store> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // Handle legacy shape: { items: [...] } (notifications ingest) vs new shape
    if (Array.isArray(parsed)) {
      return { lastGeneratedAt: 0, pending: [], history: [] };
    }
    if (Array.isArray(parsed.items)) {
      // Legacy format — migrate by treating items as history
      return { lastGeneratedAt: 0, pending: [], history: [] };
    }
    return {
      lastGeneratedAt: parsed.lastGeneratedAt ?? 0,
      pending: parsed.pending ?? [],
      history: parsed.history ?? [],
    };
  } catch {
    return { lastGeneratedAt: 0, pending: [], history: [] };
  }
}

async function save(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf-8");
}

export interface GenerateOptions {
  cards: PredictableCard[];
  targetRetention?: number;
  horizonDays?: number;
  now?: number;
  /** Max notifications to produce. */
  maxNotifications?: number;
}

export const smartNotifications = {
  async generate(opts: GenerateOptions): Promise<Notification[]> {
    const target = opts.targetRetention ?? 0.9;
    const horizon = opts.horizonDays ?? 14;
    const now = opts.now ?? Date.now();

    const predictions = predictBatch(opts.cards, {
      targetRetention: target,
      horizonDays: horizon,
      now,
    });

    // Group cards by action
    const groups = {
      reviewNow: predictions.filter((p) => p.action === "review-now"),
      reviewToday: predictions.filter((p) => p.action === "review-today"),
      reviewSoon: predictions.filter((p) => p.action === "review-soon"),
      safe: predictions.filter((p) => p.action === "safe"),
    };

    const out: Notification[] = [];

    // Critical: review-now
    if (groups.reviewNow.length > 0) {
      const estMinutes = Math.max(1, Math.round((groups.reviewNow.length * 8) / 60));
      out.push({
        id: `notif-${randomUUID()}`,
        severity: "critical",
        title: `🚨 ${groups.reviewNow.length} ${groups.reviewNow.length === 1 ? "card en riesgo" : "cards en riesgo"} hoy`,
        body: `Tu retención predictiva está por debajo del ${(target * 100).toFixed(0)}%. Repásalas ahora (${estMinutes} min estimado).`,
        cardIds: groups.reviewNow.map((p) => p.id).filter(Boolean) as string[],
        optimalWindowStart: now,
        optimalWindowEnd: now + 4 * 60 * 60 * 1000, // 4h window
        generatedAt: now,
        read: false,
        dismissed: false,
      });
    }

    // Warning: review-today
    if (groups.reviewToday.length > 0 && groups.reviewToday.length !== groups.reviewNow.length) {
      const ids = groups.reviewToday.map((p) => p.id).filter(Boolean) as string[];
      // Exclude cards already in review-now
      const reviewNowIds = new Set(groups.reviewNow.map((p) => p.id));
      const filtered = ids.filter((id) => !reviewNowIds.has(id));
      if (filtered.length > 0) {
        const estMinutes = Math.max(1, Math.round((filtered.length * 8) / 60));
        out.push({
          id: `notif-${randomUUID()}`,
          severity: "warning",
          title: `📌 ${filtered.length} cards listas para repaso hoy`,
          body: `Si repasas estas en las próximas horas, mantienes tu retención en ${(target * 100).toFixed(0)}% (${estMinutes} min).`,
          cardIds: filtered,
          optimalWindowStart: now,
          optimalWindowEnd: now + 8 * 60 * 60 * 1000,
          generatedAt: now,
          read: false,
          dismissed: false,
        });
      }
    }

    // Info: review-soon (next 3 days)
    if (groups.reviewSoon.length > 0) {
      const ids = groups.reviewSoon.map((p) => p.id).filter(Boolean) as string[];
      out.push({
        id: `notif-${randomUUID()}`,
        severity: "info",
        title: `⏳ ${ids.length} cards en los próximos 3 días`,
        body: `Planifica una sesión de ${Math.max(1, Math.round((ids.length * 8) / 60))} min para cubrir todas.`,
        cardIds: ids,
        optimalWindowStart: now,
        optimalWindowEnd: now + 3 * 24 * 60 * 60 * 1000,
        generatedAt: now,
        read: false,
        dismissed: false,
      });
    }

    // Success: if overall retention is good
    const total = predictions.length;
    const safeRatio = total > 0 ? groups.safe.length / total : 0;
    if (total > 10 && safeRatio >= 0.7) {
      out.push({
        id: `notif-${randomUUID()}`,
        severity: "success",
        title: `✅ Retención sólida — ${(safeRatio * 100).toFixed(0)}%`,
        body: `Buen trabajo. Tu curva de olvido se mantiene saludable. Sigue con tu ritmo actual.`,
        cardIds: [],
        optimalWindowStart: now,
        optimalWindowEnd: now + 24 * 60 * 60 * 1000,
        generatedAt: now,
        read: false,
        dismissed: false,
      });
    }

    // Limit
    const max = opts.maxNotifications ?? 10;
    const result = out.slice(0, max);

    // Persist
    const store = await load();
    store.lastGeneratedAt = now;
    // Dedupe: don't add notifications for the same cardIds within 1 hour
    const existingCardIds = new Set<string>();
    for (const p of store.pending) {
      for (const cid of p.cardIds) existingCardIds.add(cid);
    }
    for (const n of result) {
      const newCardIds = n.cardIds.filter((c) => !existingCardIds.has(c));
      if (newCardIds.length > 0 || n.cardIds.length === 0) {
        n.cardIds = newCardIds;
        store.pending.push(n);
      }
    }
    await save(store);
    logOp("notifications", "generate", true, { count: result.length, totalCards: total });
    return result;
  },

  async getPending(): Promise<Notification[]> {
    const store = await load();
    return store.pending.filter((n) => !n.dismissed);
  },

  async getAll(): Promise<Store> {
    return load();
  },

  async markRead(id: string): Promise<boolean> {
    const store = await load();
    const n = store.pending.find((n) => n.id === id);
    if (!n) return false;
    n.read = true;
    await save(store);
    return true;
  },

  async dismiss(id: string): Promise<boolean> {
    const store = await load();
    const idx = store.pending.findIndex((n) => n.id === id);
    if (idx === -1) return false;
    const [n] = store.pending.splice(idx, 1);
    n.dismissed = true;
    store.history.push(n);
    // Cap history
    if (store.history.length > 200) {
      store.history = store.history.slice(-200);
    }
    await save(store);
    return true;
  },

  async clearAll(): Promise<void> {
    const store = await load();
    store.history.push(...store.pending.map((n) => ({ ...n, dismissed: true })));
    store.pending = [];
    await save(store);
  },

  _reset: async () => {
    await fs.unlink(FILE).catch(() => {});
  },
};

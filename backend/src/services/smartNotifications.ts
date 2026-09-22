/* ============================================================
 * services/smartNotifications.ts — Predictivo + push scheduler.
 *
 * v2.32.0 — Genera notificaciones inteligentes basadas en
 *   retención predictiva (FSRS-7):
 *
 *   1. "card X se te va a olvidar en N días" — predice R(t) < 0.5
 *      y avisa con anticipación.
 *   2. "Tienes N cards en riesgo hoy" — resumen diario.
 *   3. "Streak en peligro" — si llevas 2+ días sin repasar.
 *   4. "Card dominada" — cuando R sube por encima de 0.95 después
 *      de varias repasos exitosos.
 *
 * API:
 *   - generateForUser(userId, cards) → Notification[]
 *   - markSeen(notifId) → ack
 *   - list(userId, since?) → Notification[]
 *
 * Persistencia: backend/data/notifications.json
 *   { items: [{ id, userId, type, severity, title, body, link, createdAt, seenAt? }] }
 *
 * Integración con el scheduler v2.30 (predictCard) — usamos
 * directamente la misma lógica.
 * ============================================================ */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { predictCard, optimalWindow, type PredictableCard } from "./predictiveScheduler.js";

const DATA_DIR = join(process.cwd(), "data");
const FILE = join(DATA_DIR, "notifications.json");

export type NotificationSeverity = "info" | "warning" | "danger" | "success";
export type NotificationType =
  | "card-at-risk"
  | "daily-briefing"
  | "streak-danger"
  | "card-mastered"
  | "session-recommendation";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body: string;
  /** Hash for de-dup: 1 notif por (type, refId, day). */
  refHash: string;
  /** Optional anchor for client routing (e.g. /#/study?card=abc). */
  link?: string;
  createdAt: number;
  seenAt?: number;
}

interface Store {
  items: Notification[];
}

async function load(): Promise<Store> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw);
    // Defensive: old format was just an array
    if (Array.isArray(parsed)) return { items: parsed as Notification[] };
    if (parsed && Array.isArray(parsed.items)) return parsed as Store;
    return { items: [] };
  } catch {
    return { items: [] };
  }
}

async function persist(store: Store): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf-8");
}

function dayHash(prefix: string, key: string, ts: number): string {
  const day = new Date(ts).toISOString().slice(0, 10);
  return `${prefix}:${key}:${day}`;
}

export interface GenerateOptions {
  /** Force a specific "now" (for tests). */
  now?: number;
  /** Cards grouped by subject; used for streak tracking. */
  lastStudyBySubject?: Record<string, number>;
  /** Days threshold for at-risk early warning (default 7). */
  earlyWarnDays?: number;
  /** R threshold for "mastered" notification (default 0.95). */
  masteredThreshold?: number;
}

/** Main entry: produces up to N notifications for a user. */
export async function generateForUser(
  userId: string,
  cards: PredictableCard[],
  opts: GenerateOptions = {},
): Promise<Notification[]> {
  const now = opts.now ?? Date.now();
  const generated: Notification[] = [];

  // 1. Card-at-risk for each high-urgency card (top 5)
  const win = optimalWindow(cards, {
    now,
    limit: 5,
    targetRetention: 0.9,
    horizonDays: 14,
  });
  for (const item of win.recommended) {
    generated.push({
      id: `notif-${randomUUID()}`,
      userId,
      type: "card-at-risk",
      severity: item.action === "review-now" ? "danger" : "warning",
      title: item.action === "review-now" ? "🚨 Repasa ahora" : "📌 En riesgo hoy",
      body: `Card ${item.id.slice(0, 10)}… · R ahora ${(item.rNow * 100).toFixed(0)}% · ventana óptima en ${item.optimalReviewDay.toFixed(1)} días`,
      refHash: dayHash("at-risk", item.id, now),
      link: `#/study?focus=${item.id}`,
      createdAt: now,
    });
  }

  // 2. Daily briefing: aggregate count
  if (win.totalAtRiskToday > 0) {
    generated.push({
      id: `notif-${randomUUID()}`,
      userId,
      type: "daily-briefing",
      severity: win.totalAtRiskToday > 5 ? "warning" : "info",
      title: "🗓 Tu briefing diario",
      body: `${win.totalAtRiskToday} cards en riesgo · tiempo estimado ${win.estimatedMinutes} min · repasa antes de que se te olviden`,
      refHash: dayHash("briefing", "today", now),
      link: "#/study",
      createdAt: now,
    });
  }

  // 3. Streak danger: any subject with lastStudy > 2 days ago
  if (opts.lastStudyBySubject) {
    const DAY = 86_400_000;
    for (const [subject, lastTs] of Object.entries(opts.lastStudyBySubject)) {
      const daysSince = Math.floor((now - lastTs) / DAY);
      if (daysSince >= 2) {
        generated.push({
          id: `notif-${randomUUID()}`,
          userId,
          type: "streak-danger",
          severity: daysSince >= 4 ? "danger" : "warning",
          title: "🔥 Streak en peligro",
          body: `Llezas ${daysSince} días sin repasar "${subject}". Repasa al menos una card para mantener el ritmo.`,
          refHash: dayHash("streak", subject, now),
          link: `#/subjects/${encodeURIComponent(subject)}`,
          createdAt: now,
        });
      }
    }
  }

  // 4. Card mastered (R > 0.95 + reps >= 5)
  const masteredThreshold = opts.masteredThreshold ?? 0.95;
  const mastered: string[] = [];
  for (const c of cards) {
    if ((c.card as any).reps >= 5) {
      const row = predictCard(c.card, { now });
      if (row.rNow >= masteredThreshold && c.card.state === "review") {
        mastered.push(c.id);
      }
    }
  }
  for (const id of mastered.slice(0, 3)) {
    generated.push({
      id: `notif-${randomUUID()}`,
      userId,
      type: "card-mastered",
      severity: "success",
      title: "🎉 Card dominada",
      body: `Card ${id.slice(0, 10)}… consolidada · R ≥ ${(masteredThreshold * 100).toFixed(0)}%`,
      refHash: dayHash("mastered", id, now),
      link: `#/study?focus=${id}`,
      createdAt: now,
    });
  }

  // 5. Session recommendation: when study load is heavy
  if (win.totalAtRiskToday >= 10) {
    generated.push({
      id: `notif-${randomUUID()}`,
      userId,
      type: "session-recommendation",
      severity: "info",
      title: "🧠 Sesión larga recomendada",
      body: `${win.totalAtRiskToday} cards atrasadas. Considera una sesión de 15 min dividida en 3 tandas de 5 min (efecto spacing).`,
      refHash: dayHash("session", "rec", now),
      link: "#/study",
      createdAt: now,
    });
  }

  // Dedup against existing notifs by refHash + insert
  const store = await load();
  const existingHashes = new Set(store.items.map((n) => n.refHash));
  const fresh = generated.filter((n) => !existingHashes.has(n.refHash));
  if (fresh.length > 0) {
    store.items.push(...fresh);
    await persist(store);
  }
  return fresh;
}

export async function list(userId: string, since?: number): Promise<Notification[]> {
  const store = await load();
  return store.items
    .filter((n) => n.userId === userId && (since == null || n.createdAt > since))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function markSeen(notifId: string): Promise<boolean> {
  const store = await load();
  const n = store.items.find((x) => x.id === notifId);
  if (!n) return false;
  n.seenAt = Date.now();
  await persist(store);
  return true;
}

export async function unseenCount(userId: string): Promise<number> {
  const store = await load();
  return store.items.filter((n) => n.userId === userId && !n.seenAt).length;
}

export const smartNotifications = {
  generateForUser,
  list,
  markSeen,
  unseenCount,
  _reset: async () => {
    try { await fs.unlink(FILE); } catch {}
  },
};

// notifications.ts — v2.21.0
//
// Persists notification metadata captured by the Android
// NotificationListenerService + POSTed from the JS layer.
//
// Storage: data/notifications.json (one JSON array).
// Dedupe: each entry has a `key` (Android's StatusBarNotification key)
// which is globally unique per (packageName, id, tag, userId, postedAt).
// Re-posting the same key from a different device is a no-op.
//
// Why we don't store the actual text content for some apps: notifications
// from messaging apps (WhatsApp, Telegram, etc.) can contain personal
// content. The user opted in at the Android Settings level, so the
// decision to capture is theirs. We persist what the OS gives us —
// the OS itself gates which apps send us content. Some apps (Signal,
// WhatsApp on certain configs) set EXTRA_TEXT to a redacted summary;
// we store that as-is. Privacy review in v2.22 will add per-app filters.

import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface CapturedNotification {
  id: string; // server-side UUID
  key: string; // android StatusBarNotification key
  deviceId: string;
  userId?: string;
  packageName: string;
  postedAt: number;
  receivedAt: number;
  tag: string | null;
  nid: number;
  isOngoing: boolean;
  category: string | null;
  priority: number;
  channelId: string | null;
  title: string | null;
  text: string | null;
  subText: string | null;
  tickerText: string | null;
  when: number;
  /** v2.21.0: "system_notification" — distinguishes from user-created events. */
  source: string;
}

function dataFile(): string {
  return process.env.MNEXUS_NOTIFICATIONS_FILE
    ? process.env.MNEXUS_NOTIFICATIONS_FILE
    : join(process.cwd(), "data", "notifications.json");
}

let _cache: CapturedNotification[] | null = null;
let _flushTimer: NodeJS.Timeout | null = null;

async function load(): Promise<CapturedNotification[]> {
  if (_cache) return _cache;
  try {
    const buf = await fs.readFile(dataFile(), "utf-8");
    _cache = JSON.parse(buf);
    return _cache!;
  } catch {
    _cache = [];
    return _cache;
  }
}

async function flush(): Promise<void> {
  if (!_cache) return;
  // Debounce writes so a batch ingest doesn't trigger 100 fsyncs.
  if (_flushTimer) return;
  const file = dataFile();
  _flushTimer = setTimeout(async () => {
    _flushTimer = null;
    if (!_cache) return;
    try {
      await fs.writeFile(file, JSON.stringify(_cache, null, 2), "utf-8");
    } catch (e) {
      console.error("[notifications] flush failed:", e);
    }
  }, 250);
}

/**
 * Ingest a batch of notifications from a device. Returns counts of
 * inserted / deduplicated / invalid entries.
 *
 * Invalid entries are dropped silently (logged once). A notification is
 * invalid if: missing key, missing postedAt, missing packageName.
 */
export async function ingestNotifications(
  deviceId: string,
  raw: unknown[],
): Promise<{ inserted: number; deduplicated: number; invalid: number; total: number }> {
  const list = await load();
  const seen = new Set(list.map((n) => n.key));
  let inserted = 0;
  let deduplicated = 0;
  let invalid = 0;
  const now = Date.now();

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      invalid++;
      continue;
    }
    const o = item as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key : null;
    const packageName = typeof o.packageName === "string" ? o.packageName : null;
    const postedAt = typeof o.postedAt === "number" ? o.postedAt : null;
    if (!key || !packageName || postedAt === null) {
      invalid++;
      continue;
    }
    if (seen.has(key)) {
      deduplicated++;
      continue;
    }
    seen.add(key);
    const n: CapturedNotification = {
      id: crypto.randomUUID(),
      key,
      deviceId,
      packageName,
      postedAt,
      receivedAt: now,
      tag: (typeof o.tag === "string" ? o.tag : null),
      nid: (typeof o.id === "number" ? o.id : 0),
      isOngoing: !!o.isOngoing,
      category: (typeof o.category === "string" ? o.category : null),
      priority: (typeof o.priority === "number" ? o.priority : -1),
      channelId: (typeof o.channelId === "string" ? o.channelId : null),
      title: (typeof o.title === "string" ? o.title : null),
      text: (typeof o.text === "string" ? o.text : null),
      subText: (typeof o.subText === "string" ? o.subText : null),
      tickerText: (typeof o.tickerText === "string" ? o.tickerText : null),
      when: (typeof o.when === "number" ? o.when : 0),
      source: "system_notification",
    };
    list.push(n);
    inserted++;
  }

  if (inserted > 0) await flush();

  return { inserted, deduplicated, invalid, total: raw.length };
}

/**
 * List notifications for a given device (or all devices, for the admin
 * dashboard). Newest first. `limit` is capped server-side.
 */
export async function listNotifications(opts: {
  deviceId?: string;
  limit?: number;
  packageName?: string;
}): Promise<CapturedNotification[]> {
  const list = await load();
  let filtered = list;
  if (opts.deviceId) filtered = filtered.filter((n) => n.deviceId === opts.deviceId);
  if (opts.packageName) filtered = filtered.filter((n) => n.packageName === opts.packageName);
  filtered.sort((a, b) => b.postedAt - a.postedAt);
  const limit = Math.min(opts.limit ?? 100, 1000);
  return filtered.slice(0, limit);
}

/** Delete notifications by key (rare — admin operation). */
export async function deleteNotification(id: string): Promise<boolean> {
  const list = await load();
  const before = list.length;
  _cache = list.filter((n) => n.id !== id);
  if ((_cache?.length || 0) !== before) {
    await flush();
    return true;
  }
  return false;
}

/** Test-only: clear the cache so the next call reloads from disk. */
export function _resetForTests(): void {
  _cache = null;
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
}

/** Test-only: wait for any pending flushes to complete. */
export async function _flushForTests(): Promise<void> {
  if (_flushTimer) {
    const timer = _flushTimer;
    _flushTimer = null;
    if (_cache) {
      try {
        await fs.writeFile(dataFile(), JSON.stringify(_cache, null, 2), "utf-8");
      } catch {}
    }
    clearTimeout(timer);
  }
}

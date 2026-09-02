// ActivityLog: registro persistente de actividad del usuario.
// Almacena en _M-NEXUS/activity.json con rotación por edad/espacio.

import { App, normalizePath } from "obsidian";
import { Logger } from "../utils/logger";
import { ActivityEvent, ActivityKind } from "../analytics/heatmap";

const FOLDER = "_M-NEXUS";
const FILE = "activity.json";
const MAX_EVENTS = 10_000;
const MAX_AGE_DAYS = 365;

class ActivityLogInstance {
  private events: ActivityEvent[] = [];
  private loaded = false;

  constructor(private app: App, private log: Logger) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const path = normalizePath(`${FOLDER}/${FILE}`);
    if (await this.app.vault.adapter.exists(path)) {
      try {
        const raw = await this.app.vault.adapter.read(path);
        this.events = JSON.parse(raw) ?? [];
      } catch (e) {
        this.log.warn(`Activity log corrupto: ${(e as Error).message}`);
        this.events = [];
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    const path = normalizePath(`${FOLDER}/${FILE}`);
    if (!(await this.app.vault.adapter.exists(FOLDER))) {
      try { await this.app.vault.createFolder(FOLDER); } catch { /* idempotente */ }
    }
    await this.app.vault.adapter.write(path, JSON.stringify(this.events, null, 2));
  }

  async record(kind: ActivityKind, weight = 1, date: string = new Date().toISOString()): Promise<void> {
    await this.load();
    this.events.push({ date, kind, weight });
    // Poda por edad y tamaño
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000;
    this.events = this.events.filter((e) => new Date(e.date).getTime() > cutoff);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
    await this.save();
  }

  async all(): Promise<ActivityEvent[]> {
    await this.load();
    return [...this.events];
  }

  async clear(): Promise<void> {
    this.events = [];
    await this.save();
  }
}

let _instance: ActivityLogInstance | null = null;

export async function activityLog(app: App, log: Logger): Promise<ActivityLogInstance> {
  if (!_instance) {
    _instance = new ActivityLogInstance(app, log);
    await _instance.load();
  }
  return _instance;
}

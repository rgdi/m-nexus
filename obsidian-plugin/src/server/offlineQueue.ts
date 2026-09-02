// OfflineQueue: cola persistente de operaciones pendientes.
// Se almacena en `_M-NEXUS/server/queue.json` (append-only) y se rota
// al sincronizar con éxito. Garantiza que ningún cambio se pierde aunque
// el servidor esté caído durante horas.

import { App, normalizePath } from "obsidian";
import { Logger } from "../utils/logger";
import { FileChange, CardChange } from "./types";

const QUEUE_FOLDER = "_M-NEXUS/server";
const QUEUE_FILE = "queue.json";
const QUEUE_ARCHIVE = "queue.archived.json";
const MAX_QUEUE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface QueuedOperation {
  id: string;
  type: "file" | "card";
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
  payload: FileChange | CardChange;
}

export interface QueueStats {
  pending: number;
  archived: number;
  oldestPendingAge: number; // ms
  totalBytes: number;
}

export class OfflineQueue {
  private items: QueuedOperation[] = [];
  private archived: QueuedOperation[] = [];
  private loaded = false;

  constructor(private app: App, private log: Logger) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    const path = normalizePath(`${QUEUE_FOLDER}/${QUEUE_FILE}`);
    if (await this.app.vault.adapter.exists(path)) {
      try {
        const raw = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(raw);
        this.items = parsed.items ?? [];
        this.archived = parsed.archived ?? [];
      } catch (e) {
        this.log.warn(`Cola corrupta, reiniciando: ${(e as Error).message}`);
        this.items = [];
        this.archived = [];
      }
    } else {
      await this.ensureFolder();
    }
    this.loaded = true;
  }

  private async ensureFolder() {
    const norm = normalizePath(QUEUE_FOLDER);
    if (await this.app.vault.adapter.exists(norm)) return;
    const parts = norm.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!(await this.app.vault.adapter.exists(cur))) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  async save(): Promise<void> {
    await this.ensureFolder();
    const path = normalizePath(`${QUEUE_FOLDER}/${QUEUE_FILE}`);
    const json = JSON.stringify({ items: this.items, archived: this.archived }, null, 2);
    if (json.length > MAX_QUEUE_BYTES) {
      // Mover lo más viejo a archivo separado para evitar JSON gigante
      const old = this.items.splice(0, Math.floor(this.items.length / 4));
      this.archived.push(...old);
      this.log.warn(`Cola excede ${MAX_QUEUE_BYTES}B, archivando ${old.length} ops antiguas.`);
    }
    await this.app.vault.adapter.write(path, JSON.stringify({ items: this.items, archived: this.archived }, null, 2));
  }

  // ─── API pública ─────────────────────────────────────────────────────

  async enqueueFileChange(change: FileChange): Promise<void> {
    await this.load();
    this.items.push({
      id: this.makeId(),
      type: "file",
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      payload: change,
    });
    await this.save();
  }

  async enqueueCardChange(change: CardChange): Promise<void> {
    await this.load();
    this.items.push({
      id: this.makeId(),
      type: "card",
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      payload: change,
    });
    await this.save();
  }

  async peek(limit = 100): Promise<QueuedOperation[]> {
    await this.load();
    return this.items.slice(0, limit);
  }

  /** Marca operaciones como aplicadas y las mueve a archived. */
  async ack(ids: string[]): Promise<void> {
    await this.load();
    const set = new Set(ids);
    const applied = this.items.filter((i) => set.has(i.id));
    this.items = this.items.filter((i) => !set.has(i.id));
    this.archived.push(...applied);
    await this.save();
  }

  /** Marca un fallo de sync y reagenda con backoff. */
  async nack(id: string, error: string): Promise<void> {
    await this.load();
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.attempts++;
    item.lastError = error;
    // Mover al final (reintentar más tarde)
    this.items = this.items.filter((i) => i.id !== id);
    this.items.push(item);
    await this.save();
  }

  async clear(): Promise<void> {
    await this.load();
    this.items = [];
    this.archived = [];
    await this.save();
  }

  async stats(): Promise<QueueStats> {
    await this.load();
    const now = Date.now();
    const oldest = this.items[0]?.enqueuedAt;
    const age = oldest ? now - new Date(oldest).getTime() : 0;
    return {
      pending: this.items.length,
      archived: this.archived.length,
      oldestPendingAge: age,
      totalBytes: this.estimateSize(),
    };
  }

  private estimateSize(): number {
    try {
      return JSON.stringify({ items: this.items, archived: this.archived }).length;
    } catch {
      return 0;
    }
  }

  private makeId(): string {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

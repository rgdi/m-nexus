// SyncManager: orquesta la sincronización con el backend (WebDAV, etc.).
// Usa un manifest local con {path → localMtime, remoteMtime, etag} para
// detectar cambios y resolver conflictos.

import { App, Plugin, TFile } from "obsidian";
import { MNexusSettings, SyncBackend, SyncFileEntry, SyncStatus } from "../types";
import { WebDAVClient } from "./webdav";
import { Logger } from "../utils/logger";

interface ManifestEntry {
  path: string;
  localMtime: number;
  localSize: number;
  remoteMtime?: number;
  remoteSize?: number;
  etag?: string;
  lastSync: number;
}

export interface PendingConflict {
  path: string;
  localContent: string;
  remoteContent: string;
  localMtime: number;
  remoteMtime: number;
  localSize: number;
  remoteSize: number;
}

export type ConflictResolution = "keep-local" | "keep-remote" | "keep-both";

const MANIFEST_KEY = "sync_manifest_v1";

export class SyncManager {
  private manifest = new Map<string, ManifestEntry>();
  private webdav: WebDAVClient | null = null;
  private status: SyncStatus = { backend: "disabled", connected: false, pendingUploads: 0, pendingDownloads: 0, conflicts: 0 };

  constructor(
    private app: App,
    private plugin: Plugin,
    private settings: MNexusSettings,
    private log: Logger
  ) {}

  async load(): Promise<void> {
    const all = (await this.plugin.loadData()) as Record<string, unknown> | null;
    const m = (all?.[MANIFEST_KEY] as ManifestEntry[] | undefined) ?? [];
    this.manifest.clear();
    for (const e of m) this.manifest.set(e.path, e);
  }

  async save(): Promise<void> {
    const all = ((await this.plugin.loadData()) as Record<string, unknown>) ?? {};
    all[MANIFEST_KEY] = Array.from(this.manifest.values());
    await this.plugin.saveData(all);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Configura el backend WebDAV. */
  setupWebDAV(config: { url: string; username: string; password: string; basePath: string }): void {
    this.webdav = new WebDAVClient(config, this.log);
    this.status.backend = "webdav";
    this.status.connected = this.webdav.isConfigured();
  }

  /** Push: sube archivos locales modificados al backend. */
  async push(): Promise<{ uploaded: number; failed: number }> {
    if (!this.webdav) throw new Error("WebDAV no configurado.");
    const files = this.app.vault.getMarkdownFiles();
    let uploaded = 0;
    let failed = 0;
    for (const f of files) {
      try {
        const manifest = this.manifest.get(f.path);
        const mtime = f.stat.mtime;
        if (!manifest || manifest.localMtime < mtime) {
          const content = await this.app.vault.read(f);
          await this.webdav.writeText(f.path, content);
          this.manifest.set(f.path, {
            ...(manifest ?? { path: f.path, localSize: 0 }),
            path: f.path,
            localMtime: mtime,
            localSize: f.stat.size,
            remoteMtime: mtime,
            remoteSize: f.stat.size,
            lastSync: Date.now(),
          });
          uploaded++;
          this.log.info(`↑ ${f.path}`);
        }
      } catch (e) {
        this.log.warn(`Falló push ${f.path}: ${(e as Error).message}`);
        failed++;
      }
    }
    await this.save();
    return { uploaded, failed };
  }

  /** Pull: descarga archivos remotos modificados al vault. */
  async pull(): Promise<{ downloaded: number; conflicts: PendingConflict[] }> {
    if (!this.webdav) throw new Error("WebDAV no configurado.");
    const remote = await this.webdav.list();
    let downloaded = 0;
    const conflicts: PendingConflict[] = [];
    for (const r of remote) {
      const local = this.app.vault.getAbstractFileByPath(r.path);
      const manifest = this.manifest.get(r.path);
      if (local instanceof TFile) {
        const localMtime = local.stat.mtime;
        const remoteMtime = r.mtime;
        const localChanged = !manifest || manifest.localMtime > (manifest.remoteMtime ?? 0);
        const remoteChanged = !manifest || remoteMtime > (manifest.remoteMtime ?? 0);
        if (localChanged && remoteChanged) {
          // Conflicto: ambos cambiaron desde último sync
          this.log.warn(`Conflicto en ${r.path}: local y remoto modificados.`);
          const localContent = await this.app.vault.read(local);
          const remoteContent = await this.webdav.readText(r.path);
          conflicts.push({
            path: r.path,
            localContent,
            remoteContent,
            localMtime,
            remoteMtime,
            localSize: local.stat.size,
            remoteSize: r.size,
          });
          continue;
        }
        if (remoteChanged && !localChanged) {
          const content = await this.webdav.readText(r.path);
          await this.app.vault.modify(local, content);
          this.manifest.set(r.path, {
            path: r.path,
            localMtime: localMtime,
            localSize: local.stat.size,
            remoteMtime: remoteMtime,
            remoteSize: r.size,
            etag: r.etag,
            lastSync: Date.now(),
          });
          downloaded++;
          this.log.info(`↓ ${r.path}`);
        }
      } else {
        const content = await this.webdav.readText(r.path);
        await this.app.vault.create(r.path, content);
        this.manifest.set(r.path, {
          path: r.path,
          localMtime: r.mtime,
          localSize: r.size,
          remoteMtime: r.mtime,
          remoteSize: r.size,
          etag: r.etag,
          lastSync: Date.now(),
        });
        downloaded++;
        this.log.info(`+ ${r.path} (nuevo)`);
      }
    }
    await this.save();
    return { downloaded, conflicts };
  }

  /** Sync completo: pull, resuelve, push. */
  async sync(): Promise<{ downloaded: number; uploaded: number; conflicts: PendingConflict[] }> {
    const pullRes = await this.pull();
    const pushRes = await this.push();
    this.status = {
      ...this.status,
      lastSync: Date.now(),
      pendingUploads: 0,
      pendingDownloads: 0,
      conflicts: pullRes.conflicts.length,
    };
    return { downloaded: pullRes.downloaded, conflicts: pullRes.conflicts, uploaded: pushRes.uploaded };
  }

  /**
   * Aplica la resolución de un conflicto. Llamado desde la UI.
   */
  async applyResolution(conflict: PendingConflict, resolution: ConflictResolution): Promise<void> {
    if (!this.webdav) throw new Error("WebDAV no configurado.");
    if (resolution === "keep-local") {
      await this.webdav.writeText(conflict.path, conflict.localContent);
      this.manifest.set(conflict.path, {
        path: conflict.path,
        localMtime: conflict.localMtime,
        localSize: conflict.localSize,
        remoteMtime: Date.now(),
        remoteSize: conflict.localSize,
        lastSync: Date.now(),
      });
    } else if (resolution === "keep-remote") {
      const local = this.app.vault.getAbstractFileByPath(conflict.path);
      if (local instanceof TFile) {
        await this.app.vault.modify(local, conflict.remoteContent);
      }
      this.manifest.set(conflict.path, {
        path: conflict.path,
        localMtime: Date.now(),
        localSize: conflict.remoteSize,
        remoteMtime: conflict.remoteMtime,
        remoteSize: conflict.remoteSize,
        lastSync: Date.now(),
      });
    } else if (resolution === "keep-both") {
      let finalPath = conflict.path.replace(/\.md$/, "") + ".conflict.md";
      let i = 1;
      while (this.app.vault.getAbstractFileByPath(finalPath)) {
        finalPath = conflict.path.replace(/\.md$/, "") + `.conflict.${i}.md`;
        i++;
      }
      await this.app.vault.create(finalPath, conflict.remoteContent);
      this.manifest.set(finalPath, {
        path: finalPath,
        localMtime: Date.now(),
        localSize: conflict.remoteSize,
        remoteMtime: conflict.remoteMtime,
        remoteSize: conflict.remoteSize,
        lastSync: Date.now(),
      });
    }
    await this.save();
  }
}

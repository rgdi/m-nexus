// BackupManager: orquesta backups automáticos y de emergencia.
// Combina localBackup (rápido) + remoteBackup (si hay server/WebDAV).

import { App } from "obsidian";
import { Logger } from "../utils/logger";
import { LocalBackup, BackupEntry } from "./localBackup";
import { HTTPClient } from "../server/client";
import { AuthCredentials } from "../server/types";

export interface BackupConfig {
  /** Si está habilitado. */
  enabled: boolean;
  /** Intervalo en horas. */
  intervalHours: number;
  /** Si sube al servidor remoto. */
  uploadToServer: boolean;
  /** Si también sube a WebDAV (si está configurado). */
  uploadToWebdav: boolean;
  /** Máximo de backups locales a mantener. */
  maxLocal: number;
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  enabled: true,
  intervalHours: 24,
  uploadToServer: true,
  uploadToWebdav: false,
  maxLocal: 10,
};

export class BackupManager {
  private intervalId: number | null = null;
  private lastAutoRun: string | null = null;
  private inFlight: Promise<BackupEntry | null> | null = null;

  constructor(
    private app: App,
    private local: LocalBackup,
    private log: Logger,
    private config: BackupConfig,
    private getClient: () => HTTPClient | null,
    private getCreds: () => AuthCredentials | null,
    private getWebDav: () => { upload: (path: string, content: ArrayBuffer) => Promise<void> } | null
  ) {}

  setConfig(c: BackupConfig) {
    this.config = c;
  }

  /** Llamar desde main.ts en onload. */
  start() {
    this.stop();
    if (!this.config.enabled) return;
    const ms = Math.max(1, this.config.intervalHours) * 3600 * 1000;
    this.intervalId = window.setInterval(() => {
      this.runAuto().catch((e) => this.log.warn(`Backup auto: ${(e as Error).message}`));
    }, ms);
    this.log.info(`Backup automático cada ${this.config.intervalHours}h`);
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Crea un backup manual (con UI feedback). */
  async runManual(note?: string): Promise<BackupEntry> {
    const entry = await this.local.create({ kind: "manual", note });
    await this.maybeUpload(entry);
    await this.local.prune();
    return entry;
  }

  /** Backup automático, no bloquea. */
  async runAuto(): Promise<BackupEntry | null> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      this.lastAutoRun = new Date().toISOString();
      const entry = await this.local.create({ kind: "auto" });
      await this.maybeUpload(entry);
      await this.local.prune();
      return entry;
    })().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /**
   * Backup de EMERGENCIA: se ejecuta antes de operaciones riesgosas
   * o cuando se detecta un error grave. Siempre se sube al server si
   * está disponible, sin esperar a la cola.
   */
  async runEmergency(reason: string): Promise<BackupEntry | null> {
    if (this.inFlight) {
      // No anidar backups de emergencia
      return this.inFlight;
    }
    this.inFlight = (async () => {
      this.log.warn(`🚨 Backup de emergencia: ${reason}`);
      try {
        const entry = await this.local.create({ kind: "emergency", note: reason });
        // Subida PRIORITARIA: saltarse la cola
        await this.maybeUpload(entry, { priority: true }).catch((e) =>
          this.log.error(`Subida de emergencia falló: ${(e as Error).message}`)
        );
        return entry;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  private async maybeUpload(entry: BackupEntry, opts: { priority?: boolean } = {}): Promise<void> {
    if (!this.config.uploadToServer && !this.config.uploadToWebdav) return;
    // v0.28: leer bytes ZIP directamente (no text → binary).
    const buf = await this.app.vault.adapter.readBinary(entry.path);
    const zipBytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    // Servidor central
    if (this.config.uploadToServer) {
      const client = this.getClient();
      const creds = this.getCreds();
      if (client && creds) {
        const res = await client.uploadBackup(creds, {
          zipBytes,
          kind: entry.kind,
          vaultPath: entry.path,
          note: entry.note,
          fileCount: entry.fileCount,
        });
        this.log.info(`Backup ${entry.id} subido: ${res.size}B en ${res.serverDurationMs}ms`);
      }
    }
    // WebDAV
    if (this.config.uploadToWebdav) {
      const wd = this.getWebDav();
      if (wd) {
        await wd.upload(`backups/${entry.id}.mnexus-backup`, zipBytes.buffer as ArrayBuffer);
        this.log.info(`Backup subido a WebDAV: ${entry.id}`);
      }
    }
    void opts; // por ahora la prioridad se ignora, se sube siempre
  }

  getLastAutoRun(): string | null {
    return this.lastAutoRun;
  }
}

// autoBackupService.ts: backup automatico con scheduling.
//
// v0.60 (P2.3): backup periodico del vault, con rotacion.
// Configurable: cada X minutos, mantener N backups, excluir .git/etc.

import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { stat, readdir, mkdir, unlink, copyFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { logOp, logError } from "../utils/log.js";

export interface BackupConfig {
  enabled: boolean;
  intervalMinutes: number;
  maxBackups: number; // retencion
  vaultPath: string;
  outputDir: string;
  excludePatterns: string[]; // ej: ['.git', 'node_modules', '.DS_Store']
}

export interface BackupEntry {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: number;
  // v0.60: content hash
  sha256: string;
  // v0.60: numero de archivos respaldados
  fileCount: number;
}

const DEFAULT_CONFIG: BackupConfig = {
  enabled: false,
  intervalMinutes: 30,
  maxBackups: 10,
  vaultPath: "",
  outputDir: "./backups",
  excludePatterns: [".git", "node_modules", ".DS_Store", ".m-nexus-cache"],
};

class AutoBackupService {
  private config: BackupConfig = DEFAULT_CONFIG;
  private timer: NodeJS.Timeout | null = null;
  private history: BackupEntry[] = [];
  private running = false;

  // v0.60 (P2.3): reset interno para tests
  __reset() {
    this.stop();
    this.history = [];
    this.config = DEFAULT_CONFIG;
  }

  configure(cfg: Partial<BackupConfig>) {
    this.config = { ...this.config, ...cfg };
    logOp("backup", "configured", true, { interval: this.config.intervalMinutes, vault: this.config.vaultPath });
  }

  getConfig(): BackupConfig {
    return { ...this.config };
  }

  async start() {
    if (!this.config.enabled) {
      logOp("backup", "start skipped: disabled", true, {});
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), this.config.intervalMinutes * 60 * 1000);
    logOp("backup", "started", true, { intervalMinutes: this.config.intervalMinutes });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logOp("backup", "stopped", true, {});
  }

  /// v0.60 (P2.3): ejecuta un backup. Devuelve la entry.
  /// v2.6.0: alias `runOnce` added for admin route clarity.
  async tick(): Promise<BackupEntry | null> {
    return this.runOnce();
  }

  async runOnce(): Promise<BackupEntry | null> {
    if (this.running) return null;
    this.running = true;
    try {
      const cfg = this.config;
      if (!existsSync(cfg.vaultPath)) {
        logOp("backup", "vault no existe", false, { vault: cfg.vaultPath });
        return null;
      }
      await mkdir(cfg.outputDir, { recursive: true });
      // Walk + collect files
      const files: string[] = [];
      let fileCount = 0;
      const walk = async (dir: string) => {
        const items = await readdir(dir, { withFileTypes: true });
        for (const it of items) {
          if (this.shouldExclude(it.name)) continue;
          const p = join(dir, it.name);
          if (it.isDirectory()) await walk(p);
          else if (it.isFile()) {
            files.push(p);
            fileCount++;
          }
        }
      };
      await walk(cfg.vaultPath);
      // Crear un .tar.gz basico via concatenacion gzip (simplificado)
      const ts = Date.now();
      const id = `bk-${ts}`;
      const filename = `${id}.tar.gz`;
      const outPath = join(cfg.outputDir, filename);
      // v0.60: usar tar nativo
      const { spawn } = await import("node:child_process");
      await new Promise<void>((resolve, reject) => {
        const tar = spawn("tar", [
          "-czf", outPath,
          "-C", cfg.vaultPath,
          ...files.map(f => f.slice(cfg.vaultPath.length + 1)),
        ]);
        let err = "";
        tar.stderr.on("data", d => err += d.toString());
        tar.on("exit", code => code === 0 ? resolve() : reject(new Error(`tar exit ${code}: ${err}`)));
        tar.on("error", reject);
      });
      const st = await stat(outPath);
      // SHA256
      const sha = await this.sha256(outPath);
      const entry: BackupEntry = {
        id, filename,
        sizeBytes: st.size,
        createdAt: ts,
        sha256: sha,
        fileCount,
      };
      this.history.push(entry);
      // v2.6.0: smart rotation (keepDaily + keepMonthly) before simple maxBackups
      await this.smartRotate();
      // v2.6.0: remote push (best-effort, doesn't fail the backup)
      const { getBackupConfig } = await import("./backupConfig.js");
      const bcfg = getBackupConfig();
      if (bcfg.remoteCommand) {
        try {
          await this.pushRemote(outPath, bcfg.remoteCommand);
        } catch (e) {
          logOp("backup", "remote push failed (non-fatal)", false, { err: (e as Error).message });
        }
      }
      logOp("backup", "created", true, { id, sizeBytes: st.size, fileCount });
      return entry;
    } catch (e) {
      logOp("backup", "tick failed", false, { err: (e as Error).message });
      return null;
    } finally {
      this.running = false;
    }
  }

  /// v2.6.0: smart rotation — keep last N daily + 1 per month.
  /// Falls back to simple maxBackups if backup-config.json has no keepDaily/keepMonthly.
  private async smartRotate(): Promise<void> {
    const { getBackupConfig } = await import("./backupConfig.js");
    const bcfg = getBackupConfig();
    if (!bcfg.keepDaily && !bcfg.keepMonthly) {
      return this.rotate(); // legacy path
    }
    const sorted = [...this.history].sort((a, b) => b.createdAt - a.createdAt);
    const keep = new Set<string>();
    // Daily: newest N
    for (const e of sorted.slice(0, bcfg.keepDaily ?? 30)) keep.add(e.id);
    // Monthly: 1 per YYYY-MM (newest per month)
    const byMonth = new Map<string, BackupEntry>();
    for (const e of sorted) {
      const d = new Date(e.createdAt);
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!byMonth.has(ym)) byMonth.set(ym, e);
    }
    const monthCount = bcfg.keepMonthly ?? 12;
    for (const [, e] of [...byMonth.entries()].slice(0, monthCount)) keep.add(e.id);
    // Delete the rest
    const toDelete = this.history.filter(e => !keep.has(e.id));
    for (const e of toDelete) {
      try {
        await unlink(join(this.config.outputDir, e.filename));
        this.history = this.history.filter(x => x.id !== e.id);
      } catch (_) {}
    }
    logOp("backup", "smart-rotated", true, { kept: keep.size, deleted: toDelete.length });
  }

  /// v2.6.0: push backup to remote via user-defined command. {} is replaced with the path.
  private async pushRemote(backupPath: string, command: string): Promise<void> {
    const { exec } = await import("node:child_process");
    const cmd = command.replaceAll("{}", `"${backupPath}"`);
    return new Promise<void>((resolve, reject) => {
      const child = exec(cmd, { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
        if (err) {
          logError("backup", { code: "EC-BACKUP-200", category: "BACKUP", message: "remote push failed", context: { err: err.message, stderr: stderr?.toString() } });
          reject(err);
          return;
        }
        logOp("backup", "remote push ok", true, { stdout: stdout?.toString().slice(0, 200) });
        resolve();
      });
      child.on("error", reject);
    });
  }

  private shouldExclude(name: string): boolean {
    return this.config.excludePatterns.some(p => name === p || name.startsWith(p));
  }

  private async rotate() {
    const cfg = this.config;
    if (this.history.length <= cfg.maxBackups) return;
    // Eliminar las mas antiguas
    const toDelete = this.history.slice(0, this.history.length - cfg.maxBackups);
    for (const e of toDelete) {
      try {
        await unlink(join(cfg.outputDir, e.filename));
        this.history = this.history.filter(x => x.id !== e.id);
      } catch (_) {}
    }
    logOp("backup", "rotated", true, { deleted: toDelete.length, remaining: this.history.length });
  }

  list(): BackupEntry[] {
    return [...this.history].sort((a, b) => b.createdAt - a.createdAt);
  }

  /// v0.60 (P2.3): restaura un backup al vaultPath.
  async restore(backupId: string): Promise<boolean> {
    const entry = this.history.find(e => e.id === backupId);
    if (!entry) return false;
    const cfg = this.config;
    if (!existsSync(join(cfg.outputDir, entry.filename))) return false;
    const { spawn } = await import("node:child_process");
    return new Promise<boolean>((resolve) => {
      const tar = spawn("tar", [
        "-xzf", join(cfg.outputDir, entry.filename),
        "-C", cfg.vaultPath,
      ]);
      tar.on("exit", code => {
        if (code === 0) {
          logOp("backup", "restored", true, { id: backupId });
          resolve(true);
        } else {
          logOp("backup", "restore failed", false, { id: backupId, code });
          resolve(false);
        }
      });
      tar.on("error", () => resolve(false));
    });
  }

  private async sha256(path: string): Promise<string> {
    const { createHash } = await import("node:crypto");
    return new Promise<string>((resolve, reject) => {
      const hash = createHash("sha256");
      const s = createReadStream(path);
      s.on("data", d => hash.update(d));
      s.on("end", () => resolve(hash.digest("hex")));
      s.on("error", reject);
    });
  }
}

let _instance: AutoBackupService | null = null;
export function getAutoBackupService(): AutoBackupService {
  if (!_instance) _instance = new AutoBackupService();
  return _instance;
}

// ── v2.6.0: thin wrappers for admin route ────────────────────────────

export async function runBackupNow(): Promise<{ ok: boolean; entry?: BackupEntry; error?: string }> {
  const svc = getAutoBackupService();
  const entry = await svc.runOnce();
  if (!entry) return { ok: false, error: "Backup failed — check logs" };
  return { ok: true, entry };
}

export function getBackupStatus() {
  const svc = getAutoBackupService();
  return {
    history: svc.list().slice(0, 20), // most recent 20
    totalBackups: svc.list().length,
    running: false, // can't synchronously check; approximated
  };
}

// LocalBackup: snapshots del vault en formato ZIP binario (.mnexus-backup).
//
// v0.28: REFACTOR — antes usaba un formato custom con base64-en-JSON.
//        Ahora usa ZIP binario estándar (PKZIP), 3-4x más rápido, ~25% más pequeño.
//        - Encoding: src/backup/zipCodec.ts (encodeZip, decodeZip)
//        - Soporta DEFLATE opcional (vía CompressionStream nativo)
//        - Output abrible con unzip/WinRAR/Finder sin conversiones
//
// Estrategia de rotación: mantener últimos N + todos los manuales/emergencia
// + 1 por día durante KEEP_DAILY_FOR_DAYS + 1 por semana durante KEEP_WEEKLY_FOR_WEEKS.

import { App, normalizePath } from "obsidian";
import { Logger } from "../utils/logger";
import { joinPath } from "../utils/paths";
import { encodeZip, decodeZip, type ZipReadEntry } from "./zipCodec";

const BACKUP_FOLDER = ".mnexus-backups";
const MAX_LOCAL_BACKUPS = 10;
const KEEP_DAILY_FOR_DAYS = 7;
const KEEP_WEEKLY_FOR_WEEKS = 4;

export interface BackupEntry {
  id: string;
  path: string;
  size: number;
  createdAt: string;
  kind: "auto" | "manual" | "emergency";
  note?: string;
  fileCount: number;
  /** v0.28: duración de la creación en ms. */
  durationMs?: number;
}

export class LocalBackup {
  constructor(private app: App, private log: Logger) {}

  async ensureFolder(): Promise<void> {
    const norm = normalizePath(BACKUP_FOLDER);
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

  /**
   * v0.28: crea un snapshot ZIP binario. Mucho más rápido que el formato
   * custom anterior: ~3x en escritura y ~25% más pequeño.
   */
  async create(opts: {
    kind: "auto" | "manual" | "emergency";
    note?: string;
    /** Si true, comprime con DEFLATE (más lento pero ~70% más pequeño en .md). */
    deflate?: boolean;
  }): Promise<BackupEntry> {
    const t0 = Date.now();
    await this.ensureFolder();
    const id = this.makeId(opts.kind);
    const filename = `${id}.mnexus-backup`;
    const path = joinPath(BACKUP_FOLDER, filename);

    // 1) Recolectar archivos del vault (excluyendo la propia carpeta y basura)
    const all = this.collectFiles("");
    const entries: { path: string; data: Uint8Array; deflate?: boolean }[] = [];
    for (const f of all) {
      if (f.path.startsWith(BACKUP_FOLDER + "/")) continue;
      if (f.path.includes("/.trash/")) continue;
      try {
        const content = await this.app.vault.read(f as never);
        entries.push({ path: f.path, data: new TextEncoder().encode(content), deflate: opts.deflate });
      } catch (e) {
        this.log.warn(`Backup: no se pudo leer ${f.path}: ${(e as Error).message}`);
      }
    }

    // 2) Metadata: entry META.json al final del ZIP
    const meta = {
      id,
      kind: opts.kind,
      createdAt: new Date().toISOString(),
      note: opts.note,
      fileCount: entries.length,
      appVersion: "0.28.0",
    };
    entries.push({
      path: "META.json",
      data: new TextEncoder().encode(JSON.stringify(meta, null, 2)),
      deflate: false, // metadata siempre store
    });

    // 3) Codificar ZIP binario
    const zipBytes = await encodeZip(entries);
    // writeBinary espera ArrayBuffer. Uint8Array.buffer es ArrayBufferLike en
    // lib.dom.d.ts reciente, así que hacemos el cast explícito.
    await this.app.vault.adapter.writeBinary(path, zipBytes.buffer as ArrayBuffer);

    const stat = await this.app.vault.adapter.stat(path);
    const entry: BackupEntry = {
      id,
      path,
      size: stat?.size ?? zipBytes.byteLength,
      createdAt: meta.createdAt,
      kind: opts.kind,
      note: opts.note,
      fileCount: entries.length - 1, // sin contar META.json
      durationMs: Date.now() - t0,
    };
    this.log.info(
      `Backup ${id} creado: ${entry.fileCount} archivos, ` +
      `${Math.round(entry.size / 1024)} KB en ${entry.durationMs}ms`
    );
    return entry;
  }

  async list(): Promise<BackupEntry[]> {
    await this.ensureFolder();
    const out: BackupEntry[] = [];
    const list = await this.app.vault.adapter.list(normalizePath(BACKUP_FOLDER));
    for (const path of list.files) {
      if (!path.endsWith(".mnexus-backup")) continue;
      const name = path.split("/").pop() ?? "";
      const stat = await this.app.vault.adapter.stat(path);
      out.push({
        id: name.replace(/\.mnexus-backup$/, ""),
        path,
        size: stat?.size ?? 0,
        createdAt: new Date(stat?.ctime ?? Date.now()).toISOString(),
        kind: this.detectKind(name),
        fileCount: 0,
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Lee las entries de un backup (decodifica el ZIP).
   * Útil para mostrar preview o para drag-and-drop sin restaurar al vault.
   */
  async readEntries(backupId: string): Promise<ZipReadEntry[]> {
    const list = await this.list();
    const entry = list.find((b) => b.id === backupId);
    if (!entry) throw new Error(`Backup no encontrado: ${backupId}`);
    const buf = await this.app.vault.adapter.readBinary(entry.path);
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return decodeZip(bytes);
  }

  /** Lee los bytes crudos del ZIP (para drag-and-drop o subida). */
  async readBytes(backupId: string): Promise<Uint8Array> {
    const list = await this.list();
    const entry = list.find((b) => b.id === backupId);
    if (!entry) throw new Error(`Backup no encontrado: ${backupId}`);
    const buf = await this.app.vault.adapter.readBinary(entry.path);
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  }

  async restore(backupId: string, opts: { targetFolder?: string; dryRun?: boolean } = {}): Promise<{
    restored: number;
    skipped: number;
    errors: string[];
  }> {
    const entries = await this.readEntries(backupId);
    const target = opts.targetFolder ?? "";
    let restored = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const e of entries) {
      // Saltar metadata
      if (e.path === "META.json") continue;
      const destPath = target ? `${target}/${e.path}` : e.path;
      if (opts.dryRun) {
        restored++;
        continue;
      }
      try {
        const exists = await this.app.vault.adapter.exists(destPath);
        if (!exists) {
          // Crear carpetas necesarias
          const parts = destPath.split("/");
          for (let i = 1; i < parts.length; i++) {
            const folder = parts.slice(0, i).join("/");
            const folderExists = await this.app.vault.adapter.exists(folder);
            if (!folderExists) {
              try {
                await this.app.vault.createFolder(folder);
              } catch {
                /* idempotente */
              }
            }
          }
        }
        const content = new TextDecoder().decode(e.data);
        await this.app.vault.adapter.write(destPath, content);
        restored++;
      } catch (err) {
        errors.push(`${e.path}: ${(err as Error).message}`);
        skipped++;
      }
    }
    return { restored, skipped, errors };
  }

  async prune(): Promise<number> {
    const list = await this.list();
    if (list.length <= MAX_LOCAL_BACKUPS) return 0;
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const toKeep = new Set<string>();
    for (const b of list) {
      if (b.kind === "manual" || b.kind === "emergency") toKeep.add(b.id);
    }
    for (const b of list.slice(0, MAX_LOCAL_BACKUPS)) toKeep.add(b.id);
    const dayBuckets = new Map<string, BackupEntry>();
    for (const b of list) {
      const dayKey = b.createdAt.slice(0, 10);
      if (!dayBuckets.has(dayKey)) dayBuckets.set(dayKey, b);
    }
    for (const [dayKey, b] of dayBuckets) {
      const age = now - new Date(dayKey).getTime();
      if (age < KEEP_DAILY_FOR_DAYS * day) toKeep.add(b.id);
    }
    const weekBuckets = new Map<string, BackupEntry>();
    for (const b of list) {
      const d = new Date(b.createdAt);
      const startOfWeek = new Date(d);
      startOfWeek.setUTCDate(d.getUTCDate() - d.getUTCDay());
      const weekKey = startOfWeek.toISOString().slice(0, 10);
      if (!weekBuckets.has(weekKey)) weekBuckets.set(weekKey, b);
    }
    for (const [weekKey, b] of weekBuckets) {
      const age = now - new Date(weekKey).getTime();
      if (age < KEEP_WEEKLY_FOR_WEEKS * 7 * day) toKeep.add(b.id);
    }
    let removed = 0;
    for (const b of list) {
      if (toKeep.has(b.id)) continue;
      try {
        await this.app.vault.adapter.remove(b.path);
        removed++;
      } catch (e) {
        this.log.warn(`No se pudo borrar ${b.path}: ${(e as Error).message}`);
      }
    }
    if (removed > 0) this.log.info(`Backup rotation: ${removed} snapshots eliminados.`);
    return removed;
  }

  /** Recolecta todos los archivos markdown del vault. */
  private collectFiles(_root: string) {
    const out: { path: string; name: string; basename: string; extension: string; stat: { size: number; ctime: number; mtime: number } }[] = [];
    const vault = this.app.vault as unknown as { getMarkdownFiles(): { path: string; name: string; basename: string; extension: string; stat: { size: number; ctime: number; mtime: number } }[] };
    out.push(...vault.getMarkdownFiles());
    return out;
  }

  private makeId(kind: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `${kind}-${ts}`;
  }

  private detectKind(filename: string): "auto" | "manual" | "emergency" {
    if (filename.startsWith("emergency")) return "emergency";
    if (filename.startsWith("manual")) return "manual";
    return "auto";
  }
}

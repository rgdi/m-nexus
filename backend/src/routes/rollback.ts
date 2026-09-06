// Rollback routes: backup + restore del backend.
import { dirname } from "node:path";
//
// v0.33: si una actualización rompe algo, el usuario puede
// volver a la versión anterior sin perder datos. El backup se
// hace ANTES de aplicar la actualización.
//
// Endpoints:
//   POST /api/v1/rollback/create    → crea un backup point
//   GET  /api/v1/rollback/list      → lista backups disponibles
//   POST /api/v1/rollback/restore   → restaura desde un backup
//   GET  /api/v1/rollback/strategy  → describe la estrategia

import { FastifyInstance } from "fastify";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { logger, logOp } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";

function backupDir() { return process.env.MNEXUS_BACKUP_DIR ?? "/var/lib/mnexus/backups"; }
function dataDir() { return process.env.MNEXUS_DATA_DIR ?? "/var/lib/mnexus"; }
const MAX_BACKUPS = 5;

interface BackupInfo {
  id: string;
  path: string;
  size: number;
  createdAt: number;
  /** Versión del backend que estaba corriendo cuando se creó. */
  version: string;
  /** Trigger: 'manual' | 'pre_update' | 'scheduled' */
  trigger: string;
  description?: string;
}

// Persistencia mínima: lista de backups en un JSON
import { readFileSync, writeFileSync } from "node:fs";
function registryPath(): string {
  return process.env.MNEXUS_REGISTRY_PATH ?? join(backupDir(), "backups.json");
}

function readRegistry(): BackupInfo[] {
  const p = registryPath();
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return [];
  }
}

function writeRegistry(items: BackupInfo[]): void {
  const p = registryPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(items, null, 2));
}

export async function rollbackRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/rollback/create
  app.post<{ Body: { version?: string; description?: string; trigger?: string } }>(
    "/api/v1/rollback/create",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "bk",
        code: "EC-BK-010",
        message: "rollback.create failed",
        context: { trigger: req.body?.trigger, version: req.body?.version },
        op: async () => {
          const body = req.body ?? {};
          mkdirSync(backupDir(), { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, "-");
          const id = `backup-${ts}`;
          const backupPath = join(backupDir(), `${id}.tar.gz`);
          // Backup: data dir + env file (sin .env secrets — esos están cifrados aparte)
          const dataDirPath = dataDir();
          const excludes = [
            "--exclude=./uploads/final",
            "--exclude=./backups/*.tar.gz",
            "--exclude=./backups/backups.json",
          ].join(" ");
          execSync(
            `tar czf "${backupPath}" -C "${dataDirPath}" ${excludes} . 2>/dev/null || true`,
            { stdio: "pipe", timeout: 60_000 }
          );
          if (!existsSync(backupPath)) {
            throw E.bk("EC-BK-011", "tar command produced no output", {
              context: { backupPath, dataDir: dataDirPath },
              hint: "Check disk space and that tar is available",
            });
          }
          const stat = statSync(backupPath);
          const info: BackupInfo = {
            id,
            path: backupPath,
            size: stat.size,
            createdAt: Date.now(),
            version: body.version ?? "unknown",
            trigger: body.trigger ?? "manual",
            description: body.description,
          };
          const items = readRegistry();
          items.unshift(info);
          // Limpiar backups viejos
          while (items.length > MAX_BACKUPS) {
            const old = items.pop();
            if (old && existsSync(old.path)) {
              try { unlinkSync(old.path); } catch { /* */ }
            }
          }
          writeRegistry(items);
          logOp("bk", "rollback create", true, { id, size: stat.size, trigger: info.trigger });
          return { backup: info, total: items.length };
        }
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // GET /api/v1/rollback/list
  app.get("/api/v1/rollback/list", async (_req, reply) => {
    const items = readRegistry();
    return reply.send({ backups: items, count: items.length });
  });

  // POST /api/v1/rollback/restore
  app.post<{ Body: { id?: string; confirm?: boolean } }>(
    "/api/v1/rollback/restore",
    async (req, reply) => {
      const r = await safeCallAsync({
        component: "bk",
        code: "EC-BK-012",
        message: "rollback.restore failed",
        context: { id: req.body?.id, hasConfirm: req.body?.confirm },
        op: async () => {
          const id = req.body?.id;
          if (!id) {
            throw E.val("EC-BK-013", "id required", {
              context: { bodyKeys: Object.keys(req.body ?? {}) },
              hint: "Send { id: 'backup-...', confirm: true }",
            });
          }
          if (!req.body.confirm) {
            throw E.val("EC-BK-014", "Set confirm:true to proceed", {
              context: { id },
              hint: "Restore OVERWRITES current data; explicit confirmation required",
            });
          }
          const items = readRegistry();
          const item = items.find((b) => b.id === id);
          if (!item) {
            throw E.bk("EC-BK-015", "Backup not found", {
              context: { id },
              statusCode: 404,
              hint: "Run GET /api/v1/rollback/list to see available backups",
            });
          }
          if (!existsSync(item.path)) {
            throw E.bk("EC-BK-016", "Backup file no longer exists", {
              context: { id, path: item.path },
              statusCode: 410,
              hint: "Backup may have been cleaned up due to MAX_BACKUPS limit",
            });
          }
          // Restaurar: extrae el tar.gz en dataDir()
          // Hacemos un backup "pre-restore" por seguridad.
          const restoreBackupPath = join(backupDir(), `pre-restore-${Date.now()}.tar.gz`);
          try {
            execSync(
              `tar czf "${restoreBackupPath}" -C "${dataDir()}" . 2>/dev/null || true`,
              { stdio: "pipe", timeout: 60_000 }
            );
          } catch { /* no bloquees el restore si esto falla */ }
          // Extract sobreescribiendo
          execSync(
            `tar xzf "${item.path}" -C "${dataDir()}" --overwrite`,
            { stdio: "pipe", timeout: 60_000 }
          );
          logOp("bk", "rollback restore", true, { id, preRestoreBackup: restoreBackupPath });
          return {
            ok: true,
            restored: item,
            preRestoreBackup: restoreBackupPath,
            message: "Server should be restarted to apply changes. Run: systemctl restart mnexus",
          };
        }
      });
      if (!r.success || !r.value) throw r.error!;
      return r.value;
    }
  );

  // GET /api/v1/rollback/strategy
  app.get("/api/v1/rollback/strategy", async (_req, reply) => {
    return reply.send({
      strategy: "pre_update_backup",
      maxBackups: MAX_BACKUPS,
      backupDir: backupDir(),
      dataDir: dataDir(),
      commands: {
        list: "GET /api/v1/rollback/list",
        create: "POST /api/v1/rollback/create { trigger: 'manual' }",
        restore: "POST /api/v1/rollback/restore { id: 'backup-...', confirm: true }",
      },
      notes: [
        "Restore requires server restart (systemctl restart mnexus).",
        "Pre-restore backup is automatically created at /var/lib/mnexus/backups/pre-restore-*.tar.gz",
        "Backups do NOT include the master secret key (regenerate if needed).",
        "uploads/final is excluded (transient data).",
      ],
    });
  });
}

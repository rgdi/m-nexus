// autoBackup.ts: rutas de auto-backup (v0.60 P2.3)
import { FastifyInstance } from "fastify";
import { getAutoBackupService, type BackupConfig } from "../services/autoBackupService.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";

export async function autoBackupRoutes(app: FastifyInstance): Promise<void> {
  const svc = getAutoBackupService();

  app.get("/backup/auto/config", async () => svc.getConfig());

  app.post<{ Body: Partial<BackupConfig> }>("/backup/auto/config", async (req) => {
    const cfg = req.body ?? {} as any;
    if (cfg.intervalMinutes != null && (cfg.intervalMinutes < 1 || cfg.intervalMinutes > 1440)) {
      throw E.val("EC-BK-001", "intervalMinutes debe estar entre 1 y 1440", { context: { intervalMinutes: cfg.intervalMinutes } });
    }
    if (cfg.maxBackups != null && (cfg.maxBackups < 1 || cfg.maxBackups > 100)) {
      throw E.val("EC-BK-002", "maxBackups debe estar entre 1 y 100", { context: { maxBackups: cfg.maxBackups } });
    }
    svc.configure(cfg);
    if (cfg.enabled) await svc.start();
    else svc.stop();
    return svc.getConfig();
  });

  app.post("/backup/auto/tick", async () => {
    const entry = await svc.tick();
    return { entry, triggered: true };
  });

  app.get("/backup/auto/list", async () => ({
    backups: svc.list(),
    count: svc.list().length,
  }));

  app.post<{ Params: { id: string } }>("/backup/auto/restore/:id", async (req) => {
    const ok = await svc.restore(req.params.id);
    if (!ok) throw E.val("EC-BK-003", "Backup no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return { restored: true, id: req.params.id };
  });
}

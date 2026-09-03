// v0.30: Endpoints de auto-actualización del backend.
//
// - GET  /api/v1/update           -> info (usa cache 5 min)
// - POST /api/v1/update/check     -> fuerza check (limpia cache)
// - POST /api/v1/update/apply     -> descarga + extrae + reinicia
//
// Proteger con auth de admin (mismo que /api/v1/auth/devices o similar)

import { FastifyInstance } from "fastify";
import {
  getUpdateInfoCached,
  getUpdateInfo,
  clearUpdateCache,
  applyUpdate,
  detectRestartCommand,
} from "../utils/updateChecker.js";
import { logger } from "../utils/log.js";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_ROOT = process.env.MNEXUS_REPO_ROOT ?? join(homedir(), ".mnexus");

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/update
   * Público: solo info, sin daño.
   * Devuelve { currentVersion, latestVersion, hasUpdate, downloadUrl, ... }
   * Usa cache de 5 min para no martillar la API de GitHub.
   */
  app.get("/api/v1/update", async (req, reply) => {
    try {
      const allowPrerelease = (req.query as { prerelease?: string }).prerelease === "1" || (req.query as { prerelease?: string }).prerelease === "true";
      const info = await getUpdateInfoCached(allowPrerelease);
      return info;
    } catch (e) {
      reply.code(500);
      return { error: "update_check_failed", message: (e as Error).message };
    }
  });

  /**
   * POST /api/v1/update/check
   * Fuerza un check (limpia cache y vuelve a consultar).
   */
  app.post("/api/v1/update/check", async (req, reply) => {
    try {
      clearUpdateCache();
      const allowPrerelease = (req.body as { prerelease?: boolean })?.prerelease === true;
      const info = await getUpdateInfo(allowPrerelease);
      return info;
    } catch (e) {
      reply.code(500);
      return { error: "update_check_failed", message: (e as Error).message };
    }
  });

  /**
   * POST /api/v1/update/apply
   * Descarga, respalda, extrae y reinicia.
   * OJO: esto REEMPLAZA los archivos del backend en producción.
   */
  app.post("/api/v1/update/apply", async (req, reply) => {
    try {
      const allowPrerelease = (req.body as { prerelease?: boolean })?.prerelease === true;
      const info = await getUpdateInfo(allowPrerelease);
      if (!info.hasUpdate) {
        reply.code(400);
        return { error: "no_update_available", info };
      }
      const targetDir = process.env.MNEXUS_BACKEND_DIR ?? REPO_ROOT;
      const backupDir = join(targetDir, "..", "mnexus-backups");
      const workDir = join(targetDir, "..", "mnexus-staging");
      const restartCmd = detectRestartCommand();

      logger.info(`[update] applying v${info.latestVersion} (from v${info.currentVersion})`);
      const result = await applyUpdate(info, {
        targetDir,
        backupDir,
        workDir,
        restartCmd,
      });
      if (!result.ok) {
        reply.code(500);
        return { error: "apply_failed", ...result };
      }
      return result;
    } catch (e) {
      reply.code(500);
      return { error: "apply_failed", message: (e as Error).message };
    }
  });
}

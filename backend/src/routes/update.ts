// v0.30: Endpoints de auto-actualización del backend.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import {
  getUpdateInfoCached,
  getUpdateInfo,
  clearUpdateCache,
  applyUpdate,
  detectRestartCommand,
} from "../utils/updateChecker.js";
import { logger, logLifecycle, logOp } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_ROOT = process.env.MNEXUS_REPO_ROOT ?? join(homedir(), ".mnexus");

export async function updateRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/update
  app.get("/api/v1/update", async (req, reply) => {
    const r = await safeCallAsync({
      component: "up",
      code: "EC-UP-010",
      message: "update info check failed",
      context: { allowPrerelease: req.query },
      op: async () => {
        const allowPrerelease = (req.query as { prerelease?: string }).prerelease === "1" ||
                                  (req.query as { prerelease?: string }).prerelease === "true";
        const info = await getUpdateInfoCached(allowPrerelease);
        logOp("up", "check", true, { hasUpdate: info.hasUpdate, latest: info.latestVersion });
        return info;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/update/check
  app.post("/api/v1/update/check", async (req, reply) => {
    const r = await safeCallAsync({
      component: "up",
      code: "EC-UP-011",
      message: "update force check failed",
      context: { allowPrerelease: (req.body as { prerelease?: boolean })?.prerelease },
      op: async () => {
        clearUpdateCache();
        const allowPrerelease = (req.body as { prerelease?: boolean })?.prerelease === true;
        const info = await getUpdateInfo(allowPrerelease);
        logOp("up", "force check", true, { hasUpdate: info.hasUpdate, latest: info.latestVersion });
        return info;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /api/v1/update/apply
  app.post("/api/v1/update/apply", async (req, reply) => {
    const r = await safeCallAsync({
      component: "up",
      code: "EC-UP-012",
      message: "update apply failed",
      context: { allowPrerelease: (req.body as { prerelease?: boolean })?.prerelease },
      op: async () => {
        const allowPrerelease = (req.body as { prerelease?: boolean })?.prerelease === true;
        const info = await getUpdateInfo(allowPrerelease);
        if (!info.hasUpdate) {
          throw E.val("EC-UP-013", "no update available", {
            context: { current: info.currentVersion, latest: info.latestVersion },
            hint: "Already on the latest version",
          });
        }
        const targetDir = process.env.MNEXUS_BACKEND_DIR ?? REPO_ROOT;
        const backupDir = join(targetDir, "..", "mnexus-backups");
        const workDir = join(targetDir, "..", "mnexus-staging");
        const restartCmd = detectRestartCommand();
        logLifecycle("up", "applying update", { from: info.currentVersion, to: info.latestVersion });
        const result = await applyUpdate(info, { targetDir, backupDir, workDir, restartCmd });
        if (!result.ok) {
          throw E.up("EC-UP-014", "apply failed", {
            context: { result },
            hint: "Check logs and disk space",
          });
        }
        return result;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}

// Dashboard routes: expone info de devices + rutas de administración.
// v0.45: error codes estructurados con AppError.

import { FastifyInstance } from "fastify";
import { VERSION } from "../version.js";
import { getRegisteredDevices } from "../auth/devices.js";
import { getRefreshTokenStats } from "../auth/jwt.js";
import { getAuditStats } from "../auth/audit.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/devices
  app.get("/api/v1/devices", async (req, reply) => {
    const r = await safeCallAsync({
      component: "auth",
      code: "EC-AUTH-030",
      message: "get devices failed",
      context: { deviceId: req.auth?.sub },
      op: async () => {
        const devices = getRegisteredDevices();
        logOp("auth", "list devices", true, { count: devices.length });
        return { count: devices.length, devices };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // GET /api/v1/stats
  app.get("/api/v1/stats", async (req, reply) => {
    const r = await safeCallAsync({
      component: "lifecycle",
      code: "EC-LIFECYCLE-010",
      message: "get stats failed",
      op: async () => {
        return {
          version: VERSION,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          refreshTokens: getRefreshTokenStats(),
          audit: getAuditStats(),
        };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}

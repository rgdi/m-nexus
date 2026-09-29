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
  // v2.38.0: GET /api/v1/devices used to be declared here AND in
  // routes/devices.ts. Registering deviceRoutes under the /api/v1 prefix
  // (which the frontend has always called) made Fastify refuse to boot
  // with "Method 'GET' already declared for route '/api/v1/devices'",
  // and the two versions had drifted — this one wrapped the result in
  // safeCall, the other returned the raw list. The one in
  // routes/devices.ts is the canonical one; this duplicate is removed
  // so there is a single source of truth.

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

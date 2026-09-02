// Dashboard routes: expone info de devices + rutas de administración.

import { FastifyInstance } from "fastify";
import { VERSION } from "../server.js";
import { getRegisteredDevices } from "../auth/devices.js";
import { getRefreshTokenStats } from "../auth/jwt.js";
import { getAuditStats } from "../auth/audit.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // / sirve el index.html gracias a @fastify/static
  app.get("/api/v1/devices", async () => {
    const devices = getRegisteredDevices();
    return { count: devices.length, devices };
  });

  app.get("/api/v1/stats", async () => {
    return {
      version: VERSION,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      refreshTokens: getRefreshTokenStats(),
      audit: getAuditStats(),
    };
  });
}

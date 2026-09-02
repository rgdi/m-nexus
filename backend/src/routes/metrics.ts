// Endpoint Prometheus: expone /metrics en formato OpenMetrics.
// v0.13: scrapable desde Prometheus, Grafana, etc.

import { FastifyInstance } from "fastify";
import { getMetrics } from "../utils/metrics.js";
import { getRegisteredDevices } from "../auth/devices.js";
import { getRefreshTokenStats } from "../auth/jwt.js";
import { getAuditStats } from "../auth/audit.js";
import { EmbeddingsService } from "../services/embeddings.js";

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  // público (Prometheus no usa JWT) pero limitado a /metrics exacto
  app.get("/metrics", async (req, reply) => {
    const metrics = getMetrics();
    const emb = new EmbeddingsService();
    const cacheStats = emb.getCacheStats();
    metrics.snapshot({
      activeDevices: getRegisteredDevices().length,
      refreshTokens: getRefreshTokenStats().total,
      auditEntries: getAuditStats().total,
      cacheSize: cacheStats.size,
    });
    reply
      .code(200)
      .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(metrics.render());
  });
}

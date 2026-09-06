// Endpoint Prometheus: expone /metrics en formato OpenMetrics.
// v0.13: scrapable desde Prometheus, Grafana, etc.

import { FastifyInstance } from "fastify";
import { getMetrics } from "../utils/metrics.js";
import { getRegisteredDevices } from "../auth/devices.js";
import { getRefreshTokenStats } from "../auth/jwt.js";
import { getAuditStats } from "../auth/audit.js";
import { EmbeddingsService } from "../services/embeddings.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  // público (Prometheus no usa JWT) pero limitado a /metrics exacto
  app.get("/metrics", async (req, reply) => {
    const r = await safeCallAsync({
      component: "lifecycle",
      code: "EC-LIFECYCLE-020",
      message: "metrics render failed",
      op: async () => {
        const metrics = getMetrics();
        const emb = new EmbeddingsService();
        const cacheStats = emb.getCacheStats();
        metrics.snapshot({
          activeDevices: getRegisteredDevices().length,
          refreshTokens: getRefreshTokenStats().total,
          auditEntries: getAuditStats().total,
          cacheSize: cacheStats.size,
        });
        logOp("lifecycle", "metrics scraped", true, {});
        return metrics.render();
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return reply
      .code(200)
      .header("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
      .send(r.value);
  });
}

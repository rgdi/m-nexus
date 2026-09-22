/* ============================================================
 * routes/pdfSync.ts — Sincronización CRDT de entidades PDF.
 *
 * v2.29.0 — Cross-device sync para highlights + oclusiones.
 *
 * GET  /api/v1/sync/pdf/state?documentPath=...   → estado actual
 * POST /api/v1/sync/pdf/update                   → { documentPath, update (base64), deviceId }
 * GET  /api/v1/sync/pdf/log?documentPath=...&since=<lamport>
 * GET  /api/v1/sync/pdf/devices?documentPath=... → devices que tocaron el doc
 * GET  /api/v1/sync/pdf/stats                    → stats globales
 * ============================================================ */

import type { FastifyInstance } from "fastify";
import { pdfCrdtSync } from "../services/pdfCrdtSync.js";

export async function pdfSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { documentPath?: string } }>(
    "/api/v1/sync/pdf/state",
    async (req, reply) => {
      const dp = req.query.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const state = await pdfCrdtSync.getState(dp);
      return state;
    },
  );

  app.post<{ Body: { documentPath: string; update: string; deviceId: string } }>(
    "/api/v1/sync/pdf/update",
    async (req, reply) => {
      const b = req.body ?? ({} as any);
      if (!b.documentPath || !b.update || !b.deviceId) {
        return reply.code(400).send({ error: "documentPath, update, deviceId required" });
      }
      try {
        const r = await pdfCrdtSync.applyUpdate(b.documentPath, b.update, b.deviceId);
        return { ok: true, ...r };
      } catch (e: any) {
        return reply.code(400).send({ ok: false, error: e?.message ?? "applyUpdate failed" });
      }
    },
  );

  app.get<{ Querystring: { documentPath?: string; since?: string } }>(
    "/api/v1/sync/pdf/log",
    async (req, reply) => {
      const dp = req.query.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const since = parseInt(req.query.since ?? "0", 10);
      return pdfCrdtSync.getLogSince(dp, since);
    },
  );

  app.get<{ Querystring: { documentPath?: string } }>(
    "/api/v1/sync/pdf/devices",
    async (req, reply) => {
      const dp = req.query.documentPath;
      if (!dp) return reply.code(400).send({ error: "documentPath required" });
      const devices = await pdfCrdtSync.listDevices(dp);
      return { documentPath: dp, devices };
    },
  );

  app.get(
    "/api/v1/sync/pdf/stats",
    async () => pdfCrdtSync.stats(),
  );
}

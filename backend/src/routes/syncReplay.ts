// syncReplay.ts — Batch replay endpoint for offline-queued mutations (v2.19.0).
//
// POST /api/v1/sync/replay
// body: { deviceId, entries: [{ id, type, op, resourceId, data, ts }] }
//
// The backend applies each entry in order, returns per-entry results.
// Already-applied entries (older than current state) are reported as
// "superseded" with the current state — the client can decide whether
// to drop, replay, or merge.

import type { FastifyInstance } from "fastify";
import { getDevice } from "../auth/devices.js";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { applyMessageToStore } from "./sync_v2.js";
import { recordReplay, getSyncMetrics } from "../services/syncMetrics.js";

export interface ReplayEntry {
  id: string;                  // client-generated UUID
  type: "note" | "flashcard" | "task" | "event" | "recording" | "subject";
  op: "create" | "update" | "delete";
  resourceId: string;
  data?: any;
  ts: number;                  // when the mutation was made offline (client clock)
  clock?: Record<string, number>; // optional vector clock
  fieldTs?: Record<string, number>; // optional per-field ts
}

export interface ReplayResult {
  id: string;
  status: "applied" | "superseded" | "duplicate" | "rejected";
  conflicts?: string[];
  error?: string;
}

export async function syncReplayRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { deviceId: string; entries: ReplayEntry[] } }>(
    "/sync/replay",
    async (req, reply) => {
      const body = req.body;
      if (!body || !body.deviceId || !Array.isArray(body.entries)) {
        reply.code(400);
        throw E.val("EC-SYNC-001", "deviceId and entries[] required");
      }
      const device = getDevice(body.deviceId);
      if (!device) {
        reply.code(404);
        throw E.val("EC-SYNC-002", "Device not registered", { statusCode: 404 });
      }
      if (device.blocked) {
        reply.code(403);
        throw E.val("EC-SYNC-003", "Device is blocked", { statusCode: 403 });
      }

      // Sort by client timestamp ascending so causality is preserved.
      const sorted = [...body.entries].sort((a, b) => (a.ts || 0) - (b.ts || 0));

      const results: ReplayResult[] = [];
      let applied = 0;
      let superseded = 0;
      let rejected = 0;

      for (const entry of sorted) {
        try {
          // Convert to SyncMessage shape so we can reuse applyMessageToStore.
          const msg = {
            id: entry.id,
            type: entry.type,
            op: entry.op,
            resourceId: entry.resourceId,
            data: entry.data ?? null,
            origin: body.deviceId,
            ts: entry.ts || Date.now(),
            clock: entry.clock,
            parentClock: undefined,
            fieldTs: entry.fieldTs,
          };
          const r = applyMessageToStore(msg);
          if (!r.accepted) {
            results.push({ id: entry.id, status: "superseded" });
            superseded++;
          } else if (r.conflicts && r.conflicts.length) {
            results.push({ id: entry.id, status: "applied", conflicts: r.conflicts });
            applied++;
          } else {
            results.push({ id: entry.id, status: "applied" });
            applied++;
          }
        } catch (e: unknown) {
          results.push({ id: entry.id, status: "rejected", error: String((e as Error).message || e) });
          rejected++;
        }
      }

      logOp("sync", "offline replay", true, {
        deviceId: body.deviceId,
        total: sorted.length,
        applied,
        superseded,
        rejected,
      });

      // v2.21.0: record metrics for the admin dashboard.
      recordReplay(body.deviceId, {
        total: sorted.length,
        applied,
        superseded,
        rejected,
      });

      return {
        ok: true,
        total: sorted.length,
        applied,
        superseded,
        rejected,
        results,
      };
    },
  );

  // v2.21.0: admin dashboard endpoint.
  app.get("/sync/metrics", async () => {
    const m = getSyncMetrics();
    return {
      ok: true,
      metrics: {
        totalReplays: m.totalReplays,
        totalEntriesProcessed: m.totalEntriesProcessed,
        totalApplied: m.totalApplied,
        totalSuperseded: m.totalSuperseded,
        totalRejected: m.totalRejected,
        totalDroppedAfterRetries: m.totalDroppedAfterRetries,
        lastReplayAt: m.lastReplayAt,
        lastReplayDeviceId: m.lastReplayDeviceId,
        perDevice: Object.fromEntries(m.perDevice),
      },
    };
  });
}

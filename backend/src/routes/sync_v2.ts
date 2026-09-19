// sync_v2.ts — E2E sync entre dispositivos via WebSocket relay.
// v2.0.6 — broadcast de cambios (CRUD) a todas las sesiones conectadas.
// v2.1.5+ W4 — Auth opcional vía `?token=` query param (defense-in-depth).
// v2.15.0 — Reemplaza LWW plano por CRDT (vector clocks + field-level LWW).
//
// El cliente abre WS a /ws/sync. Cuando crea/edita/elimina algo,
// el backend hace broadcast a los demás clientes con un reloj vectorial
// y timestamps por campo. Los receptores aplican resolución de conflictos
// field-by-field (last-write-wins per field).

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { verifyAccessToken } from "../auth/jwt.js";
import {
  bumpClock,
  compareClocks,
  joinClocks,
  type VectorClock,
  type FieldTimestamps,
} from "../services/crdt.js";

interface SyncMessage {
  id: string;
  type: "note" | "flashcard" | "task" | "event" | "recording" | "subject";
  op: "create" | "update" | "delete";
  resourceId: string;
  data?: any;
  origin: string; // clientId
  ts: number;
  // v2.15.0 CRDT fields
  clock?: VectorClock;
  parentClock?: VectorClock;
  fieldTs?: FieldTimestamps;
}

interface ResourceState {
  data: any;                       // current canonical state (after merges)
  ts: FieldTimestamps;             // per-field last-write timestamps
  clock: VectorClock;              // merged view of all observed clocks
}

const clients = new Map<string, { send: (m: SyncMessage) => void; userId: string }>();
const HISTORY: SyncMessage[] = [];
const HISTORY_LIMIT = 200;
const RESOURCE_STATE = new Map<string, ResourceState>(); // key = `${type}:${resourceId}`

function resourceKey(type: string, id: string) {
  return `${type}:${id}`;
}

export function applyMessageToStore(msg: SyncMessage): { accepted: boolean; conflicts: string[]; state: ResourceState | null } {
  const key = resourceKey(msg.type, msg.resourceId);
  if (msg.op === "delete") {
    RESOURCE_STATE.delete(key);
    return { accepted: true, conflicts: [], state: null };
  }

  const incoming = msg.data || {};
  const incomingFieldTs: FieldTimestamps = msg.fieldTs || {};
  // Stamp each incoming field with `msg.ts` if no per-field ts provided.
  for (const f of Object.keys(incoming)) {
    if (!incomingFieldTs[f]) incomingFieldTs[f] = msg.ts;
  }
  const incomingClock: VectorClock = msg.clock || { [msg.origin]: 1 };

  const existing = RESOURCE_STATE.get(key);

  if (!existing) {
    const created: ResourceState = {
      data: { ...incoming },
      ts: { ...incomingFieldTs },
      clock: { ...incomingClock },
    };
    RESOURCE_STATE.set(key, created);
    return { accepted: true, conflicts: [], state: created };
  }

  // Determine causal relationship.
  const rel = compareClocks(incomingClock, existing.clock);
  if (rel === "before") {
    return { accepted: false, conflicts: [], state: existing };
  }
  if (rel === "after") {
    // Strictly newer — apply fully.
    const merged = { ...existing.data, ...incoming };
    const tsMerged = { ...existing.ts, ...incomingFieldTs };
    const clockMerged = joinClocks(existing.clock, incomingClock);
    const updated: ResourceState = { data: merged, ts: tsMerged, clock: clockMerged };
    RESOURCE_STATE.set(key, updated);
    return { accepted: true, conflicts: [], state: updated };
  }

  // Concurrent: field-level LWW.
  const out: any = { ...existing.data };
  const outTs: FieldTimestamps = { ...existing.ts };
  const conflicts: string[] = [];
  for (const f of Object.keys(incoming)) {
    const eTs = existing.ts[f] || 0;
    const iTs = incomingFieldTs[f] || 0;
    if (iTs > eTs) {
      out[f] = incoming[f];
      outTs[f] = iTs;
      conflicts.push(f);
    } else if (iTs === eTs && !(f in existing.data)) {
      out[f] = incoming[f];
      outTs[f] = iTs;
    }
  }
  const clockMerged = joinClocks(existing.clock, incomingClock);
  const updated: ResourceState = { data: out, ts: outTs, clock: clockMerged };
  RESOURCE_STATE.set(key, updated);
  return { accepted: true, conflicts, state: updated };
}

function broadcast(msg: SyncMessage, excludeClientId?: string) {
  const applied = applyMessageToStore(msg);
  // Annotate message with conflict info so clients can show merge UI.
  const out: SyncMessage = { ...msg };
  if (applied.conflicts.length) {
    out.data = { ...(msg.data || {}), __mergedFields: applied.conflicts };
  }
  for (const [cid, ws] of clients.entries()) {
    if (cid !== excludeClientId) {
      try { ws.send(out); } catch {}
    }
  }
  HISTORY.push(out);
  if (HISTORY.length > HISTORY_LIMIT) HISTORY.shift();
}

export async function publishSync(app: FastifyInstance, msg: SyncMessage) {
  if (!msg.id) msg.id = randomUUID();
  if (!msg.ts) msg.ts = Date.now();
  if (!msg.origin) msg.origin = "api";
  broadcast(msg, msg.origin);
  app.log.info({ sync: msg }, "sync event");
}

export async function syncV2Routes(app: FastifyInstance): Promise<void> {
  const WS_AUTH_REQUIRED = process.env.WS_AUTH_REQUIRED === "1";

  // WebSocket endpoint (no prefix — at /ws/sync)
  app.get("/ws/sync", { websocket: true }, (socket /* SocketStream */, req) => {
    let userId = "default";

    if (WS_AUTH_REQUIRED) {
      const url = new URL(req.url, "http://localhost");
      const token = url.searchParams.get("token");
      const payload = token ? verifyAccessToken(token) : null;
      if (!payload) {
        try {
          socket.send(JSON.stringify({
            id: randomUUID(),
            type: "subject",
            op: "update",
            resourceId: "auth-error",
            origin: "server",
            ts: Date.now(),
            data: { code: "EC-AUTH-001", message: "Valid ?token=<jwt> required" },
          }));
        } catch {}
        socket.close(4401, "Unauthorized");
        return;
      }
      userId = (payload as any).sub || "default";
    }

    const clientId = randomUUID();
    const send = (m: SyncMessage) => {
      try { socket.send(JSON.stringify(m)); } catch {}
    };
    clients.set(clientId, { send, userId });

    // send hello + recent history so client can hydrate
    send({
      id: randomUUID(),
      type: "subject",
      op: "update",
      resourceId: "hello",
      origin: "server",
      ts: Date.now(),
      data: { clientId, history: HISTORY.slice(-50) },
    });

    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.op && msg?.type && msg?.resourceId) {
          msg.origin = clientId;
          msg.ts = msg.ts || Date.now();
          // Default clock: bump on receive.
          if (!msg.clock) {
            msg.clock = bumpClock({}, clientId);
          }
          broadcast(msg, clientId);
        }
      } catch {}
    });

    socket.on("close", () => {
      clients.delete(clientId);
    });
  });
}

/**
 * syncV2RestRoutes — REST endpoints under /api/v1/sync.
 */
export async function syncV2RestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: SyncMessage }>("/sync/publish", async (req) => {
    const msg = { ...req.body, ts: req.body.ts || Date.now(), origin: req.body.origin || "api" };
    if (!msg.id) msg.id = randomUUID();
    if (!msg.clock) {
      msg.clock = bumpClock({}, msg.origin);
    }
    broadcast(msg, msg.origin);
    const applied = RESOURCE_STATE.get(`${msg.type}:${msg.resourceId}`);
    return {
      ok: true,
      broadcastedTo: clients.size - 1,
      accepted: true,
      conflicts: applied && applied.ts && msg.fieldTs
        ? Object.keys(msg.fieldTs).filter((f) => (applied.ts[f] || 0) > 0)
        : [],
    };
  });

  app.get("/sync/history", async () => {
    return { history: HISTORY.slice(-50) };
  });

  // v2.16.0: per-resource history (last N messages for a single type:id).
  // Used by the conflict merge UI to compute field-level diffs.
  app.get<{ Params: { type: string; id: string }; Querystring: { limit?: string } }>(
    "/sync/history/:type/:id",
    async (req) => {
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
      const key = `${req.params.type}:${req.params.id}`;
      const filtered = HISTORY.filter(
        (m) => `${m.type}:${m.resourceId}` === key,
      ).slice(-limit);
      return { history: filtered };
    },
  );

  // v2.15.0: current resource state (CRDT-merged view) for a given resource.
  app.get<{ Params: { type: string; id: string } }>("/sync/state/:type/:id", async (req) => {
    const key = resourceKey(req.params.type, req.params.id);
    const state = RESOURCE_STATE.get(key);
    if (!state) return { found: false };
    return { found: true, data: state.data, ts: state.ts, clock: state.clock };
  });

  // v2.15.0: list all currently-tracked resources (debug + UI).
  app.get("/sync/state", async () => {
    const resources: Record<string, { data: any; clock: VectorClock }> = {};
    for (const [k, v] of RESOURCE_STATE.entries()) {
      resources[k] = { data: v.data, clock: v.clock };
    }
    return { count: Object.keys(resources).length, resources };
  });

  app.get("/sync/stats", async () => {
    return {
      connectedClients: clients.size,
      historySize: HISTORY.length,
      resourcesTracked: RESOURCE_STATE.size,
    };
  });
}

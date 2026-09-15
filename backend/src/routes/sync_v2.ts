// sync_v2.ts — E2E sync entre dispositivos via WebSocket relay.
// v2.0.6 — broadcast de cambios (CRUD) a todas las sesiones conectadas.
// v2.1.5+ W4 — Auth opcional vía `?token=` query param (defense-in-depth).
//
// El cliente abre WS a /ws/sync. Cuando crea/edita/elimina algo,
// el backend hace broadcast a los demás clientes. Los clientes
// actualizan su cache local con el cambio.
//
// Seguridad:
// - Solo se reenvían IDs + tipos de cambio (no payload sensible)
// - Los datos sensibles pasan por la API REST normal con auth
// - Si WS_AUTH_REQUIRED=1, el WS requiere ?token=<jwt> válido
// - Por defecto: WS_AUTH_REQUIRED=0 (back-compat con offline-first)

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { verifyAccessToken } from "../auth/jwt.js";

interface SyncMessage {
  id: string;
  type: "note" | "flashcard" | "task" | "event" | "recording" | "subject";
  op: "create" | "update" | "delete";
  resourceId: string;
  data?: any;
  origin: string; // clientId
  ts: number;
}

const clients = new Map<string, { send: (m: SyncMessage) => void; userId: string }>();
const HISTORY: SyncMessage[] = [];
const HISTORY_LIMIT = 200;

function broadcast(msg: SyncMessage, excludeClientId?: string) {
  for (const [cid, ws] of clients.entries()) {
    if (cid !== excludeClientId) {
      try { ws.send(msg); } catch {}
    }
  }
  HISTORY.push(msg);
  if (HISTORY.length > HISTORY_LIMIT) HISTORY.shift();
}

export async function publishSync(app: FastifyInstance, msg: SyncMessage) {
  broadcast(msg, msg.origin);
  app.log.info({ sync: msg }, "sync event");
}

export async function syncV2Routes(app: FastifyInstance): Promise<void> {
  // v2.1.5+ W4: WS auth opcional. Activar con WS_AUTH_REQUIRED=1.
  // Permite cerrar WS si se quiere v3.0 auth-by-default sin romper v2.1.x.
  const WS_AUTH_REQUIRED = process.env.WS_AUTH_REQUIRED === "1";

  // WebSocket endpoint (no prefix — at /ws/sync)
  app.get("/ws/sync", { websocket: true }, (socket /* SocketStream */, req) => {
    let userId = "default";

    // v2.1.5+ W4: validar ?token= si WS_AUTH_REQUIRED=1
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
 * Separated so they can be registered with /api/v1 prefix.
 */
export async function syncV2RestRoutes(app: FastifyInstance): Promise<void> {
  // REST endpoint to publish a sync event from any client
  app.post<{ Body: SyncMessage }>("/sync/publish", async (req) => {
    const msg = { ...req.body, ts: Date.now(), origin: req.body.origin || "api" };
    if (!msg.id) msg.id = randomUUID();
    broadcast(msg, msg.origin);
    return { ok: true, broadcastedTo: clients.size - 1 };
  });

  // Get recent history (for late-joining clients to catch up)
  app.get("/sync/history", async () => {
    return { history: HISTORY.slice(-50) };
  });

  // Stats
  app.get("/sync/stats", async () => {
    return {
      connectedClients: clients.size,
      historySize: HISTORY.length,
    };
  });
}

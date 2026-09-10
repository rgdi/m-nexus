// crdt.ts: rutas HTTP para sincronizacion CRDT de notas.
//
// v0.51: endpoints:
//   GET    /api/v1/crdt/rooms              -> lista rooms activos
//   GET    /api/v1/crdt/rooms/:notePath    -> descarga estado binario
//   POST   /api/v1/crdt/rooms/:notePath    -> upload update binario
//   DELETE /api/v1/crdt/rooms/:notePath    -> elimina room
//   GET    /api/v1/crdt/stats              -> stats de almacenamiento
//   WS     /api/v1/crdt/ws/:notePath       -> WebSocket sync con broadcast real
//
// v0.60 (P0.1): broadcast de updates entre clientes del mismo room.
// v0.60 (P0.1): heartbeat ping/pong cada 30s.
// v0.60 (P0.1): cursor awareness (origen del update).

import { FastifyInstance } from "fastify";
import { join } from "node:path";
import { config } from "../config.js";
import { getCrdtSyncService } from "../services/crdtSyncService.js";
import { logger, logOp, logNetwork } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import * as Y from "yjs";
import type WebSocket from "ws";

// v0.60 (P0.1): hub global de WebSocket clients para broadcast real.
interface WsClient {
  ws: WebSocket;
  clientId: string;
  notePath: string;
  remote: string;
  connectedAt: number;
  // Awareness: nombre de usuario y color (para cursores colab)
  userName?: string;
  userColor?: string;
  lastPong: number;
}

const wsClients = new Map<string, WsClient>(); // clientId -> client
const wsByRoom = new Map<string, Set<string>>(); // notePath -> Set<clientId>

// Heartbeat: limpia clients inactivos (no pong en 60s)
setInterval(() => {
  const now = Date.now();
  for (const [clientId, client] of wsClients) {
    if (now - client.lastPong > 60_000) {
      logOp("crdt", "ws heartbeat timeout", true, { clientId, notePath: client.notePath });
      try { client.ws.close(1001, "heartbeat timeout"); } catch {}
      wsClients.delete(clientId);
      wsByRoom.get(client.notePath)?.delete(clientId);
    }
  }
}, 15_000).unref();

export async function crdtRoutes(app: FastifyInstance): Promise<void> {
  const persistenceDir = join(config.crdtDir ?? "./.m-nexus-crdt");
  const service = getCrdtSyncService(persistenceDir);

  // Listar rooms
  app.get("/crdt/rooms", async () => {
    return { rooms: service.listRooms() };
  });

  // Stats
  app.get("/crdt/stats", async () => {
    return await service.storageStats();
  });

  // GET estado (binario)
  app.get<{ Params: { notePath: string } }>(
    "/crdt/rooms/:notePath",
    async (req, reply) => {
      const notePath = decodeURIComponent(req.params.notePath);
      const state = await service.getState(notePath);
      reply.header("Content-Type", "application/octet-stream");
      reply.header("X-Crdt-Size", state.byteLength.toString());
      logNetwork("GET", `/crdt/rooms/${notePath}`, {
        statusCode: 200, durationMs: 0,
      });
      return reply.send(Buffer.from(state));
    },
  );

  // POST update (binario)
  app.post<{ Params: { notePath: string }; Body: Buffer }>(
    "/crdt/rooms/:notePath",
    async (req, reply) => {
      const notePath = decodeURIComponent(req.params.notePath);
      const body = req.body;
      if (!body || body.length === 0) {
        throw E.val("EC-CRDT-001", "empty body", { hint: "Send binary Yjs update" });
      }
      await service.applyUpdate(notePath, new Uint8Array(body), `client:http:${req.ip}`);
      logNetwork("POST", `/crdt/rooms/${notePath}`, {
        statusCode: 200, durationMs: 0,
      });
      return { ok: true, bytes: body.length };
    },
  );

  // DELETE room
  app.delete<{ Params: { notePath: string } }>(
    "/crdt/rooms/:notePath",
    async (req) => {
      const notePath = decodeURIComponent(req.params.notePath);
      await service.removeRoom(notePath);
      return { ok: true };
    },
  );

  // v0.60 (P0.1): WebSocket con broadcast real, awareness, heartbeat
  app.get("/crdt/ws/:notePath", { websocket: true }, async (socket, req) => {
    const notePath = decodeURIComponent((req.params as { notePath: string }).notePath);
    const clientId = `client:ws:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const remote = req.socket.remoteAddress ?? "unknown";
    const userName = (req.headers["x-user-name"] as string) || "anonymous";
    const userColor = (req.headers["x-user-color"] as string) || "#7c3aed";
    const room = await service.getOrCreateRoom(notePath);
    room.clients.add(clientId);

    // Registrar en el hub global
    const client: WsClient = {
      ws: socket as any,
      clientId, notePath, remote,
      connectedAt: Date.now(),
      userName, userColor,
      lastPong: Date.now(),
    };
    wsClients.set(clientId, client);
    if (!wsByRoom.has(notePath)) wsByRoom.set(notePath, new Set());
    wsByRoom.get(notePath)!.add(clientId);

    logOp("crdt", "ws connected", true, {
      notePath, clientId, remote, userName,
      totalClients: room.clients.size, totalWs: wsClients.size,
    });

    // Send initial state
    const initState = Y.encodeStateAsUpdate(room.doc);
    socket.send(Buffer.from(initState));

    // v0.60 (P0.1): notificar a otros clients que este se conectó
    const presenceMsg = Buffer.from(JSON.stringify({
      type: "presence:join",
      clientId, userName, userColor,
      activeClients: Array.from(wsByRoom.get(notePath) || []).map(id => {
        const c = wsClients.get(id);
        return c ? { id: c.clientId, name: c.userName, color: c.userColor } : null;
      }).filter(Boolean),
    }));
    for (const [oid, other] of wsClients) {
      if (oid === clientId) continue;
      if (other.notePath !== notePath) continue;
      try { (other.ws as any).send(presenceMsg); } catch {}
    }

    socket.on("message", (data: Buffer) => {
      try {
        // v0.60 (P0.1): ping/pong para heartbeat
        if (data.length === 4 && data[0] === 0x70) { // "ping" magic byte
          client.lastPong = Date.now();
          try { (socket as any).send(Buffer.from([0x70, 0x6f, 0x6e, 0x67])); } catch {} // "pong"
          return;
        }
        // v0.60 (P0.1): awareness message (cursor, selection)
        if (data.length > 0 && data[0] === 0x61) { // "aware" magic byte
          const json = data.slice(1).toString("utf-8");
          const awarenessMsg = Buffer.concat([Buffer.from([0x61]), Buffer.from(JSON.stringify({
            type: "awareness",
            clientId, userName, userColor,
            data: JSON.parse(json),
          }))]);
          for (const [oid, other] of wsClients) {
            if (oid === clientId) continue;
            if (other.notePath !== notePath) continue;
            try { (other.ws as any).send(awarenessMsg); } catch {}
          }
          return;
        }
        // CRDT update binario
        const update = new Uint8Array(data);
        Y.applyUpdate(room.doc, update, clientId);
        service["schedulePersist"]?.(service["roomKey"]?.(notePath) ?? "");
        // v0.60 (P0.1): BROADCAST REAL a otros clients del mismo room
        let broadcastCount = 0;
        for (const [oid, other] of wsClients) {
          if (oid === clientId) continue;
          if (other.notePath !== notePath) continue;
          if ((other.ws as any).readyState === 1) { // OPEN
            try { (other.ws as any).send(Buffer.from(update)); broadcastCount++; } catch {}
          }
        }
        if (broadcastCount > 0) {
          logOp("crdt", "ws update broadcast", true, {
            notePath, bytes: update.byteLength, broadcastCount,
          });
        }
      } catch (e) {
        logger.warn(`[crdt] ws message error: ${e}`);
      }
    });

    socket.on("close", () => {
      room.clients.delete(clientId);
      wsClients.delete(clientId);
      wsByRoom.get(notePath)?.delete(clientId);
      logOp("crdt", "ws disconnected", true, { notePath, clientId, totalWs: wsClients.size });
      // v0.60 (P0.1): notificar leave
      const leaveMsg = Buffer.from(JSON.stringify({
        type: "presence:leave",
        clientId,
        activeClients: Array.from(wsByRoom.get(notePath) || []).map(id => {
          const c = wsClients.get(id);
          return c ? { id: c.clientId, name: c.userName, color: c.userColor } : null;
        }).filter(Boolean),
      }));
      for (const [oid, other] of wsClients) {
        if (oid === clientId) continue;
        if (other.notePath !== notePath) continue;
        try { (other.ws as any).send(leaveMsg); } catch {}
      }
    });

    socket.on("error", (e: Error) => {
      logger.warn(`[crdt] ws error for ${clientId}: ${e}`);
    });
  });

  // Info endpoint
  app.get("/crdt/ws/info", async () => {
    return { wsPath: "/api/v1/crdt/ws/:notePath", protocol: "yjs-sync-v1" };
  });
}



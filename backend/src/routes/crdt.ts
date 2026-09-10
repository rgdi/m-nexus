// crdt.ts: rutas HTTP para sincronizacion CRDT de notas.
//
// v0.51: endpoints:
//   GET    /api/v1/crdt/rooms              -> lista rooms activos
//   GET    /api/v1/crdt/rooms/:notePath    -> descarga estado binario
//   POST   /api/v1/crdt/rooms/:notePath    -> upload update binario
//   DELETE /api/v1/crdt/rooms/:notePath    -> elimina room
//   GET    /api/v1/crdt/stats              -> stats de almacenamiento
//   WS     /api/v1/crdt/ws/:notePath       -> WebSocket sync
//
// El cliente envia updates binarios de Yjs. El servidor los aplica al doc
// y los persiste en .m-nexus-crdt/<hash>.bin.

import { FastifyInstance } from "fastify";
import { join } from "node:path";
import { config } from "../config.js";
import { getCrdtSyncService } from "../services/crdtSyncService.js";
import { logger, logOp, logNetwork } from "../utils/log.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import * as Y from "yjs";

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

  // WebSocket upgrade
  app.get("/crdt/ws/:notePath", { websocket: true }, async (socket, req) => {
    const notePath = decodeURIComponent((req.params as { notePath: string }).notePath);
    const clientId = `client:ws:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const remote = req.socket.remoteAddress ?? "unknown";
    const room = await service.getOrCreateRoom(notePath);
    room.clients.add(clientId);
    logOp("crdt", "ws connected", true, { notePath, clientId, remote, totalClients: room.clients.size });

    // Send initial state
    const initState = Y.encodeStateAsUpdate(room.doc);
    socket.send(Buffer.from(initState));

    socket.on("message", (data: Buffer) => {
      try {
        const update = new Uint8Array(data);
        Y.applyUpdate(room.doc, update, clientId);
        service["schedulePersist"]?.(service["roomKey"]?.(notePath) ?? "");
        // For broadcast: in this version, cada cliente pide estado completo
        // via GET si quiere refresco. Para true broadcast P2P se usaria
        // un hub central con clientes[wss] map; simplificado en v0.51
      } catch (e) {
        logger.warn(`[crdt] ws message error: ${e}`);
      }
    });

    socket.on("close", () => {
      room.clients.delete(clientId);
      logOp("crdt", "ws disconnected", true, { notePath, clientId, totalClients: room.clients.size });
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



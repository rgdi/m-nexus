// Rutas para push notifications.

import type { FastifyInstance } from "fastify";
import {
  registerToken,
  listTokens,
  removeToken,
  sendPush,
  broadcastToUser,
  getPushStats,
  type PushToken,
  type PushPayload,
} from "../services/pushNotifications.js";

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // Registrar un token de push
  app.post("/push/register", async (req, reply) => {
    const body = req.body as Omit<PushToken, "registeredAt" | "lastSeenAt">;
    if (!body.deviceId || !body.token || !body.platform) {
      reply.code(400);
      return { error: "deviceId, token, platform required" };
    }
    if (body.platform !== "ios" && body.platform !== "android") {
      reply.code(400);
      return { error: "platform must be 'ios' or 'android'" };
    }
    registerToken({
      ...body,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    return { success: true };
  });

  // Desregistrar
  app.delete("/push/token/:deviceId", async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const removed = removeToken(deviceId);
    if (!removed) {
      reply.code(404);
      return { error: "Token not found" };
    }
    return { success: true };
  });

  // Enviar push a un device
  app.post("/push/send", async (req, reply) => {
    const body = req.body as { deviceId: string; payload: PushPayload };
    if (!body.deviceId || !body.payload) {
      reply.code(400);
      return { error: "deviceId and payload required" };
    }
    const result = await sendPush(body.deviceId, body.payload);
    if (!result.success) reply.code(500);
    return result;
  });

  // Broadcast a todos los devices de un usuario
  app.post("/push/broadcast", async (req, reply) => {
    const body = req.body as { userId: string; payload: PushPayload };
    if (!body.userId || !body.payload) {
      reply.code(400);
      return { error: "userId and payload required" };
    }
    const results = await broadcastToUser(body.userId, body.payload);
    const success = results.filter((r) => r.success).length;
    return { totalSent: results.length, success, results };
  });

  // Listar tokens (admin)
  app.get("/push/tokens", async () => {
    return { tokens: listTokens() };
  });

  // Stats
  app.get("/push/stats", async () => {
    return getPushStats();
  });
}

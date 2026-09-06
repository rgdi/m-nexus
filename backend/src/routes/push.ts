// Rutas para push notifications.
// v0.45: error codes estructurados con AppError.

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
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

interface RegisterTokenBody {
  deviceId?: string;
  token?: string;
  platform?: "ios" | "android";
  deviceInfo?: string;
}

interface SendPushBody {
  deviceId?: string;
  payload?: PushPayload;
}

interface BroadcastBody {
  userId?: string;
  payload?: PushPayload;
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // POST /push/register
  app.post("/push/register", async (req, reply) => {
    const body = (req.body ?? {}) as RegisterTokenBody;
    const r = await safeCallAsync({
      component: "push",
      code: "EC-PUSH-010",
      message: "register token failed",
      context: { deviceId: body.deviceId?.slice(0, 8), platform: body.platform },
      op: async () => {
        if (!body.deviceId || !body.token || !body.platform) {
          throw E.val("EC-PUSH-011", "deviceId, token, platform required", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { deviceId, token, platform: 'ios'|'android' }",
          });
        }
        if (body.platform !== "ios" && body.platform !== "android") {
          throw E.val("EC-PUSH-012", "platform must be 'ios' or 'android'", {
            context: { platform: body.platform },
            hint: "Use 'ios' for iOS, 'android' for Android",
          });
        }
        registerToken({
          deviceId: body.deviceId,
          token: body.token,
          platform: body.platform,
          deviceInfo: body.deviceInfo,
          registeredAt: Date.now(),
          lastSeenAt: Date.now(),
        });
        logOp("push", "token registered", true, { deviceId: body.deviceId.slice(0, 8), platform: body.platform });
        return { success: true };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // DELETE /push/token/:deviceId
  app.delete<{ Params: { deviceId: string } }>("/push/token/:deviceId", async (req, reply) => {
    const { deviceId } = req.params;
    const r = await safeCallAsync({
      component: "push",
      code: "EC-PUSH-013",
      message: "remove token failed",
      context: { deviceId: deviceId.slice(0, 8) },
      op: async () => {
        const removed = removeToken(deviceId);
        if (!removed) {
          throw E.push("EC-PUSH-014", "Token not found", {
            context: { deviceId: deviceId.slice(0, 8) },
            hint: "Token may have been already removed",
            statusCode: 404,
          });
        }
        logOp("push", "token removed", true, { deviceId: deviceId.slice(0, 8) });
        return { success: true };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /push/send
  app.post("/push/send", async (req, reply) => {
    const body = (req.body ?? {}) as SendPushBody;
    const r = await safeCallAsync({
      component: "push",
      code: "EC-PUSH-015",
      message: "send push failed",
      context: { deviceId: body.deviceId?.slice(0, 8), title: body.payload?.title },
      op: async () => {
        if (!body.deviceId || !body.payload) {
          throw E.val("EC-PUSH-016", "deviceId and payload required", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { deviceId, payload: { title, body, ... } }",
          });
        }
        const result = await sendPush(body.deviceId, body.payload);
        if (!result.success) {
          throw E.push("EC-PUSH-017", "Push send failed", {
            context: { deviceId: body.deviceId.slice(0, 8), error: result.error },
            hint: "Check FCM/APNs credentials and device token",
          });
        }
        return result;
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // POST /push/broadcast
  app.post("/push/broadcast", async (req, reply) => {
    const body = (req.body ?? {}) as BroadcastBody;
    const r = await safeCallAsync({
      component: "push",
      code: "EC-PUSH-018",
      message: "broadcast failed",
      context: { userId: body.userId?.slice(0, 8) },
      op: async () => {
        if (!body.userId || !body.payload) {
          throw E.val("EC-PUSH-019", "userId and payload required", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { userId, payload: { title, body, ... } }",
          });
        }
        const results = await broadcastToUser(body.userId, body.payload);
        const success = results.filter((rr) => rr.success).length;
        return { totalSent: results.length, success, results };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // GET /push/tokens (admin)
  app.get("/push/tokens", async (req, reply) => {
    const r = await safeCallAsync({
      component: "push",
      code: "EC-PUSH-020",
      message: "list tokens failed",
      op: async () => ({ tokens: listTokens() }),
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // GET /push/stats
  app.get("/push/stats", async (req, reply) => {
    const r = await safeCallAsync({
      component: "push",
      code: "EC-PUSH-021",
      message: "get stats failed",
      op: async () => getPushStats(),
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });
}

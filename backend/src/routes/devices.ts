// devices.ts — HTTP routes for device registration + permissions + preferences (v2.19.0).
//
// POST   /api/v1/devices/register     → register or re-register a device
// GET    /api/v1/devices               → list all devices (admin)
// GET    /api/v1/devices/:id           → get device detail
// PATCH  /api/v1/devices/:id/permissions → update granular runtime permissions
// PATCH  /api/v1/devices/:id/preferences → update free-form preferences (backend URL, etc.)
// POST   /api/v1/devices/:id/heartbeat  → mark device as alive (updates lastSeenAt)

import type { FastifyInstance } from "fastify";
import {
  registerDevice,
  getDevice,
  getRegisteredDevices,
  updateDevicePermissions,
  updateDevicePreferences,
  blockDevice,
  type DevicePermissions,
  type DeviceRegistrationInput,
} from "../auth/devices.js";
import { E } from "../utils/errorCodes.js";

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // Register / re-register a device.
  app.post<{ Body: DeviceRegistrationInput }>("/devices/register", async (req, reply) => {
    const body = req.body || ({} as DeviceRegistrationInput);
    if (!body.deviceId) {
      reply.code(400);
      throw E.val("EC-AUTH-013", "deviceId required");
    }
    const d = await registerDevice(body);
    return { ok: true, device: d };
  });

  // List all devices.
  //
  // v2.38.0: this returned `{ ok, devices }` while a duplicate
  // GET /api/v1/devices in dashboard.ts returned `{ count, devices }`
  // wrapped in safeCall. The two had drifted for a long time and only
  // one of them could be registered under the /api/v1 prefix, so the
  // admin dashboard lost the `count` it reads. The richer shape wins.
  app.get("/devices", async () => {
    const devices = getRegisteredDevices();
    return { ok: true, count: devices.length, devices };
  });

  // Get one device.
  app.get<{ Params: { id: string } }>("/devices/:id", async (req, reply) => {
    const d = getDevice(req.params.id);
    if (!d) {
      reply.code(404);
      throw E.val("EC-AUTH-031", "Device not found", { statusCode: 404 });
    }
    return { ok: true, device: d };
  });

  // Update permissions. Accepts a partial DevicePermissions object.
  app.patch<{ Params: { id: string }; Body: DevicePermissions }>(
    "/devices/:id/permissions",
    async (req, reply) => {
      const d = await updateDevicePermissions(req.params.id, req.body || {});
      if (!d) {
        reply.code(404);
        throw E.val("EC-AUTH-031", "Device not found", { statusCode: 404 });
      }
      return { ok: true, device: d };
    },
  );

  // Update preferences (backend URL, sync interval, etc.).
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/devices/:id/preferences",
    async (req, reply) => {
      const d = await updateDevicePreferences(req.params.id, req.body || {});
      if (!d) {
        reply.code(404);
        throw E.val("EC-AUTH-031", "Device not found", { statusCode: 404 });
      }
      return { ok: true, device: d };
    },
  );

  // Heartbeat.
  app.post<{ Params: { id: string } }>("/devices/:id/heartbeat", async (req, reply) => {
    const cur = getDevice(req.params.id);
    if (!cur) {
      reply.code(404);
      throw E.val("EC-AUTH-031", "Device not found", { statusCode: 404 });
    }
    cur.lastSeenAt = Date.now();
    return { ok: true, lastSeenAt: cur.lastSeenAt };
  });

  // Admin: block / unblock.
  app.post<{ Params: { id: string }; Body: { blocked?: boolean } }>(
    "/devices/:id/block",
    async (req, reply) => {
      const cur = getDevice(req.params.id);
      if (!cur) {
        reply.code(404);
        throw E.val("EC-AUTH-031", "Device not found", { statusCode: 404 });
      }
      blockDevice(req.params.id, req.body?.blocked !== false);
      return { ok: true, device: getDevice(req.params.id) };
    },
  );
}

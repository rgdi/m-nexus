// Devices registry: persistencia simple en memoria con info extendida.
// v0.45: error codes estructurados.

import { E } from "../utils/errorCodes.js";
import { safeCall } from "../utils/safeCall.js";
import { logOp, logLifecycle } from "../utils/log.js";

export interface RegisteredDevice {
  deviceId: string;
  deviceName?: string;
  platform?: string;
  pluginVersion?: string;
  /** Si el dispositivo está bloqueado. */
  blocked?: boolean;
  registeredAt: number;
  /** Token de acceso actual (no se persiste el refresh, solo el último access). */
  lastAccessTokenId?: string;
  /** Permite cifrado E2E: clave pública del dispositivo o nada. */
  publicKeyJwk?: JsonWebKey;
}

const registeredDevices = new Map<string, RegisteredDevice>();

export function registerDevice(
  deviceId: string,
  info: { deviceName?: string; platform?: string; pluginVersion?: string; publicKeyJwk?: JsonWebKey }
): RegisteredDevice {
  const r = safeCall<RegisteredDevice>({
    component: "auth",
    code: "EC-AUTH-012",
    message: "registerDevice failed",
    context: { deviceId, hasName: !!info.deviceName, platform: info.platform },
    op: () => {
      if (!deviceId || deviceId.length < 8) {
        throw E.val("EC-AUTH-013", "Invalid deviceId", {
          context: { deviceIdLen: deviceId?.length ?? 0 },
          hint: "deviceId must be a UUID (36 chars) or similar identifier",
        });
      }
      const existing = registeredDevices.get(deviceId);
      if (existing) {
        if (info.deviceName) existing.deviceName = info.deviceName;
        if (info.platform) existing.platform = info.platform;
        if (info.pluginVersion) existing.pluginVersion = info.pluginVersion;
        if (info.publicKeyJwk) existing.publicKeyJwk = info.publicKeyJwk;
        logOp("auth", "device re-registered", true, { deviceId });
        return existing;
      }
      const d: RegisteredDevice = {
        deviceId,
        deviceName: info.deviceName,
        platform: info.platform,
        pluginVersion: info.pluginVersion,
        publicKeyJwk: info.publicKeyJwk,
        registeredAt: Date.now(),
      };
      registeredDevices.set(deviceId, d);
      logLifecycle("device", "registered", { deviceId, platform: info.platform });
      return d;
    },
  });
  if (!r.success || !r.value) throw r.error!;
  return r.value;
}

export function isDeviceRegistered(deviceId: string): boolean {
  const r = safeCall<boolean>({
    component: "auth",
    code: "EC-AUTH-014",
    message: "isDeviceRegistered failed",
    context: { deviceId },
    op: () => registeredDevices.has(deviceId),
  });
  return r.value ?? false;
}

export function getDevice(deviceId: string): RegisteredDevice | undefined {
  const r = safeCall<RegisteredDevice | undefined>({
    component: "auth",
    code: "EC-AUTH-015",
    message: "getDevice failed",
    context: { deviceId },
    op: () => registeredDevices.get(deviceId),
  });
  return r.value;
}

export function getRegisteredDevices(): RegisteredDevice[] {
  const r = safeCall<RegisteredDevice[]>({
    component: "auth",
    code: "EC-AUTH-016",
    message: "getRegisteredDevices failed",
    op: () => Array.from(registeredDevices.values()).map((d) => ({ ...d })),
  });
  return r.value ?? [];
}

export function blockDevice(deviceId: string, blocked: boolean): void {
  const r = safeCall<void>({
    component: "auth",
    code: "EC-AUTH-017",
    message: "blockDevice failed",
    context: { deviceId, blocked },
    op: () => {
      const d = registeredDevices.get(deviceId);
      if (d) d.blocked = blocked;
      logOp("auth", `device ${blocked ? "blocked" : "unblocked"}`, true, { deviceId });
    },
  });
}

export function updateDeviceToken(deviceId: string, jti: string): void {
  safeCall<void>({
    component: "auth",
    code: "EC-AUTH-018",
    message: "updateDeviceToken failed",
    context: { deviceId, jti: jti.substring(0, 8) + "..." },
    op: () => {
      const d = registeredDevices.get(deviceId);
      if (d) d.lastAccessTokenId = jti;
    },
  });
}

// Devices registry: persistencia en disco (data/devices.json) con info extendida.
// v0.45: error codes estructurados.
// v2.19.0: extended fields (appVersion, osVersion, manufacturer, model,
//   permissions) + persistent JSON store + CRUD endpoints via /api/v1/devices.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { E } from "../utils/errorCodes.js";
import { safeCall } from "../utils/safeCall.js";
import { logOp, logLifecycle } from "../utils/log.js";

/** Granular permissions the device has granted to the app (Android runtime perms). */
export interface DevicePermissions {
  storage?: boolean;        // READ_EXTERNAL_STORAGE / MANAGE_EXTERNAL_STORAGE
  audio?: boolean;           // RECORD_AUDIO
  notifications?: boolean;   // POST_NOTIFICATIONS
  batteryOptimizationIgnored?: boolean; // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS granted
  foregroundService?: boolean;
  exactAlarms?: boolean;     // SCHEDULE_EXACT_ALARM (Android 12+)
  camera?: boolean;
  location?: boolean;
}

export interface RegisteredDevice {
  deviceId: string;
  deviceName?: string;
  platform?: string;          // "android" | "ios" | "web"
  /** M-NEXUS app version, e.g. "2.18.0". */
  appVersion?: string;
  /** OS version reported by the platform (e.g. "Android 14", "API 34"). */
  osVersion?: string;
  /** Device manufacturer (e.g. "Samsung"). */
  manufacturer?: string;
  /** Device model (e.g. "SM-T870"). */
  model?: string;
  /** Capacitor plugin version (e.g. "6.x"). */
  pluginVersion?: string;
  /** User UUID that owns this device (when authenticated). */
  userId?: string;
  /** Granular Android runtime permissions granted to the app. */
  permissions?: DevicePermissions;
  /** Free-form last known settings (backend URL, sync interval, etc.). */
  preferences?: Record<string, unknown>;
  /** Last heartbeat from the device (ms). */
  lastSeenAt?: number;
  /** Si el dispositivo está bloqueado. */
  blocked?: boolean;
  registeredAt: number;
  /** Token de acceso actual (no se persiste el refresh, solo el último access). */
  lastAccessTokenId?: string;
  /** Permite cifrado E2E: clave pública del dispositivo o nada. */
  publicKeyJwk?: JsonWebKey;
}

const inMemory = new Map<string, RegisteredDevice>();
let loadedFromDisk = false;

function dataFile(): string {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");
  return join(dataDir, "devices.json");
}

async function loadFromDisk(): Promise<void> {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  const f = dataFile();
  if (!existsSync(f)) return;
  try {
    const raw = await readFile(f, "utf-8");
    const arr = JSON.parse(raw) as RegisteredDevice[];
    if (!Array.isArray(arr)) return;
    for (const d of arr) {
      if (d && typeof d.deviceId === "string") inMemory.set(d.deviceId, d);
    }
    logOp("auth", "devices loaded from disk", true, { count: arr.length });
  } catch (e) {
    logLifecycle("auth", "devices load failed", { error: String(e) });
  }
}

async function persistToDisk(): Promise<void> {
  const f = dataFile();
  const dir = dirname(f);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const arr = Array.from(inMemory.values());
  await writeFile(f, JSON.stringify(arr, null, 2));
}

export interface DeviceRegistrationInput {
  deviceId: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  osVersion?: string;
  manufacturer?: string;
  model?: string;
  pluginVersion?: string;
  userId?: string;
  permissions?: DevicePermissions;
  preferences?: Record<string, unknown>;
  publicKeyJwk?: JsonWebKey;
}

export async function registerDevice(input: DeviceRegistrationInput): Promise<RegisteredDevice> {
  const r = safeCall<RegisteredDevice>({
    component: "auth",
    code: "EC-AUTH-012",
    message: "registerDevice failed",
    context: { deviceId: input.deviceId, hasName: !!input.deviceName, platform: input.platform },
    op: () => {
      if (!input.deviceId || input.deviceId.length < 3) {
        throw E.val("EC-AUTH-013", "Invalid deviceId", {
          context: { deviceIdLen: input.deviceId?.length ?? 0 },
          hint: "deviceId must be at least 3 characters",
        });
      }
      const existing = inMemory.get(input.deviceId);
      if (existing) {
        if (input.deviceName !== undefined) existing.deviceName = input.deviceName;
        if (input.platform !== undefined) existing.platform = input.platform;
        if (input.appVersion !== undefined) existing.appVersion = input.appVersion;
        if (input.osVersion !== undefined) existing.osVersion = input.osVersion;
        if (input.manufacturer !== undefined) existing.manufacturer = input.manufacturer;
        if (input.model !== undefined) existing.model = input.model;
        if (input.pluginVersion !== undefined) existing.pluginVersion = input.pluginVersion;
        if (input.userId !== undefined) existing.userId = input.userId;
        if (input.permissions !== undefined) existing.permissions = input.permissions;
        if (input.preferences !== undefined) existing.preferences = input.preferences;
        if (input.publicKeyJwk !== undefined) existing.publicKeyJwk = input.publicKeyJwk;
        existing.lastSeenAt = Date.now();
        logOp("auth", "device re-registered", true, { deviceId: input.deviceId });
        return existing;
      }
      const d: RegisteredDevice = {
        deviceId: input.deviceId,
        deviceName: input.deviceName,
        platform: input.platform,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
        manufacturer: input.manufacturer,
        model: input.model,
        pluginVersion: input.pluginVersion,
        userId: input.userId,
        permissions: input.permissions,
        preferences: input.preferences,
        publicKeyJwk: input.publicKeyJwk,
        registeredAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      inMemory.set(input.deviceId, d);
      logLifecycle("device", "registered", { deviceId: input.deviceId, platform: input.platform });
      return d;
    },
  });
  if (!r.success || !r.value) throw r.error!;
  await persistToDisk();
  return r.value;
}

export async function updateDevicePermissions(
  deviceId: string,
  perms: DevicePermissions,
): Promise<RegisteredDevice | null> {
  await loadFromDisk();
  const d = inMemory.get(deviceId);
  if (!d) return null;
  d.permissions = { ...(d.permissions || {}), ...perms };
  d.lastSeenAt = Date.now();
  await persistToDisk();
  logOp("auth", "device permissions updated", true, { deviceId, keys: Object.keys(perms) });
  return d;
}

export async function updateDevicePreferences(
  deviceId: string,
  prefs: Record<string, unknown>,
): Promise<RegisteredDevice | null> {
  await loadFromDisk();
  const d = inMemory.get(deviceId);
  if (!d) return null;
  d.preferences = { ...(d.preferences || {}), ...prefs };
  d.lastSeenAt = Date.now();
  await persistToDisk();
  logOp("auth", "device preferences updated", true, { deviceId, keys: Object.keys(prefs) });
  return d;
}

export function isDeviceRegistered(deviceId: string): boolean {
  return inMemory.has(deviceId);
}

export function getDevice(deviceId: string): RegisteredDevice | undefined {
  return inMemory.get(deviceId);
}

export function getRegisteredDevices(): RegisteredDevice[] {
  return Array.from(inMemory.values());
}

export function getDevicesForUser(userId: string): RegisteredDevice[] {
  return Array.from(inMemory.values()).filter((d) => d.userId === userId);
}

export function blockDevice(deviceId: string, blocked: boolean): void {
  const d = inMemory.get(deviceId);
  if (d) {
    d.blocked = blocked;
    logLifecycle("device", blocked ? "blocked" : "unblocked", { deviceId });
  }
}

// Load on import (deferred, fire-and-forget)
loadFromDisk().catch(() => { /* will be retried on next call */ });

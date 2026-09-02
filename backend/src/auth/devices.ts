// Devices registry: persistencia simple en memoria con info extendida.

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
  const existing = registeredDevices.get(deviceId);
  if (existing) {
    if (info.deviceName) existing.deviceName = info.deviceName;
    if (info.platform) existing.platform = info.platform;
    if (info.pluginVersion) existing.pluginVersion = info.pluginVersion;
    if (info.publicKeyJwk) existing.publicKeyJwk = info.publicKeyJwk;
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
  return d;
}

export function isDeviceRegistered(deviceId: string): boolean {
  return registeredDevices.has(deviceId);
}

export function getDevice(deviceId: string): RegisteredDevice | undefined {
  return registeredDevices.get(deviceId);
}

export function getRegisteredDevices(): RegisteredDevice[] {
  return Array.from(registeredDevices.values()).map((d) => ({ ...d }));
}

export function blockDevice(deviceId: string, blocked: boolean): void {
  const d = registeredDevices.get(deviceId);
  if (d) d.blocked = blocked;
}

export function updateDeviceToken(deviceId: string, jti: string): void {
  const d = registeredDevices.get(deviceId);
  if (d) d.lastAccessTokenId = jti;
}

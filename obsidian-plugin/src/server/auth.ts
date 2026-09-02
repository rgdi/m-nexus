// AuthManager: gestiona el deviceId (UUID persistente) y el authToken.
// Ambos se guardan en localStorage para que sobrevivan a reinicios.

import { Plugin, Platform } from "obsidian";
import { DeviceInfo, RegisterRequest } from "./types";

const DEVICE_ID_KEY = "mnexus.deviceId";
const DEVICE_NAME_KEY = "mnexus.deviceName";
const AUTH_TOKEN_KEY = "mnexus.serverAuthToken";

export class AuthManager {
  constructor(private plugin: Plugin) {}

  /** deviceId estable, generado una sola vez. */
  getDeviceId(): string {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = this.generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  getDeviceName(): string {
    let name = localStorage.getItem(DEVICE_NAME_KEY);
    if (!name) {
      name = this.suggestDeviceName();
      localStorage.setItem(DEVICE_NAME_KEY, name);
    }
    return name;
  }

  setDeviceName(name: string): void {
    localStorage.setItem(DEVICE_NAME_KEY, name);
  }

  getAuthToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  setAuthToken(token: string | null): void {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  clearAuth(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  /** Construye la info del dispositivo para el register. */
  getDeviceInfo(pluginVersion: string): DeviceInfo {
    return {
      deviceId: this.getDeviceId(),
      deviceName: this.getDeviceName(),
      platform: this.detectPlatform(),
      pluginVersion,
      protocolVersion: "1.0.0",
    };
  }

  /** Genera un UUID v4 simple. */
  private generateDeviceId(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private suggestDeviceName(): string {
    const parts: string[] = [];
    try {
      if (Platform.isMacOS) parts.push("Mac");
      else if (Platform.isWin) parts.push("Windows");
      else if (Platform.isLinux) parts.push("Linux");
      else if (Platform.isIosApp) parts.push("iOS");
      else if (Platform.isAndroidApp) parts.push("Android");
      else parts.push("Desktop");
    } catch {
      parts.push("Desktop");
    }
    return `${parts[0]}-${this.getDeviceId().slice(0, 6)}`;
  }

  private detectPlatform(): string {
    try {
      if (Platform.isMacOS) return "macos";
      if (Platform.isWin) return "windows";
      if (Platform.isLinux) return "linux";
      if (Platform.isIosApp) return "ios";
      if (Platform.isAndroidApp) return "android";
    } catch {
      /* fall through */
    }
    return "unknown";
  }

  /** Construye un RegisterRequest. */
  buildRegisterRequest(pluginVersion: string, inviteToken?: string): RegisterRequest {
    return {
      ...this.getDeviceInfo(pluginVersion),
      inviteToken,
    };
  }
}

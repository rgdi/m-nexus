// v0.21: PushBridge — envía notificaciones push al móvil via backend.
//
// El plugin NO puede enviar push directamente (FCM/APNs requiere servidor).
// En su lugar:
//   1. Registra el token del device en el backend.
//   2. Cuando hay una notificación, el plugin la manda al backend.
//   3. El backend la envía via FCM/APNs.
//
// En desarrollo, el backend simula el envío.

import type { NotificationEvent } from "./notificationsV2.js";

export interface PushBridgeOptions {
  backendUrl: string;
  authToken: string;
  deviceId: string;
  platform: "ios" | "android";
  pushToken?: string;
  /** Si false, no envía al backend (modo local). Default true. */
  enabled: boolean;
  /** Categorías de notificaciones que SÍ se envían como push. */
  enabledCategories: Set<string>;
}

export const DEFAULT_ENABLED_CATEGORIES = new Set([
  "exam-approaching",
  "streak-milestone",
  "adherence-drop",
  "plan-requires-rebalance",
  "goal-completed",
  "weekly-review-ready",
]);

export class PushBridge {
  private options: PushBridgeOptions;
  /** Cache de eventos ya enviados (dedup). */
  private sent: Set<string> = new Set();

  constructor(options: PushBridgeOptions) {
    this.options = options;
  }

  setPushToken(token: string): void {
    this.options.pushToken = token;
  }

  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
  }

  /** Registra el token en el backend. */
  async register(): Promise<{ success: boolean; error?: string }> {
    if (!this.options.pushToken) {
      return { success: false, error: "No push token" };
    }
    try {
      const res = await fetch(`${this.options.backendUrl}/push/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.options.authToken}`,
        },
        body: JSON.stringify({
          deviceId: this.options.deviceId,
          token: this.options.pushToken,
          platform: this.options.platform,
        }),
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Envía un evento al backend como push. */
  async send(event: NotificationEvent): Promise<{ success: boolean; error?: string }> {
    if (!this.options.enabled) return { success: false, error: "disabled" };
    if (!this.options.pushToken) return { success: false, error: "no token" };
    if (!this.options.enabledCategories.has(event.type)) return { success: false, error: "category disabled" };
    if (this.sent.has(event.id)) return { success: false, error: "already sent" };
    // Sanitizar meta: solo strings permitidos (el backend espera Record<string, string>)
    const safeMeta = this.sanitizeMeta(event.meta);

    try {
      const res = await fetch(`${this.options.backendUrl}/push/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.options.authToken}`,
        },
        body: JSON.stringify({
          deviceId: this.options.deviceId,
          payload: {
            title: event.title,
            body: event.message,
            category: event.type,
            sound: event.severity === "urgent" ? "alert" : "default",
            force: event.severity === "urgent",
            data: safeMeta,
          },
        }),
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}` };
      }
      this.sent.add(event.id);
      // Cap de cache
      if (this.sent.size > 1000) {
        const arr = Array.from(this.sent);
        this.sent = new Set(arr.slice(-500));
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Convierte cualquier valor en un string (seguro para JSON). */
  private sanitizeMeta(meta: unknown): Record<string, string> | undefined {
    if (!meta || typeof meta !== "object") return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return out;
  }
}

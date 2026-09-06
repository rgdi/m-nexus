// v0.21: Push Notifications Service
//
// Envía notificaciones push reales al móvil via:
//   - FCM (Firebase Cloud Messaging) para Android
//   - APNs (Apple Push Notification service) para iOS
//
// En desarrollo, simula el envío y loggea. En producción, requiere:
//   - FCM service account JSON (env: FCM_SERVICE_ACCOUNT)
//   - APNs key (.p8 file) (env: APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID)

import { logger } from "../utils/log.js";

const log = logger.child ? logger.child({ module: "push-notifications" }) : logger;

export type PushPlatform = "ios" | "android";

export interface PushToken {
  /** ID del device. */
  deviceId: string;
  /** Token del push provider (FCM o APNs). */
  token: string;
  platform: PushPlatform;
  /** User agent / modelo del device. */
  deviceInfo?: string;
  registeredAt: number;
  lastSeenAt: number;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Categoría (e.g., "goal-completed", "exam-approaching"). */
  category?: string;
  /** Badge count (iOS). */
  badge?: number;
  /** Sound: "default" o nombre custom. */
  sound?: string;
  /** Si true, la notificación se muestra aunque la app esté en foreground. */
  force?: boolean;
}

export interface PushResult {
  success: boolean;
  platform: PushPlatform;
  deviceId: string;
  messageId?: string;
  error?: string;
  /** Tokens inválidos (para limpiar). */
  invalidToken?: boolean;
}

/** In-memory store de tokens. En producción: Redis o DB. */
const tokenStore = new Map<string, PushToken>();

/** Registrar un token de device. */
export function registerToken(token: PushToken): void {
  token.token = token.token; // noop
  token.registeredAt = Date.now();
  token.lastSeenAt = Date.now();
  tokenStore.set(token.deviceId, token);
  log.info(`Token registered: ${token.deviceId} (${token.platform})`);
}

/** Listar todos los tokens (admin only). */
export function listTokens(): PushToken[] {
  return Array.from(tokenStore.values());
}

/** Eliminar un token (cuando es inválido). */
export function removeToken(deviceId: string): boolean {
  return tokenStore.delete(deviceId);
}

/**
 * Envía un push a un device específico.
 */
export async function sendPush(
  deviceId: string,
  payload: PushPayload
): Promise<PushResult> {
  const token = tokenStore.get(deviceId);
  if (!token) {
    return { success: false, platform: "ios", deviceId, error: "Token not found" };
  }

  // Actualizar lastSeen
  token.lastSeenAt = Date.now();
  tokenStore.set(deviceId, token);

  if (token.platform === "android") {
    return await sendFCM(token.token, payload, deviceId);
  } else if (token.platform === "ios") {
    return await sendAPNs(token.token, payload, deviceId);
  }

  return { success: false, platform: token.platform, deviceId, error: "Unknown platform" };
}

/**
 * Envía push a todos los devices de un usuario.
 */
export async function broadcastToUser(
  userId: string,
  payload: PushPayload
): Promise<PushResult[]> {
  const tokens = listTokens().filter((t) => t.deviceId.startsWith(userId));
  const results: PushResult[] = [];
  for (const t of tokens) {
    const r = await sendPush(t.deviceId, payload);
    results.push(r);
    // Si el token es inválido, eliminarlo
    if (r.invalidToken) removeToken(t.deviceId);
  }
  return results;
}

/**
 * FCM (Android) — usa Firebase Admin SDK si está disponible.
 * En desarrollo, simula.
 */
async function sendFCM(
  token: string,
  payload: PushPayload,
  deviceId: string
): Promise<PushResult> {
  const fcmServiceAccount = process.env.FCM_SERVICE_ACCOUNT;
  if (!fcmServiceAccount) {
    // Modo desarrollo: simular
    log.info(`[DEV] FCM push to ${deviceId.slice(0, 8)}: ${payload.title} - ${payload.body}`);
    return {
      success: true,
      platform: "android",
      deviceId,
      messageId: `dev-${Date.now()}`,
    };
  }

  // Producción: usar firebase-admin
  try {
    // Lazy require para no cargar firebase en dev
    const admin = await import("firebase-admin");
    const adminApp = (admin as unknown as { default?: unknown }).default ?? admin;
    const adminObj = adminApp as unknown as { apps: unknown[]; initializeApp: (opts: unknown) => unknown; credential: { cert: (sa: unknown) => unknown }; messaging: () => { send: (m: unknown) => Promise<string> } };
    if (!adminObj.apps.length) {
      const serviceAccount = JSON.parse(fcmServiceAccount);
      adminObj.initializeApp({ credential: adminObj.credential.cert(serviceAccount) });
    }
    const messaging = adminObj.messaging();
    const messageId = await messaging.send({
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data,
      android: {
        priority: payload.force ? "high" : "normal",
        notification: {
          sound: payload.sound ?? "default",
          clickAction: payload.category,
        },
      },
    });
    return { success: true, platform: "android", deviceId, messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const isInvalid = error.includes("registration-token-not-registered") ||
                     error.includes("invalid-argument");
    return { success: false, platform: "android", deviceId, error, invalidToken: isInvalid };
  }
}

/**
 * APNs (iOS) — usa node-apn o @parse/node-apn si está disponible.
 * En desarrollo, simula.
 */
async function sendAPNs(
  token: string,
  payload: PushPayload,
  deviceId: string
): Promise<PushResult> {
  const apnsKeyPath = process.env.APNS_KEY_PATH;
  const apnsKeyId = process.env.APNS_KEY_ID;
  const apnsTeamId = process.env.APNS_TEAM_ID;
  if (!apnsKeyPath || !apnsKeyId || !apnsTeamId) {
    // Modo desarrollo: simular
    log.info(`[DEV] APNs push to ${deviceId.slice(0, 8)}: ${payload.title} - ${payload.body}`);
    return {
      success: true,
      platform: "ios",
      deviceId,
      messageId: `dev-${Date.now()}`,
    };
  }

  // Producción: usar node-apn
  try {
    const apn = await import("@parse/node-apn");
    const apnObj = (apn as unknown as { default?: unknown }).default ?? apn;
    const apnModule = apnObj as unknown as {
      Provider: new (opts: unknown) => {
        send: (n: unknown, t: string) => Promise<{ sent: string[]; failed: Array<{ status?: string; response?: { reason?: string } }> }>;
        shutdown: () => Promise<void>;
      };
      Notification: new () => {
        alert: unknown;
        topic: string;
        sound: string;
        badge?: number;
        category?: string;
        payload?: unknown;
      };
    };
    const apnsProvider = new apnModule.Provider({
      token: { key: apnsKeyPath, keyId: apnsKeyId, teamId: apnsTeamId },
      production: process.env.NODE_ENV === "production",
    });
    const note = new apnModule.Notification();
    (note as unknown as { alert: unknown }).alert = { title: payload.title, body: payload.body };
    (note as unknown as { topic: string }).topic = process.env.APNS_BUNDLE_ID ?? "com.mnexus.app";
    (note as unknown as { sound: string }).sound = payload.sound ?? "default";
    (note as unknown as { badge?: number }).badge = payload.badge;
    (note as unknown as { category?: string }).category = payload.category;
    (note as unknown as { payload?: unknown }).payload = payload.data;
    const result = await apnsProvider.send(note, token);
    await apnsProvider.shutdown();
    if (result.sent.length > 0) {
      return { success: true, platform: "ios", deviceId, messageId: result.sent[0] };
    }
    if (result.failed.length > 0) {
      const failure = result.failed[0];
      const isInvalid = failure.status === "410" || failure.response?.reason === "BadDeviceToken";
      return {
        success: false,
        platform: "ios",
        deviceId,
        error: failure.response?.reason ?? "Unknown APNs error",
        invalidToken: isInvalid,
      };
    }
    return { success: false, platform: "ios", deviceId, error: "No result" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, platform: "ios", deviceId, error };
  }
}

/** Stats para admin. */
export function getPushStats(): {
  totalTokens: number;
  iosTokens: number;
  androidTokens: number;
  devMode: boolean;
} {
  const tokens = listTokens();
  return {
    totalTokens: tokens.length,
    iosTokens: tokens.filter((t) => t.platform === "ios").length,
    androidTokens: tokens.filter((t) => t.platform === "android").length,
    devMode: !process.env.FCM_SERVICE_ACCOUNT && !process.env.APNS_KEY_PATH,
  };
}

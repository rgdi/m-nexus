// ConnectionManager: gestiona la conexión con el servidor central.
// - Auto-reconnect con exponential backoff.
// - Heartbeat periódico para detectar caídas.
// - Emite eventos de estado para la UI.
// - Coordina el flush de la cola offline cuando hay conexión.

import { EventEmitter } from "../utils/eventBus";
import { Logger } from "../utils/logger";
import { HTTPClient, NetworkError, ServerError } from "./client";
import { AuthManager } from "./auth";
import { OfflineQueue } from "./offlineQueue";
import { SyncEngine } from "./syncEngine";
import { AuthCredentials, ServerStatus } from "./types";

const HEARTBEAT_INTERVAL_MS = 30_000; // 30s
const HEARTBEAT_TIMEOUT_MS = 10_000;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000; // 5 min
const RECONNECT_MAX_ATTEMPTS = 12; // ~30 min en backoff exponencial

export interface ConnectionEvents {
  status: ServerStatus;
  error: Error;
  synced: void;
}

export class ConnectionManager {
  readonly events = new EventEmitter<ConnectionEvents>();

  private status: ServerStatus = "disconnected";
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private lastSnapshotVersion: number | null = null;
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private userDisconnected = false;

  constructor(
    private serverUrl: string,
    private auth: AuthManager,
    private client: HTTPClient,
    private queue: OfflineQueue,
    private sync: SyncEngine,
    private log: Logger,
    private pluginVersion: string
  ) {
    this.client.setBaseUrl(serverUrl);
    // Escuchar cambios de red del SO
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.handleNetworkChange(true));
      window.addEventListener("offline", () => this.handleNetworkChange(false));
    }
  }

  setServerUrl(url: string) {
    this.serverUrl = url;
    this.client.setBaseUrl(url);
  }

  getStatus(): ServerStatus {
    return this.status;
  }

  getLastSnapshotVersion(): number | null {
    return this.lastSnapshotVersion;
  }

  isUserDisconnected(): boolean {
    return this.userDisconnected;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.userDisconnected = false;
    if (!this.serverUrl) {
      this.setStatus("error");
      this.events.emit("error", new Error("URL del servidor no configurada"));
      return;
    }
    if (!this.isOnline) {
      this.setStatus("offline");
      return;
    }
    this.setStatus("connecting");
    try {
      await this.ensureRegistered();
      await this.startHeartbeat();
      this.setStatus("connected");
      this.reconnectAttempt = 0;
      // Flush de la cola + sync inicial
      await this.syncNow().catch((e) => this.log.warn(`Sync post-connect falló: ${e.message}`));
    } catch (e) {
      this.log.error(`Conexión falló: ${(e as Error).message}`);
      this.setStatus("error");
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.userDisconnected = true;
    this.stopHeartbeat();
    this.clearReconnect();
    this.setStatus("disconnected");
  }

  async syncNow(): Promise<void> {
    const creds = this.getCredentials();
    if (!creds) throw new Error("No hay credenciales");
    if (this.status !== "connected" && this.status !== "offline") {
      this.setStatus("connecting");
    }
    try {
      const report = await this.sync.sync(creds);
      this.lastSnapshotVersion = report.result.newVersion;
      this.events.emit("synced", undefined);
    } catch (e) {
      if (e instanceof NetworkError) {
        this.setStatus("offline");
      } else {
        this.setStatus("error");
        throw e;
      }
    }
  }

  // ─── Registration & Auth ────────────────────────────────────────────

  private async ensureRegistered(): Promise<void> {
    let token = this.auth.getAuthToken();
    if (token) return; // ya registrado
    // Registro inicial
    const req = this.auth.buildRegisterRequest(this.pluginVersion);
    const res = await this.client.register(req);
    this.auth.setAuthToken(res.authToken);
    if (res.snapshot) this.lastSnapshotVersion = res.snapshot.version;
    this.log.info(`Dispositivo registrado en servidor: ${this.auth.getDeviceId().slice(0, 8)}…`);
  }

  private getCredentials(): AuthCredentials | null {
    const token = this.auth.getAuthToken();
    if (!token) return null;
    return {
      deviceId: this.auth.getDeviceId(),
      authToken: token,
      serverUrl: this.serverUrl,
    };
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────

  private async startHeartbeat(): Promise<void> {
    this.stopHeartbeat();
    const tick = async () => {
      if (this.status !== "connected") return;
      const creds = this.getCredentials();
      if (!creds) return;
      try {
        const hb = await this.client.heartbeat(creds);
        if (hb.needsPull) {
          this.log.debug("Servidor indica pull, sincronizando…");
          await this.syncNow().catch(() => {});
        }
        this.lastSnapshotVersion = hb.serverVersion;
      } catch (e) {
        if (e instanceof NetworkError) {
          this.handleNetworkChange(false);
        } else if (e instanceof ServerError && e.statusCode === 401) {
          // Token inválido, re-registrar
          this.log.warn("Token inválido, re-registrando…");
          this.auth.clearAuth();
          await this.ensureRegistered();
        } else {
          this.log.warn(`Heartbeat error: ${(e as Error).message}`);
        }
      }
    };
    this.heartbeatTimer = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    // Ping inicial
    tick().catch(() => {});
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ─── Reconnect con backoff ──────────────────────────────────────────

  private scheduleReconnect() {
    if (this.userDisconnected) return;
    if (this.reconnectAttempt >= RECONNECT_MAX_ATTEMPTS) {
      this.log.error(`Reconnect: máximo de ${RECONNECT_MAX_ATTEMPTS} intentos alcanzado.`);
      this.setStatus("error");
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempt) + Math.random() * 1000,
      RECONNECT_MAX_DELAY_MS
    );
    this.reconnectAttempt++;
    this.log.info(`Reconnect en ${Math.round(delay / 1000)}s (intento ${this.reconnectAttempt})`);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
  }

  // ─── Network state ─────────────────────────────────────────────────

  private handleNetworkChange(online: boolean) {
    this.isOnline = online;
    if (online && this.status === "offline") {
      this.log.info("Red recuperada, intentando reconectar…");
      this.connect().catch(() => {});
    } else if (!online) {
      this.setStatus("offline");
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private setStatus(s: ServerStatus) {
    if (this.status === s) return;
    this.status = s;
    this.events.emit("status", s);
  }

  destroy() {
    this.stopHeartbeat();
    this.clearReconnect();
    this.client.cancel();
  }
}

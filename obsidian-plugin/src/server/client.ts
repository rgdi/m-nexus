// HTTPClient: cliente HTTP con timeout, retry y rate limit.
// Todas las llamadas al servidor pasan por aquí.
//
// v0.28: upload/download de backups en formato binario (application/zip),
//        ~3x más rápido que el JSON+base64 anterior.

import { Logger } from "../utils/logger";
import {
  AuthCredentials,
  BackupListItem,
  BackupUploadRequest,
  BackupUploadResponse,
  HeartbeatResponse,
  RegisterRequest,
  RegisterResponse,
  ServerSnapshot,
  SyncDelta,
  SyncResult,
  ServerError as ServerErrorPayload,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;
const BACKUP_TIMEOUT_MS = 120_000; // 2 min para backups grandes

export class ServerError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = "ServerError";
  }
}

export class NetworkError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "NetworkError";
  }
}

export class HTTPClient {
  private abortController: AbortController | null = null;

  constructor(
    private baseUrl: string,
    private log: Logger
  ) {}

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  cancel() {
    this.abortController?.abort();
  }

  // ─── Endpoints ───────────────────────────────────────────────────────

  async register(req: RegisterRequest): Promise<RegisterResponse> {
    return this.request<RegisterResponse>("/api/v1/register", {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async heartbeat(creds: AuthCredentials): Promise<HeartbeatResponse> {
    return this.request<HeartbeatResponse>("/api/v1/heartbeat", {
      method: "GET",
      auth: creds,
    });
  }

  async getSnapshot(creds: AuthCredentials): Promise<ServerSnapshot> {
    return this.request<ServerSnapshot>("/api/v1/sync/snapshot", {
      method: "GET",
      auth: creds,
    });
  }

  async pushDelta(creds: AuthCredentials, delta: SyncDelta): Promise<SyncResult> {
    return this.request<SyncResult>("/api/v1/sync/diff", {
      method: "POST",
      auth: creds,
      body: JSON.stringify(delta),
    });
  }

  async uploadBackup(creds: AuthCredentials, req: BackupUploadRequest): Promise<BackupUploadResponse> {
    // v0.28: POST como application/zip binario (no JSON+base64).
    // Headers llevan metadata: X-Backup-Metadata: {kind, vaultPath, note, fileCount, sha256}
    const sha = await sha256Hex(req.zipBytes);
    const metadata = {
      kind: req.kind,
      vaultPath: req.vaultPath,
      note: req.note,
      fileCount: req.fileCount,
      sha256: sha,
    };
    return this.request<BackupUploadResponse>("/api/v1/backup/upload", {
      method: "POST",
      auth: creds,
      body: req.zipBytes,
      headers: {
        "Content-Type": "application/zip",
        "X-Backup-Metadata": JSON.stringify(metadata),
      },
      timeoutMs: BACKUP_TIMEOUT_MS,
    });
  }

  async listBackups(creds: AuthCredentials): Promise<BackupListItem[]> {
    return this.request<BackupListItem[]>(
      "/api/v1/backup/list",
      { method: "GET", auth: creds }
    );
  }

  async downloadBackup(creds: AuthCredentials, backupId: string): Promise<Uint8Array> {
    // v0.28: devuelve application/zip binario.
    return this.requestBinary(`/api/v1/backup/download/${encodeURIComponent(backupId)}`, {
      method: "GET",
      auth: creds,
      timeoutMs: BACKUP_TIMEOUT_MS,
    });
  }

  /**
   * v0.28: drag-and-drop import. Sube un .zip que el usuario arrastró al vault.
   * El servidor lo valida, calcula SHA-256 y lo guarda.
   */
  async importBackup(creds: AuthCredentials, zipBytes: Uint8Array, opts: {
    note?: string;
  } = {}): Promise<BackupUploadResponse> {
    const sha = await sha256Hex(zipBytes);
    const metadata = {
      kind: "manual" as const,
      vaultPath: "imported",
      note: opts.note ?? "Importado por drag-and-drop",
      fileCount: 0,
      sha256: sha,
      imported: true,
    };
    return this.request<BackupUploadResponse>("/api/v1/backup/upload", {
      method: "POST",
      auth: creds,
      body: zipBytes,
      headers: {
        "Content-Type": "application/zip",
        "X-Backup-Metadata": JSON.stringify(metadata),
      },
      timeoutMs: BACKUP_TIMEOUT_MS,
    });
  }

  /** v0.28: drag-and-drop export. Devuelve un blob URL del ZIP para descarga. */
  async downloadBackupAsBlobUrl(creds: AuthCredentials, backupId: string): Promise<string> {
    const bytes = await this.downloadBackup(creds, backupId);
    // @ts-ignore — Blob en Electron/Node 18+
    const blob = new Blob([bytes], { type: "application/zip" });
    return URL.createObjectURL(blob);
  }

  // ─── Core ───────────────────────────────────────────────────────────

  async request<T>(
    path: string,
    opts: {
      method: string;
      body?: string | Uint8Array;
      auth?: AuthCredentials;
      headers?: Record<string, string>;
      timeoutMs?: number;
    }
  ): Promise<T> {
    const url = this.buildUrl(path);
    const res = await this.fetchWithRetry(url, opts);
    return res as T;
  }

  private async requestBinary(
    path: string,
    opts: { method: string; auth?: AuthCredentials; headers?: Record<string, string>; timeoutMs?: number }
  ): Promise<Uint8Array> {
    const url = this.buildUrl(path);
    const res = await this.fetchWithRetry(url, { ...opts, responseType: "binary" });
    if (res instanceof Uint8Array) return res;
    if (res instanceof ArrayBuffer) return new Uint8Array(res);
    // Fallback: el servidor devolvió JSON con base64
    if (typeof res === "object" && res && "contentBase64" in res) {
      const b64 = (res as { contentBase64: string }).contentBase64;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
    return new TextEncoder().encode(JSON.stringify(res));
  }

  private async fetchWithRetry(
    url: string,
    opts: {
      method: string;
      body?: string | Uint8Array;
      auth?: AuthCredentials;
      headers?: Record<string, string>;
      timeoutMs?: number;
      responseType?: "json" | "binary";
    }
  ): Promise<unknown> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.fetchOnce(url, opts);
      } catch (e) {
        lastErr = e as Error;
        if (e instanceof ServerError && e.statusCode && e.statusCode < 500 && e.statusCode !== 408) {
          // Errores de cliente (4xx excepto 408) no reintentar
          throw e;
        }
        if (attempt < MAX_RETRY_ATTEMPTS - 1) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200;
          this.log.debug(`HTTP retry ${attempt + 1}/${MAX_RETRY_ATTEMPTS} tras ${Math.round(delay)}ms`);
          await sleep(delay);
        }
      }
    }
    throw lastErr ?? new NetworkError("Request failed");
  }

  private async fetchOnce(
    url: string,
    opts: {
      method: string;
      body?: string | Uint8Array;
      auth?: AuthCredentials;
      headers?: Record<string, string>;
      timeoutMs?: number;
      responseType?: "json" | "binary";
    }
  ): Promise<unknown> {
    this.abortController = new AbortController();
    const headers: Record<string, string> = {
      Accept: opts.responseType === "binary" ? "application/zip, application/octet-stream, */*" : "application/json",
      ...(opts.headers ?? {}),
    };
    if (!headers["Content-Type"] && typeof opts.body === "string") {
      headers["Content-Type"] = "application/json";
    }
    if (opts.auth) {
      headers["X-Device-Id"] = opts.auth.deviceId;
      headers["Authorization"] = `Bearer ${opts.auth.authToken}`;
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => this.abortController?.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body as BodyInit | undefined,
        signal: this.abortController.signal,
      });
      clearTimeout(timer);
      if (res.status === 204) return null;
      if (res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (opts.responseType === "binary") {
          // v0.28: devolver bytes crudos
          const buf = await res.arrayBuffer();
          return new Uint8Array(buf);
        }
        if (ct.includes("application/json")) return res.json();
        if (ct.includes("application/zip") || ct.includes("application/octet-stream")) {
          const buf = await res.arrayBuffer();
          return new Uint8Array(buf);
        }
        return res.text();
      }
      // Error
      let errBody: ServerErrorPayload | null = null;
      try {
        errBody = (await res.json()) as ServerErrorPayload;
      } catch {
        /* no body */
      }
      throw new ServerError(
        errBody?.code ?? `HTTP_${res.status}`,
        errBody?.message ?? `HTTP ${res.status}: ${res.statusText}`,
        res.status,
        errBody?.retryAfter ?? (Number(res.headers.get("Retry-After") ?? 0) || undefined)
      );
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === "AbortError") {
        throw new NetworkError(`Request timeout tras ${timeoutMs}ms`);
      }
      if (e instanceof ServerError || e instanceof NetworkError) throw e;
      throw new NetworkError(`Network error: ${(e as Error).message}`, e);
    } finally {
      this.abortController = null;
    }
  }

  private buildUrl(path: string): string {
    const base = this.baseUrl.replace(/\/+$/, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${base}${p}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** v0.28: SHA-256 hex usando Web Crypto API (disponible en Electron/Obsidian). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // @ts-ignore — subtle puede no estar en tipos pero existe en runtime.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, "0");
  }
  return hex;
}

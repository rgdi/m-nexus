// HTTPClient con auto-refresh de JWT.
// v0.12: - 401 dispara refresh transparente y reintenta UNA vez.
//        - Refresh concurrente se deduplica con mutex simple.

import { Logger } from "../utils/logger.js";

const logger = new Logger("[m-nexus-http]");

export interface FetchInit {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  timeoutMs?: number;
}
import type { TokenStore, StoredTokens } from "./tokenStore.js";

export interface HTTPClientOptions {
  baseUrl: string;
  /** Token legacy de v0.11 (migración). */
  legacyToken?: string;
  deviceId: string;
  store: TokenStore;
  /** Si el device ya se registró alguna vez (no vuelve a llamar a /register). */
  alreadyRegistered?: boolean;
  onTokensChanged?: (tokens: StoredTokens | null) => void;
}

const REFRESH_LOCK_KEY = "m-nexus-refresh-inflight";

export class HTTPClient {
  constructor(private opts: HTTPClientOptions) {}

  private current(): StoredTokens | null {
    return this.opts.store.load();
  }

  /** Llama /register si no hay tokens guardados. */
  async ensureRegistered(): Promise<StoredTokens> {
    let tokens = this.current();
    if (tokens?.accessToken) return tokens;
    // Migración: si hay legacyToken, intenta usarlo como access (v0.11)
    if (this.opts.legacyToken) {
      tokens = {
        deviceId: this.opts.deviceId,
        accessToken: this.opts.legacyToken,
        refreshToken: "",
        accessTokenExpiresAt: 0,
        refreshTokenExpiresAt: 0,
        serverVersion: "legacy",
      };
      this.opts.store.save(tokens);
      return tokens;
    }
    return await this.register();
  }

  private async register(): Promise<StoredTokens> {
    const res = await this.fetch("/api/v1/register", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({
        deviceId: this.opts.deviceId,
        deviceName: typeof navigator !== "undefined" ? navigator.userAgent?.slice(0, 80) : "Obsidian",
        platform: typeof process !== "undefined" && process.platform ? process.platform : "obsidian",
        pluginVersion: "0.12.0",
        protocolVersion: "1.0.0",
      }),
    });
    if (!res.ok) throw new Error(`Register failed: ${res.status}`);
    const data = await res.json() as {
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: number;
      refreshTokenExpiresAt: number;
      serverVersion: string;
    };
    const tokens: StoredTokens = {
      deviceId: this.opts.deviceId,
      ...data,
    };
    this.opts.store.save(tokens);
    this.opts.onTokensChanged?.(tokens);
    return tokens;
  }

  async refresh(): Promise<StoredTokens> {
    const current = this.current();
    if (!current?.refreshToken) {
      // No refresh: volver a registrar
      return await this.register();
    }
    const res = await this.fetch("/api/v1/auth/refresh", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    if (!res.ok) {
      // Refresh inválido → volver a registrar
      this.opts.store.clear();
      return await this.register();
    }
    const data = await res.json() as {
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresAt: number;
      refreshTokenExpiresAt: number;
    };
    const next: StoredTokens = { ...current, ...data };
    this.opts.store.save(next);
    this.opts.onTokensChanged?.(next);
    logger.info("JWT refreshed");
    return next;
  }

  private inflight: Promise<StoredTokens> | null = null;

  private async ensureFreshToken(): Promise<string> {
    const cur = this.current();
    if (!cur?.accessToken) {
      return (await this.ensureRegistered()).accessToken;
    }
    // Si le quedan < 60s, refresca
    if (cur.accessTokenExpiresAt * 1000 - Date.now() < 60_000) {
      if (!this.inflight) {
        this.inflight = this.refresh().finally(() => { this.inflight = null; });
      }
      return (await this.inflight).accessToken;
    }
    return cur.accessToken;
  }

  async fetch(path: string, init: FetchInit = {}): Promise<Response> {
    const doFetch = async (): Promise<Response> => {
      const skipAuth = init.skipAuth === true;
      const token = skipAuth ? null : await this.ensureFreshToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch(`${this.opts.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body,
      });
      return r;
    };

    let res = await doFetch();
    if (res.status === 401 && !init.skipAuth) {
      // 1) Intentar refresh una vez
      const cur = this.current();
      if (cur?.refreshToken) {
        try {
          const newTokens = await this.refresh();
          if (newTokens?.accessToken) {
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${newTokens.accessToken}`,
              ...(init.headers ?? {}),
            };
            res = await fetch(`${this.opts.baseUrl}${path}`, {
              method: init.method ?? "GET",
              headers,
              body: init.body,
            });
          }
        } catch {
          // Continuar al fallback
        }
      }
      // 2) Si sigue 401, forzar re-registro
      if (res.status === 401) {
        this.opts.store.clear();
        const re = await this.register();
        if (re?.accessToken) {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${re.accessToken}`,
            ...(init.headers ?? {}),
          };
          res = await fetch(`${this.opts.baseUrl}${path}`, {
            method: init.method ?? "GET",
            headers,
            body: init.body,
          });
        }
      }
    }
    return res;
  }

  async fetchJSON<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    // v0.28: cast RequestInit → FetchInit (obsidian-specific wrapper).
    const r = await this.fetch(path, init as any);
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
    return await r.json() as T;
  }

  /** Para WebSocket: devuelve el accessToken actual (sin forzar refresh). */
  getAccessToken(): string | null {
    return this.current()?.accessToken ?? null;
  }

  async revoke(): Promise<void> {
    const r = await this.fetch("/api/v1/auth/revoke", { method: "POST" });
    if (r.ok) {
      this.opts.store.clear();
      this.opts.onTokensChanged?.(null);
    }
  }
}

// Google Calendar OAuth 2.0 — usa el flujo de "Installed App" con loopback redirect.
// En el navegador, abrimos la URL de Google, el usuario autoriza, y Google redirige
// a http://localhost:PORT con ?code=XXXX. Capturamos ese code y lo intercambiamos.
//
// Documentación: https://developers.google.com/identity/protocols/oauth2/native-app

import { requestUrl } from "obsidian";
import { GoogleAuthState } from "../types";
import { Logger } from "../utils/logger";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export class GoogleAuth {
  constructor(
    private config: GoogleOAuthConfig,
    private log: Logger
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  /**
   * Inicia el flujo OAuth. Devuelve el state tras autorización.
   * Implementación: usa un redirect a localhost en un puerto efímero.
   * En Obsidian (Electron), podemos abrir una ventana del sistema y escuchar el callback.
   */
  async authorize(): Promise<GoogleAuthState> {
    if (!this.isConfigured()) throw new Error("Google OAuth: falta clientId/clientSecret en Ajustes.");
    const { port, closeFn } = await this.startLocalServer();
    const redirectUri = `http://localhost:${port}`;
    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", this.config.clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    // Abrir navegador del sistema
    window.open(authUrl.toString(), "_blank");

    // Esperar el callback
    const code = await this.waitForCode(port);
    closeFn();

    // Intercambiar code por tokens
    const res = await requestUrl({
      url: TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      throw: false,
    });
    if (res.status !== 200) {
      throw new Error(`Google token exchange: ${res.status} ${res.text}`);
    }
    const json = res.json as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
      id_token?: string;
    };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      scope: json.scope,
    };
  }

  async refresh(state: GoogleAuthState): Promise<GoogleAuthState> {
    if (!state.refreshToken) throw new Error("No hay refresh token; re-autoriza.");
    const res = await requestUrl({
      url: TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: state.refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
      throw: false,
    });
    if (res.status !== 200) {
      throw new Error(`Google refresh: ${res.status} ${res.text}`);
    }
    const json = res.json as { access_token: string; expires_in: number; scope: string };
    return {
      ...state,
      accessToken: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
      scope: json.scope,
    };
  }

  // ─── Helpers: loopback server ─────────────────────────────────────────

  private async startLocalServer(): Promise<{ port: number; closeFn: () => void }> {
    // En un plugin Obsidian de escritorio, podemos usar Node's http.
    // Lo hacemos lazy-require para no romper el bundle.
    const http = (window as unknown as { require?: (m: string) => unknown }).require?.("http") as
      | typeof import("http")
      | undefined;
    if (!http) {
      throw new Error("Loopback server no disponible en este entorno.");
    }
    return new Promise((resolve) => {
      const server = http.createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve({ port, closeFn: () => server.close() });
      });
    });
  }

  private async waitForCode(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const http = (window as unknown as { require?: (m: string) => unknown }).require?.("http") as
        | typeof import("http")
        | undefined;
      if (!http) return reject(new Error("Loopback no disponible"));
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const code = url.searchParams.get("code");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (code) {
          res.end("<h1>¡Autorizado!</h1><p>Puedes cerrar esta ventana.</p>");
          server.close();
          resolve(code);
        } else {
          res.end("<h1>Error</h1><p>No se recibió código.</p>");
        }
      });
      server.listen(port + 1, "127.0.0.1");
    });
  }
}

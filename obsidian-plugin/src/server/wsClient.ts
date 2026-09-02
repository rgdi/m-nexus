// WSClient: cliente WebSocket con permessage-deflate para audios largos.
// v0.13: streaming de audio al backend con compresión.
//
// Uso:
//   const client = new WSClient(baseUrl, getAccessToken, opts);
//   await client.connect();
//   client.sendStart({language, model});
//   for (const chunk of chunks) client.sendAudio(chunk);
//   const final = await client.sendEnd();

import { Logger } from "../utils/logger.js";

const logger = new Logger("[m-nexus-ws]");

export interface WSClientOptions {
  /** Si true, el cliente solicita permessage-deflate. Default true. */
  compression?: boolean;
  /** Timeout en ms para la respuesta final. Default 60s. */
  finalTimeoutMs?: number;
  /** Si true, loggea bytes enviados/recibidos. */
  debug?: boolean;
}

export interface TranscribeStreamCallbacks {
  onPartial?: (text: string) => void;
  onReady?: (info: { compression: boolean }) => void;
  onError?: (err: Error) => void;
}

export class WSClient {
  private ws: WebSocket | null = null;
  private opts: WSClientOptions;
  private readyPromise: Promise<{ compression: boolean }> | null = null;
  private resolveReady: ((v: { compression: boolean }) => void) | null = null;
  private rejectReady: ((e: Error) => void) | null = null;
  private finalPromise: Promise<{
    text: string;
    language?: string;
    durationSec?: number;
    compression: string | null;
    bytesReceived: number;
  }> | null = null;
  private bytesSent = 0;
  private bytesReceived = 0;
  private closed = false;
  public onPartial: ((text: string) => void) | null = null;
  public onError: ((e: Error) => void) | null = null;

  constructor(
    private baseUrl: string,
    private getAccessToken: () => string | null,
    opts: WSClientOptions = {}
  ) {
    this.opts = { compression: true, finalTimeoutMs: 60_000, debug: false, ...opts };
  }

  /** Conecta al endpoint de streaming. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = this.getAccessToken();
      if (!token) {
        reject(new Error("Sin accessToken. Registra el device primero."));
        return;
      }
      const url = `${this.baseUrl.replace(/\/+$/, "")}/api/v1/audio/transcribe/stream?token=${encodeURIComponent(token)}`;

      // Crear el WebSocket. El navegador negocia automáticamente permessage-deflate
      // si el server lo soporta; no requiere flag aquí.
      this.ws = new WebSocket(url);

      this.readyPromise = new Promise<{ compression: boolean }>((res, rej) => {
        this.resolveReady = res;
        this.rejectReady = rej;
      });
      this.finalPromise = new Promise<{
        text: string;
        language?: string;
        durationSec?: number;
        compression: string | null;
        bytesReceived: number;
      }>((res, rej) => {
        (this as { resolveFinal?: typeof res }).resolveFinal = res;
        (this as { rejectFinal?: typeof rej }).rejectFinal = rej;
      });

      this.ws.onopen = () => {
        if (this.opts.debug) logger.info("WS connected");
        resolve();
      };
      this.ws.onerror = () => {
        const err = new Error("WS error");
        this.rejectReady?.(err);
        this.onError?.(err);
        reject(err);
      };
      this.ws.onmessage = (ev) => {
        const data = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
        this.bytesReceived += data.length;
        let msg: { type: string; text?: string; language?: string; durationSec?: number; compression?: string | null; message?: string; bytesReceived?: number };
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }
        if (msg.type === "ready") {
          this.resolveReady?.({ compression: !!msg.compression });
        } else if (msg.type === "partial") {
          this.onPartial?.(msg.text ?? "");
        } else if (msg.type === "final") {
          (this as { resolveFinal?: (v: unknown) => void }).resolveFinal?.({
            text: msg.text ?? "",
            language: msg.language,
            durationSec: msg.durationSec,
            compression: msg.compression ?? null,
            bytesReceived: msg.bytesReceived ?? this.bytesReceived,
          });
        } else if (msg.type === "error") {
          const err = new Error(msg.message ?? "Server error");
          (this as { rejectFinal?: (e: Error) => void }).rejectFinal?.(err);
          this.onError?.(err);
        }
      };
      this.ws.onclose = () => {
        this.closed = true;
        const err = new Error("WS closed before final");
        (this as { rejectFinal?: (e: Error) => void }).rejectFinal?.(err);
      };
    });
  }

  async sendStart(opts: { language?: string; model?: string; mimeType?: string } = {}): Promise<void> {
    if (!this.ws || this.closed) throw new Error("WS no conectado");
    const ready = await (this.readyPromise ?? Promise.resolve({ compression: false }));
    this.send({ type: "start", ...opts });
    return;
  }

  sendAudio(bytes: Uint8Array): void {
    if (!this.ws || this.closed) return;
    // Convertir a base64
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bytes).toString("base64");
    this.bytesSent += bytes.length;
    this.send({ type: "audio", data: b64 });
  }

  async sendEnd(): Promise<{
    text: string;
    language?: string;
    durationSec?: number;
    compression: string | null;
    bytesReceived: number;
    bytesSent: number;
  }> {
    this.send({ type: "end" });
    if (!this.finalPromise) throw new Error("No hay transcribe en curso");
    const final = await this.finalPromise;
    return { ...final, bytesSent: this.bytesSent };
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private send(payload: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

// WebSocket routes: streaming de transcripción en tiempo real.
// v0.12: requiere JWT en query (?token=...) o como header Sec-WebSocket-Protocol.
// v0.13: soporta permessage-deflate (negociado por @fastify/websocket).
//        Métricas: conexiones, bytes recibidos, compresión ahorrada.
// v0.46: rate limit por connection (messages/bytes por ventana) + max concurrent
//        por deviceId. Cierra con code 1008 si se supera. Fix bug auditor #6.

import { FastifyInstance } from "fastify";
import { WhisperService } from "../services/whisper.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { isDeviceRegistered } from "../auth/devices.js";
import { audit } from "../auth/audit.js";
import { getMetrics } from "../utils/metrics.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCallOrNull } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
import {
  createRateLimitTracker,
  checkRateLimit,
  getWSRateLimitConfig,
  ConcurrentConnectionTracker,
  type RateLimitState,
} from "../utils/wsRateLimit.js";

interface ClientMessage {
  type: "start" | "audio" | "end";
  language?: string;
  model?: string;
  data?: string;
  mimeType?: string;
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  const whisper = new WhisperService();
  const rateConfig = getWSRateLimitConfig();
  const concurrentTracker = new ConcurrentConnectionTracker();

  app.get("/api/v1/audio/transcribe/stream", { websocket: true }, async (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token") ?? (req.headers["sec-websocket-protocol"] as string);
    let deviceId: string;
    const authR = await safeCallAsync({
      component: "auth",
      code: "EC-WS-001",
      message: "ws auth failed",
      context: { hasToken: !!token },
      op: async () => {
        const payload = verifyAccessToken(token);
        if (!isDeviceRegistered(payload.sub)) {
          throw E.auth("EC-WS-002", "Device not registered", {
            context: { deviceId: payload.sub },
            hint: "POST /api/v1/register first",
          });
        }
        return payload.sub;
      },
    });
    if (!authR.success || !authR.value) {
      audit({ deviceId: "(unknown)", action: "ws.error", allowed: false, meta: { reason: "auth_failed", code: authR.error?.code } });
      socket.send(JSON.stringify({ type: "error", code: authR.error?.code, message: authR.error?.message ?? "Unauthorized" }));
      socket.close();
      return;
    }
    deviceId = authR.value;

    // v0.46: Check concurrent connection limit per device (DoS protection)
    if (!concurrentTracker.canConnect(deviceId, rateConfig.maxConcurrentPerDevice)) {
      audit({ deviceId, action: "ws.error", allowed: false, meta: { reason: "concurrent_limit", max: rateConfig.maxConcurrentPerDevice } });
      getMetrics().incCounter("mnexus_ws_concurrent_rejected_total", { device: deviceId });
      socket.send(JSON.stringify({
        type: "error",
        code: "EC-WS-003",
        message: `Too many concurrent connections (max ${rateConfig.maxConcurrentPerDevice})`,
      }));
      socket.close(1008, "concurrent_limit");
      return;
    }
    concurrentTracker.increment(deviceId);

    audit({ deviceId, action: "ws.connect", allowed: true });
    getMetrics().incCounter("mnexus_ws_connections_total", { device: deviceId });

    // v0.46: rate limit tracker per-connection
    const rateState: RateLimitState = createRateLimitTracker();

    // Detectar soporte de permessage-deflate (extension header)
    const extensions = req.headers["sec-websocket-extensions"] as string | undefined;
    const supportsDeflate = extensions?.includes("permessage-deflate") ?? false;
    let uncompressedBytes = 0;

    const chunks: Buffer[] = [];
    let config: { language?: string; model?: string; mimeType?: string } = {};

    socket.on("message", async (raw: Buffer) => {
      uncompressedBytes += raw.length;

      // v0.46: rate limit check on every message
      const verdict = checkRateLimit(rateState, raw.length, rateConfig);
      if (!verdict.allowed) {
        getMetrics().incCounter("mnexus_ws_rate_limited_total", { device: deviceId, reason: verdict.reason });
        audit({ deviceId, action: "ws.rate_limited", allowed: false, meta: verdict });
        socket.send(JSON.stringify({
          type: "error",
          code: verdict.reason === "messages" ? "EC-WS-004" : "EC-WS-005",
          message: `Rate limit exceeded: ${verdict.reason} (${verdict.used}/${verdict.limit})`,
          resetMs: verdict.resetMs,
        }));
        socket.close(1008, `rate_limit_${verdict.reason}`);
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }
      if (msg.type === "start") {
        config = { language: msg.language, model: msg.model, mimeType: msg.mimeType };
        socket.send(JSON.stringify({ type: "ready", compression: supportsDeflate }));
        return;
      }
      if (msg.type === "audio") {
        if (msg.data) chunks.push(Buffer.from(msg.data, "base64"));
        if (chunks.length % 4 === 0) {
          const bytesSoFar = chunks.reduce((s, c) => s + c.length, 0);
          socket.send(JSON.stringify({ type: "partial", text: `[streaming... ${chunks.length} chunks, ${bytesSoFar} bytes]` }));
        }
        return;
      }
      if (msg.type === "end") {
        const audio = Buffer.concat(chunks);
        try {
          const result = await whisper.transcribe(audio, config);
          socket.send(JSON.stringify({
            type: "final",
            text: result.text,
            language: result.language,
            durationSec: result.durationSec,
            segments: result.segments,
            compression: supportsDeflate ? "deflate" : null,
            bytesReceived: uncompressedBytes,
          }));
          audit({ deviceId, action: "audio.transcribe", allowed: true, meta: { bytes: audio.length, mode: "stream" } });
        } catch (e) {
          socket.send(JSON.stringify({ type: "error", message: (e as Error).message }));
          audit({ deviceId, action: "audio.transcribe.failed", allowed: false, meta: { error: (e as Error).message } });
        }
        socket.close();
        return;
      }
    });

    socket.on("close", () => {
      concurrentTracker.decrement(deviceId);
      audit({ deviceId, action: "ws.disconnect", allowed: true });
      // Estimación de ahorro: si el cliente envió permessage-deflate,
      // el ahorro típico en JSON es 60-80% para texto repetitivo.
      if (supportsDeflate && uncompressedBytes > 0) {
        const estimatedSaved = Math.floor(uncompressedBytes * 0.7);
        getMetrics().incCounter("mnexus_ws_compressed_bytes_total", { device: deviceId }, estimatedSaved);
      }
      chunks.length = 0;
    });
  });
}

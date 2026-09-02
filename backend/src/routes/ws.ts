// WebSocket routes: streaming de transcripción en tiempo real.
// v0.12: requiere JWT en query (?token=...) o como header Sec-WebSocket-Protocol.
// v0.13: soporta permessage-deflate (negociado por @fastify/websocket).
//        Métricas: conexiones, bytes recibidos, compresión ahorrada.

import { FastifyInstance } from "fastify";
import { WhisperService } from "../services/whisper.js";
import { verifyAccessToken } from "../auth/jwt.js";
import { isDeviceRegistered } from "../auth/devices.js";
import { audit } from "../auth/audit.js";
import { getMetrics } from "../utils/metrics.js";

interface ClientMessage {
  type: "start" | "audio" | "end";
  language?: string;
  model?: string;
  data?: string;
  mimeType?: string;
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  const whisper = new WhisperService();

  app.get("/api/v1/audio/transcribe/stream", { websocket: true }, (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const token = url.searchParams.get("token") ?? (req.headers["sec-websocket-protocol"] as string);
    let deviceId: string;
    try {
      const payload = verifyAccessToken(token);
      if (!isDeviceRegistered(payload.sub)) throw new Error("not registered");
      deviceId = payload.sub;
    } catch {
      audit({ deviceId: "(unknown)", action: "ws.error", allowed: false, meta: { reason: "auth_failed" } });
      socket.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
      socket.close();
      return;
    }
    audit({ deviceId, action: "ws.connect", allowed: true });
    getMetrics().incCounter("mnexus_ws_connections_total", { device: deviceId });

    // Detectar soporte de permessage-deflate (extension header)
    const extensions = req.headers["sec-websocket-extensions"] as string | undefined;
    const supportsDeflate = extensions?.includes("permessage-deflate") ?? false;
    let uncompressedBytes = 0;

    const chunks: Buffer[] = [];
    let config: { language?: string; model?: string; mimeType?: string } = {};

    socket.on("message", async (raw: Buffer) => {
      uncompressedBytes += raw.length;
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

// Servicio Whisper: delega al binario local (faster-whisper o whisper.cpp).
// Si el binario no está disponible, devuelve un error claro para que el
// cliente sepa que tiene que configurar WHISPER_BINARY.
// v0.11: Soporte de MOCK_WHISPER=1 para tests (devuelve audio simulado).

import { spawn } from "node:child_process";
import { config } from "../config.js";
import { logger } from "../utils/log.js";

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export interface WhisperResult {
  text: string;
  language: string;
  durationSec: number;
  segments: WhisperSegment[];
}

export class WhisperService {
  /**
   * Comprueba si el binario está disponible.
   * En modo MOCK (MOCK_WHISPER=1), siempre devuelve true.
   */
  async isAvailable(): Promise<boolean> {
    if (process.env.MOCK_WHISPER === "1") return true;
    try {
      await this.runBinary(["--help"], 5000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Transcribe un buffer de audio.
   * Si MOCK_WHISPER=1, devuelve un resultado simulado (para tests).
   */
  async transcribe(audio: Buffer, opts: { language?: string; model?: string; mimeType?: string }): Promise<WhisperResult> {
    if (process.env.MOCK_WHISPER === "1") {
      return this.mockTranscribe(audio, opts);
    }
    // Guardar a un temp file (Whisper CLI necesita path)
    const tmpPath = `/tmp/mnexus-${Date.now()}.${this.extFromMime(opts.mimeType)}`;
    const { writeFile, unlink } = await import("node:fs/promises");
    await writeFile(tmpPath, audio);
    try {
      const args = [
        tmpPath,
        "--model", opts.model ?? "base",
        "--output-format", "json",
        "--language", opts.language ?? "auto",
      ];
      const stdout = await this.runBinary(args, 600_000); // 10 min max
      const parsed = JSON.parse(stdout) as {
        text: string;
        language: string;
        duration: number;
        segments: { start: number; end: number; text: string }[];
      };
      return {
        text: parsed.text,
        language: parsed.language,
        durationSec: parsed.duration,
        segments: parsed.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })),
      };
    } finally {
      try { await unlink(tmpPath); } catch { /* ignore */ }
    }
  }

  /**
   * Mock para tests y desarrollo sin GPU.
   * Genera una "transcripción" basada en el tamaño del audio.
   */
  private mockTranscribe(audio: Buffer, opts: { language?: string; model?: string }): WhisperResult {
    // "Duración" ficticia: 1s por 16KB
    const durationSec = Math.max(1, audio.length / 16_000);
    const words = ["Esto", "es", "una", "transcripción", "simulada", "para", "tests", "del", "backend", "M-NEXUS"];
    const segmentCount = Math.min(3, Math.max(1, Math.floor(durationSec / 5)));
    const segments: WhisperSegment[] = [];
    const segLen = durationSec / segmentCount;
    for (let i = 0; i < segmentCount; i++) {
      const start = i * segLen;
      const end = (i + 1) * segLen;
      const segWords = words.slice(i * 2, i * 2 + 4).join(" ");
      segments.push({ start, end, text: ` ${segWords} ` });
    }
    return {
      text: segments.map((s) => s.text).join("").trim(),
      language: opts.language ?? "es",
      durationSec,
      segments,
    };
  }

  private runBinary(args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(config.whisperBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => (stdout += d.toString()));
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`Whisper timeout tras ${timeoutMs}ms`));
      }, timeoutMs);
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`Whisper exit ${code}: ${stderr.slice(0, 500)}`));
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        logger.warn({ err }, "Whisper binary not found");
        reject(err);
      });
    });
  }

  private extFromMime(mime?: string): string {
    if (!mime) return "mp3";
    if (mime.includes("mp3") || mime.includes("mpeg")) return "mp3";
    if (mime.includes("wav")) return "wav";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("flac")) return "flac";
    if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
    if (mime.includes("webm")) return "webm";
    return "mp3";
  }
}

// RemoteTranscriber: thin-client que delega TODA la transcripción al backend.
// v0.8: el plugin NO ejecuta Whisper localmente. El binario se carga en el
// vault pero la transcripción ocurre en el servidor.

import { App } from "obsidian";
import { RemoteClient, TranscribeResponse } from "../server/remoteClient";
import { TranscriptResult, TranscriptSegment, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";
import { OfflineQueue } from "../server/offlineQueue";

export class RemoteTranscriber {
  constructor(
    private app: App,
    private settings: MNexusSettings,
    private remote: RemoteClient,
    private queue: OfflineQueue,
    private log: Logger
  ) {}

  /**
   * Decide el path según forceRemote:
   * - forceRemote=true → SOLO remoto (lanza error si no hay backend)
   * - forceRemote=false → respeta settings.whisperBackend
   *
   * Devuelve la transcripción. Si el backend está caído, encola la operación
   * en OfflineQueue para reintento y lanza error claro.
   */
  async transcribe(audioPath: string, opts: { language?: string; prompt?: string } = {}): Promise<TranscriptResult> {
    if (!this.shouldUseRemote()) {
      throw new Error(
        "forceRemote=true en ajustes. El plugin NO ejecuta Whisper localmente. " +
        "Configura backendUrl o desactiva forceRemote para usar Whisper local."
      );
    }
    if (!this.remote.hasBackend()) {
      throw new Error("Backend no configurado. Ve a Ajustes → M-NEXUS → Backend.");
    }
    const binary = await this.readAudioBase64(audioPath);
    const mime = this.detectMime(audioPath);
    try {
      const res = await this.remote.transcribe({
        audioBase64: binary,
        mimeType: mime,
        language: opts.language,
        prompt: opts.prompt,
      });
      this.log.info(`Transcripción remota: ${res.text.length} chars, ${res.durationSec.toFixed(1)}s`);
      return this.toTranscriptResult(res);
    } catch (e) {
      this.log.warn(`Backend caído al transcribir: ${(e as Error).message}. Encolando.`);
      // Si está offline, encolar para reintento
      await this.queue.enqueueFileChange({
        kind: "upsert",
        path: audioPath,
        hash: "transcribe-pending",
        content: JSON.stringify({ audioPath, opts }),
        modifiedAt: new Date().toISOString(),
      });
      throw e;
    }
  }

  shouldUseRemote(): boolean {
    if (this.settings.forceRemote) return true;
    return this.settings.whisperBackend === "remote";
  }

  private async readAudioBase64(audioPath: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(audioPath);
    if (!file) throw new Error(`Audio no encontrado: ${audioPath}`);
    const buf = await this.app.vault.readBinary(file as never);
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  private detectMime(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "mp3";
    const map: Record<string, string> = {
      mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
      ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm",
    };
    return map[ext] ?? "audio/mpeg";
  }

  private toTranscriptResult(res: TranscribeResponse): TranscriptResult {
    const segments: TranscriptSegment[] = res.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));
    return {
      text: res.text,
      language: res.language,
      segments,
    };
  }
}

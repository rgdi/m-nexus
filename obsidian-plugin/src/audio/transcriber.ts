// Wrapper de Whisper. La idea es que el usuario conecte SU backend preferido:
//   - local-script:   script Python propio que invoca whisper / faster-whisper
//   - whisper-cpp:    binario whisper.cpp (línea de comandos)
//   - openai-api:     API de OpenAI (no recomendado, pero soportado)
//   - disabled:       no hace nada
//
// Si el backend es local-script y whisperAutoInstall=true, el script
// se genera automáticamente la primera vez (usando WHISPER_RUNNER_SCRIPT).

import { App, Notice } from "obsidian";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { TranscriptionBackend, MNexusSettings, TranscriptResult, TranscriptSegment } from "../types";
import { Logger } from "../utils/logger";
import { WhisperInstaller, WHISPER_RUNNER_SCRIPT } from "./whisperInstaller";

export class Transcriber {
  constructor(
    private app: App,
    private settings: MNexusSettings,
    private log: Logger,
    private installer: WhisperInstaller
  ) {}

  async transcribe(audioPath: string): Promise<TranscriptResult> {
    const backend = this.settings.transcriptionBackend;
    if (backend === "disabled") {
      throw new Error("Backend de transcripción deshabilitado en ajustes.");
    }
    this.log.info(`Transcribiendo ${path.basename(audioPath)} con backend=${backend}`);
    switch (backend) {
      case "local-script":
        return this.runScript(audioPath);
      case "whisper-cpp":
        return this.runWhisperCpp(audioPath);
      case "openai-api":
        return this.runOpenAi(audioPath);
      default:
        throw new Error(`Backend no soportado: ${backend}`);
    }
  }

  // ─── Local script (recomendado) ──────────────────────────────────────

  private async runScript(audioPath: string): Promise<TranscriptResult> {
    let script = this.settings.whisperScriptPath;
    if (!script || !fs.existsSync(script)) {
      if (this.settings.whisperAutoInstall) {
        script = await this.autoCreateScript();
        this.settings.whisperScriptPath = script;
        // guardar settings
        await (this.app as unknown as { saveSettings: () => Promise<void> }).saveSettings?.();
      } else {
        throw new Error(
          "Ruta del script Whisper no configurada. Ajustes → M-NEXUS → Transcripción, o activa 'Auto-instalar Whisper'."
        );
      }
    }
    // Comprobar que whisper está instalado
    const w = await this.installer.checkWhisper();
    if (!w.installed) {
      throw new Error(
        "faster-whisper no instalado. Ejecuta el comando M-NEXUS → Instalar Whisper local."
      );
    }
    const outDir = path.join(path.dirname(audioPath), "_transcripts");
    await fs.promises.mkdir(outDir, { recursive: true });
    return new Promise<TranscriptResult>((resolve, reject) => {
      const proc = spawn(
        this.installer.pythonPath(),
        [script, audioPath, "--model", this.settings.whisperModel, "--language", this.settings.whisperLanguage, "--out", outDir],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`Script Whisper salió con código ${code}: ${stderr.slice(-1500)}`));
          return;
        }
        const jsonPath = path.join(outDir, path.basename(audioPath) + ".json");
        try {
          const raw = await fs.promises.readFile(jsonPath, "utf8");
          resolve(this.parseWhisperJson(raw));
        } catch (e) {
          reject(new Error(`No se encontró JSON en ${jsonPath}: ${(e as Error).message}`));
        }
      });
    });
  }

  /** Crea el script por defecto en la carpeta del plugin. */
  private async autoCreateScript(): Promise<string> {
    // En el contexto de Obsidian, escribimos dentro del directorio del plugin.
    const adapter = this.app.vault.adapter;
    const baseDir = (this.app as unknown as { plugins: { pluginsFolder: string } }).plugins?.pluginsFolder;
    if (!baseDir) {
      throw new Error("No se pudo determinar la carpeta de plugins.");
    }
    const dir = `${baseDir}/m-nexus`;
    if (!(await adapter.exists(dir))) {
      await adapter.mkdir(dir);
    }
    const scriptPath = `${dir}/whisper_runner.py`;
    if (!(await adapter.exists(scriptPath))) {
      await adapter.write(scriptPath, WHISPER_RUNNER_SCRIPT);
    }
    return scriptPath;
  }

  // ─── whisper.cpp ─────────────────────────────────────────────────────

  private async runWhisperCpp(audioPath: string): Promise<TranscriptResult> {
    const outBase = audioPath + ".transcript";
    const modelFlag = `-m ${this.settings.whisperModel}`;
    return new Promise<TranscriptResult>((resolve, reject) => {
      const proc = spawn(
        "whisper-cli",
        [modelFlag, "-f", audioPath, "-l", this.settings.whisperLanguage, "--output-json", "--output-file", outBase],
        { stdio: ["ignore", "pipe", "pipe"] }
      );
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`whisper.cpp falló (${code}): ${stderr}`));
          return;
        }
        const raw = await fs.promises.readFile(outBase + ".json", "utf8");
        resolve(this.parseWhisperJson(raw));
      });
    });
  }

  // ─── OpenAI API ──────────────────────────────────────────────────────

  private async runOpenAi(audioPath: string): Promise<TranscriptResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      new Notice("Falta OPENAI_API_KEY en el entorno.");
      throw new Error("OPENAI_API_KEY no definida");
    }
    const buffer = await fs.promises.readFile(audioPath);
    const blob = new Blob([new Uint8Array(buffer).buffer as ArrayBuffer]);
    const fd = new FormData();
    fd.append("file", blob, path.basename(audioPath));
    fd.append("model", "whisper-1");
    fd.append("response_format", "verbose_json");
    fd.append("language", this.settings.whisperLanguage);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    if (!res.ok) throw new Error(`OpenAI Whisper ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      text: string;
      language: string;
      segments?: { start: number; end: number; text: string }[];
    };
    return {
      text: json.text,
      language: json.language,
      segments: (json.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text.trim(),
      })),
    };
  }

  // ─── Parser ──────────────────────────────────────────────────────────

  private parseWhisperJson(raw: string): TranscriptResult {
    const j = JSON.parse(raw) as {
      text?: string;
      language?: string;
      segments?: { start: number; end: number; text: string }[];
    };
    return {
      text: j.text ?? "",
      language: j.language,
      segments: (j.segments ?? []).map((s) => ({
        start: s.start,
        end: s.end,
        text: (s.text ?? "").trim(),
      })),
    };
  }
}

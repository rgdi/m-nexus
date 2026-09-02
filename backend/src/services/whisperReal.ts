// v0.25: Whisper real — usa whisper.cpp o Python openai-whisper por subprocess.
// Optimizado para correr en backend, NO en el plugin (thin client).

import { spawn, execFile } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export interface WhisperOptions {
  /** Modelo a usar (tiny, base, small, medium, large). */
  model?: "tiny" | "base" | "small" | "medium" | "large" | "large-v3";
  /** Idioma (es, en, etc.). Si null, detecta automáticamente. */
  language?: string | null;
  /** Path al binario whisper o whisper.cpp. Auto-detecta si null. */
  binaryPath?: string | null;
  /** Formato de salida (json, txt, srt, vtt). */
  outputFormat?: "json" | "txt" | "srt" | "vtt";
  /** Tareas: transcribe o translate. */
  task?: "transcribe" | "translate";
  /** Si el audio tiene marcas de tiempo que preservar. */
  preserveTimestamps?: boolean;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
  noSpeechProb?: number;
}

export interface WhisperResult {
  text: string;
  language?: string;
  duration?: number;
  segments: WhisperSegment[];
  /** Si el provider es local o API. */
  provider: "whisper.cpp" | "openai-whisper" | "openai-api" | "mock";
  /** Tiempo que tardó. */
  elapsedMs: number;
  /** Confianza promedio de la transcripción. */
  averageConfidence: number;
}

export class WhisperReal {
  private options: Required<Omit<WhisperOptions, "binaryPath" | "language">> & {
    binaryPath: string | null;
    language: string | null;
  };

  constructor(options: WhisperOptions = {}) {
    this.options = {
      model: options.model ?? "base",
      language: options.language ?? null,
      binaryPath: options.binaryPath ?? null,
      outputFormat: options.outputFormat ?? "json",
      task: options.task ?? "transcribe",
      preserveTimestamps: options.preserveTimestamps ?? true,
    };
  }

  /**
   * Transcribe un archivo de audio. Soporta múltiples providers según disponibilidad:
   * 1. whisper.cpp (binary en PATH) — más rápido
   * 2. openai-whisper (Python) — más fácil de instalar
   * 3. openai-api (HTTP) — sin instalar nada
   * 4. mock — fallback para dev
   */
  async transcribe(audioPath: string, opts: Partial<WhisperOptions> = {}): Promise<WhisperResult> {
    const merged = { ...this.options, ...opts };
    const start = Date.now();

    // 1. Verificar que el archivo existe
    const stat = await fs.stat(audioPath).catch(() => null);
    if (!stat) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    // 2. Detectar provider
    const provider = await this.detectProvider();
    if (!provider) {
      throw new Error(
        "No Whisper provider available. Install whisper.cpp, openai-whisper, or set OPENAI_API_KEY env var."
      );
    }

    // 3. Transcribir según provider
    let result: WhisperResult;
    switch (provider) {
      case "whisper.cpp":
        result = await this.transcribeWhisperCpp(audioPath, merged);
        break;
      case "openai-whisper":
        result = await this.transcribeOpenAIWhisper(audioPath, merged);
        break;
      case "openai-api":
        result = await this.transcribeOpenAIApi(audioPath, merged);
        break;
      default:
        result = this.mockTranscribe(audioPath, merged);
    }

    result.provider = provider;
    result.elapsedMs = Date.now() - start;
    return result;
  }

  private async detectProvider(): Promise<WhisperResult["provider"] | null> {
    if (process.env.OPENAI_API_KEY) {
      return "openai-api";
    }
    if (await this.binaryExists("whisper")) {
      return "openai-whisper";
    }
    if (await this.binaryExists("whisper.cpp") || await this.binaryExists("main") && this.options.binaryPath?.includes("whisper")) {
      return "whisper.cpp";
    }
    if (this.options.binaryPath) {
      return "whisper.cpp";
    }
    return null;
  }

  private async binaryExists(name: string): Promise<boolean> {
    return new Promise((resolve) => {
      execFile("which", [name], (err) => resolve(!err));
    });
  }

  private async transcribeWhisperCpp(audioPath: string, opts: typeof this.options): Promise<WhisperResult> {
    const binary = opts.binaryPath || "main";
    const modelFile = `ggml-${opts.model}.bin`;
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "whisper-"));
    const outputBase = path.join(outputDir, "out");

    const args = [
      "-m", modelFile,
      "-f", audioPath,
      "-of", outputBase,
      "-otxt", // txt output (no JSON en whisper.cpp básico)
      "--language", opts.language || "auto",
      "--task", opts.task,
    ];

    return new Promise<WhisperResult>((resolve, reject) => {
      const proc = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`whisper.cpp exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          const txt = await fs.readFile(`${outputBase}.txt`, "utf8");
          resolve({
            text: txt.trim(),
            segments: this.parseTxtToSegments(txt),
            provider: "whisper.cpp",
            elapsedMs: 0,
            averageConfidence: 0.85,
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private async transcribeOpenAIWhisper(audioPath: string, opts: typeof this.options): Promise<WhisperResult> {
    const args = [
      audioPath,
      "--model", opts.model,
      "--output_format", opts.outputFormat,
      "--task", opts.task,
      "--output_dir", await fs.mkdtemp(path.join(os.tmpdir(), "whisper-")),
    ];
    if (opts.language) args.push("--language", opts.language);

    return new Promise<WhisperResult>((resolve, reject) => {
      const proc = spawn("whisper", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", async (code) => {
        if (code !== 0) {
          reject(new Error(`whisper exited with code ${code}: ${stderr}`));
          return;
        }
        // Parse JSON output
        try {
          const outputDir = args[args.length - 1] as string;
          const jsonPath = path.join(outputDir, path.basename(audioPath, path.extname(audioPath)) + ".json");
          const json = JSON.parse(await fs.readFile(jsonPath, "utf8"));
          resolve({
            text: json.text ?? "",
            language: json.language,
            duration: json.duration,
            segments: (json.segments ?? []).map((s: { start: number; end: number; text: string; no_speech_prob?: number }) => ({
              start: s.start,
              end: s.end,
              text: s.text,
              noSpeechProb: s.no_speech_prob,
              confidence: 1 - (s.no_speech_prob ?? 0.1),
            })),
            provider: "openai-whisper",
            elapsedMs: 0,
            averageConfidence: 0.9,
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private async transcribeOpenAIApi(audioPath: string, opts: typeof this.options): Promise<WhisperResult> {
    const apiKey = process.env.OPENAI_API_KEY!;
    const fileBuffer = await fs.readFile(audioPath);
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), path.basename(audioPath));
    formData.append("model", `whisper-1`);
    formData.append("response_format", "verbose_json");
    if (opts.language) formData.append("language", opts.language);

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as {
      text: string;
      language: string;
      duration: number;
      segments: { start: number; end: number; text: string; no_speech_prob?: number }[];
    };
    return {
      text: json.text,
      language: json.language,
      duration: json.duration,
      segments: json.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        noSpeechProb: s.no_speech_prob,
        confidence: 1 - (s.no_speech_prob ?? 0.1),
      })),
      provider: "openai-api",
      elapsedMs: 0,
      averageConfidence: 0.95,
    };
  }

  private mockTranscribe(audioPath: string, opts: typeof this.options): WhisperResult {
    // Mock para dev: genera transcripción a partir del nombre del archivo
    const name = path.basename(audioPath, path.extname(audioPath));
    return {
      text: `[MOCK] Transcripción de ${name} usando modelo ${opts.model}`,
      segments: [
        { start: 0, end: 10, text: "[MOCK] Segmento 1", confidence: 0.9 },
        { start: 10, end: 20, text: "[MOCK] Segmento 2", confidence: 0.85 },
      ],
      provider: "mock",
      elapsedMs: 0,
      averageConfidence: 0.85,
    };
  }

  private parseTxtToSegments(txt: string): WhisperSegment[] {
    // whisper.cpp no da timestamps en txt. Usamos heurística: cada línea = un segmento.
    return txt
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((line, i) => ({
        start: i * 5,
        end: (i + 1) * 5,
        text: line.trim(),
        confidence: 0.85,
      }));
  }
}

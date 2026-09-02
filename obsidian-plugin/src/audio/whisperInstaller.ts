// WhisperInstaller: detecta Python/pip, instala faster-whisper, descarga modelos.
// Diseñado para que el usuario haga UNA sola cosa en ajustes:
// pulsar "Instalar Whisper" y listo.
//
// Se ejecuta todo en un subproceso Python para que el bundle del plugin
// no necesite dependencias nativas.

import { requestUrl } from "obsidian";
import { Notice } from "obsidian";
import { InstallProgress, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";

const PYTHON_CHECK_SCRIPT = `import sys; print(sys.version)`;

const INSTALL_SCRIPT = `
import subprocess, sys, os, json
def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)
try:
    import faster_whisper
    print(json.dumps({"ok": True, "already": True}))
except ImportError:
    p = run([sys.executable, "-m", "pip", "install", "--quiet", "faster-whisper", "torch", "torchaudio"])
    if p.returncode != 0:
        print(json.dumps({"ok": False, "error": p.stderr[-2000:]}))
        sys.exit(1)
    try:
        import faster_whisper
        print(json.dumps({"ok": True, "already": False}))
    except ImportError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)
`;

const MODEL_DOWNLOAD_SCRIPT = `
import sys, json
try:
    from huggingface_hub import snapshot_download
except ImportError:
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", "huggingface_hub"], check=True)
    from huggingface_hub import snapshot_download

# Mapear nombres "human-friendly" → repos HF
models = {
    "tiny": "Systran/faster-whisper-tiny",
    "base": "Systran/faster-whisper-base",
    "small": "Systran/faster-whisper-small",
    "medium": "Systran/faster-whisper-medium",
    "large": "Systran/faster-whisper-large-v2",
    "large-v2": "Systran/faster-whisper-large-v2",
    "large-v3": "Systran/faster-whisper-large-v3",
}
name = sys.argv[1] if len(sys.argv) > 1 else "medium"
repo = models.get(name, models["medium"])
print(json.dumps({"downloading": repo}), flush=True)
path = snapshot_download(repo_id=repo)
print(json.dumps({"ok": True, "path": path, "model": name}), flush=True)
`;

export class WhisperInstaller {
  constructor(private settings: MNexusSettings, private log: Logger) {}

  /** Devuelve la ruta del Python a usar. */
  pythonPath(): string {
    return this.settings.whisperPythonPath?.trim() || "python3";
  }

  /** ¿Python está disponible? */
  async checkPython(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const result = await this.runPython(["-c", PYTHON_CHECK_SCRIPT]);
      if (result.code === 0) {
        return { available: true, version: result.stdout.trim() };
      }
      return { available: false, error: result.stderr || "Python no devolvió 0" };
    } catch (e) {
      return { available: false, error: (e as Error).message };
    }
  }

  /** ¿faster-whisper ya está instalado? */
  async checkWhisper(): Promise<{ installed: boolean; error?: string }> {
    try {
      const result = await this.runPython(["-c", "import faster_whisper; print(faster_whisper.__version__ if hasattr(faster_whisper, '__version__') else 'ok')"]);
      if (result.code === 0) {
        return { installed: true };
      }
      return { installed: false };
    } catch (e) {
      return { installed: false, error: (e as Error).message };
    }
  }

  /**
   * Instala faster-whisper + dependencias. Emite progreso vía callback.
   * Devuelve { ok, already?, error? }.
   */
  async installWhisper(
    onProgress?: (p: InstallProgress) => void
  ): Promise<{ ok: boolean; already?: boolean; error?: string }> {
    onProgress?.({ step: "installing-whisper", progress: 0.1, message: "Instalando faster-whisper…", done: false });
    try {
      const result = await this.runPython(["-c", INSTALL_SCRIPT]);
      if (result.code !== 0) {
        const err = result.stderr || "instalación falló";
        onProgress?.({ step: "installing-whisper", progress: 1, message: "Error", done: true, error: err });
        return { ok: false, error: err };
      }
      const json = this.parseLastJson(result.stdout) ?? {};
      onProgress?.({ step: "installing-whisper", progress: 1, message: "Whisper listo", done: true });
      return { ok: true, already: Boolean(json.already) };
    } catch (e) {
      onProgress?.({ step: "installing-whisper", progress: 1, message: "Error", done: true, error: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
  }

  /**
   * Descarga un modelo (tiny/base/small/medium/large-v3).
   */
  async downloadModel(
    modelName: string,
    onProgress?: (p: InstallProgress) => void
  ): Promise<{ ok: boolean; path?: string; error?: string }> {
    onProgress?.({ step: "downloading-model", progress: 0.1, message: `Descargando ${modelName}…`, done: false });
    try {
      const result = await this.runPython(["-c", MODEL_DOWNLOAD_SCRIPT, modelName], { timeoutMs: 60 * 60 * 1000 });
      if (result.code !== 0) {
        const err = result.stderr || "descarga falló";
        onProgress?.({ step: "downloading-model", progress: 1, message: "Error", done: true, error: err });
        return { ok: false, error: err };
      }
      const json = this.parseLastJson(result.stdout) ?? {};
      onProgress?.({ step: "downloading-model", progress: 1, message: `Modelo ${modelName} descargado`, done: true });
      return { ok: true, path: typeof json.path === "string" ? json.path : undefined };
    } catch (e) {
      onProgress?.({ step: "downloading-model", progress: 1, message: "Error", done: true, error: (e as Error).message });
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Helper: instalar + descargar modelo en una sola llamada. */
  async installAll(
    modelName: string,
    onProgress?: (p: InstallProgress) => void
  ): Promise<{ ok: boolean; error?: string }> {
    const py = await this.checkPython();
    if (!py.available) {
      onProgress?.({ step: "check-python", progress: 1, message: "Python no encontrado", done: true, error: py.error });
      new Notice("M-NEXUS: Python no encontrado. Instálalo o configura la ruta en Ajustes.");
      return { ok: false, error: py.error };
    }
    const w = await this.checkWhisper();
    if (!w.installed) {
      const r = await this.installWhisper(onProgress);
      if (!r.ok) return { ok: false, error: r.error };
    } else {
      onProgress?.({ step: "installing-whisper", progress: 1, message: "Whisper ya instalado", done: true });
    }
    const m = await this.downloadModel(modelName, onProgress);
    if (!m.ok) return { ok: false, error: m.error };
    return { ok: true };
  }

  // ─── Internals ────────────────────────────────────────────────────────

  /** Ejecuta un script Python vía Obsidian's child_process. */
  private async runPython(
    args: string[],
    options: { timeoutMs?: number } = {}
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    // En el entorno de Obsidian, no tenemos child_process directamente en sandbox.
    // Pero para escritorio (isDesktopOnly: true) podemos usar Node's child_process.
    const { spawn } = require("child_process") as typeof import("child_process");
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = options.timeoutMs
        ? setTimeout(() => {
            proc.kill();
            reject(new Error(`Timeout (${options.timeoutMs}ms)`));
          }, options.timeoutMs)
        : null;
      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("error", (e) => {
        if (timer) clearTimeout(timer);
        reject(e);
      });
      proc.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code: code ?? 0, stdout, stderr });
      });
    });
  }

  private parseLastJson(text: string): Record<string, unknown> | null {
    const lines = text.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        /* sigue */
      }
    }
    return null;
  }
}

/** Script de transcripción que M-NEXUS usa por defecto. Se crea en disco
 *  la primera vez (o se descarga desde el repo del plugin). */
export const WHISPER_RUNNER_SCRIPT = `#!/usr/bin/env python3
"""
M-NEXUS Whisper runner — invocado por el plugin Obsidian.
Uso: python3 whisper_runner.py <audio_path> --model <model> --language <lang> --out <out_dir>
Devuelve: archivo JSON con {text, segments, language} en <out_dir>/<basename>.json
"""
import argparse, json, os, sys

def main():
    p = argparse.ArgumentParser()
    p.add_argument("audio")
    p.add_argument("--model", default="medium")
    p.add_argument("--language", default="es")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    os.makedirs(args.out, exist_ok=True)

    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="auto", compute_type="auto")
    segments, info = model.transcribe(
        args.audio,
        language=args.language,
        vad_filter=True,
        beam_size=5,
    )
    out_segments = []
    full_text_parts = []
    for s in segments:
        out_segments.append({"start": float(s.start), "end": float(s.end), "text": s.text.strip()})
        full_text_parts.append(s.text.strip())

    result = {
        "text": " ".join(full_text_parts),
        "language": info.language,
        "segments": out_segments,
    }
    base = os.path.splitext(os.path.basename(args.audio))[0]
    out_path = os.path.join(args.out, base + ".json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(json.dumps({"ok": True, "path": out_path}))

if __name__ == "__main__":
    main()
`;

// Tesseract-based HTR: renderiza los trazos a PNG de alta resolución
// y los envía a Tesseract. Funciona localmente, gratis.
// Calidad: razonable para handwriting limpio, no apto para escritura muy
// cursiva o tachones. Es el "fallback" universal.

import { HTRProvider, HTRResult, HTROptions, renderStrokesToPng, svgToPngBlob } from "./provider";
import { PressureStroke } from "../types";
import { Logger } from "../utils/logger";

export class RenderedOcrProvider implements HTRProvider {
  readonly id = "rendered-ocr";
  readonly name = "OCR renderizado (Tesseract local)";

  constructor(
    private getScriptPath: () => string,
    private log: Logger
  ) {}

  isConfigured(): boolean {
    return Boolean(this.getScriptPath());
  }

  async recognize(strokes: PressureStroke[], options: HTROptions = {}): Promise<HTRResult> {
    const t0 = Date.now();
    const script = this.getScriptPath();
    if (!script) throw new Error("Script OCR no configurado. Ajustes → M-NEXUS → OCR → Script path.");

    if (strokes.length === 0) {
      return { text: "", confidence: 0, language: options.language ?? "es", lines: [], durationMs: 0 };
    }

    // 1) Renderizar trazos a PNG
    const svgUrl = renderStrokesToPng(strokes, { width: 800, height: 400, scale: 2 });
    const blob = await svgToPngBlob(svgUrl, 1);
    const buffer = await blob.arrayBuffer();

    // 2) Guardar a archivo temporal
    const tmpPath = `/tmp/mnexus-htr-${Date.now()}.png`;
    await require("fs").promises.writeFile(tmpPath, Buffer.from(buffer));

    // 3) Ejecutar script Python
    const { spawn } = require("child_process") as typeof import("child_process");
    return new Promise<HTRResult>((resolve, reject) => {
      const proc = spawn("python3", [script, tmpPath, options.language ?? "spa"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      proc.on("error", reject);
      proc.on("close", async (code) => {
        // Limpiar tmp
        await require("fs").promises.unlink(tmpPath).catch(() => {});
        if (code !== 0) {
          reject(new Error(`OCR script exit ${code}: ${stderr.slice(-500)}`));
          return;
        }
        try {
          const json = JSON.parse(stdout) as { text: string; confidence?: number; language?: string };
          const lines = json.text.split(/\r?\n/).filter((l) => l.trim());
          resolve({
            text: json.text.trim(),
            confidence: json.confidence ?? 0.7,
            language: json.language ?? options.language ?? "es",
            lines,
            durationMs: Date.now() - t0,
          });
        } catch (e) {
          reject(new Error("OCR output no es JSON: " + stdout.slice(0, 200)));
        }
      });
    });
  }
}

/** Script Python por defecto. Lo crea el plugin si no existe. */
export const OCR_RUNNER_SCRIPT = `#!/usr/bin/env python3
"""
M-NEXUS OCR runner — handwriting-to-text via Tesseract.
Uso: python3 ocr_runner.py <image_path> <lang>
Devuelve JSON: {text, confidence, language}
"""
import sys, json
try:
    import pytesseract
    from PIL import Image
except ImportError:
    print(json.dumps({"error": "Falta instalar pytesseract+Pillow. Ejecuta: pip install pytesseract pillow"}))
    sys.exit(1)

img_path = sys.argv[1]
lang = sys.argv[2] if len(sys.argv) > 2 else "spa"
img = Image.open(img_path)
# Pre-procesar: grayscale, threshold alto para handwriting
img = img.convert("L").point(lambda p: 0 if p < 128 else 255)
text = pytesseract.image_to_string(img, lang=lang, config="--psm 6")
print(json.dumps({"text": text, "language": lang, "confidence": 0.7}))
`;

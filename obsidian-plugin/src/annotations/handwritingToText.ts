// v0.27: Handwriting-to-Text (HTR) — convierte los trazos a texto usando el backend.
// Usa DeepSeek-OCR self-hosted (que es VLM) para reconocer la escritura a mano.

import type { SpatialAnnotation } from "./noteAnnotations";

export interface HTRRequest {
  /** Trazos a reconocer. */
  strokes: Array<{ points: Array<{ x: number; y: number; pressure?: number }>; color: string; strokeWidth: number }>;
  /** Idioma esperado. */
  language?: string;
  /** Notas o contexto adicional. */
  context?: string;
}

export interface HTRResult {
  text: string;
  confidence: number;
  /** Tiempo de procesamiento. */
  elapsedMs: number;
  /** Provider usado. */
  provider: "deepseek-ocr" | "tesseract" | "mock";
}

export class HandwritingRecognizer {
  private backendUrl: string;
  private authToken: string;

  constructor(backendUrl: string, authToken: string) {
    this.backendUrl = backendUrl;
    this.authToken = authToken;
  }

  /**
   * Renderiza los trazos como imagen SVG → base64 → backend.
   * El backend usa DeepSeek-OCR self-hosted.
   */
  async recognize(annotations: SpatialAnnotation[]): Promise<HTRResult> {
    if (annotations.length === 0) {
      return { text: "", confidence: 0, elapsedMs: 0, provider: "mock" };
    }
    const start = Date.now();

    // 1) Crear SVG con todos los trazos
    const svg = this.renderToSvg(annotations);
    const svgBase64 = Buffer.from(svg).toString("base64");

    // 2) Llamar al backend
    try {
      const res = await fetch(`${this.backendUrl}/ocr/handwriting`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          image: `data:image/svg+xml;base64,${svgBase64}`,
          language: "es",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTR backend error: ${res.status}`);
      const json = (await res.json()) as { text: string; confidence: number; provider: string };
      return {
        text: json.text,
        confidence: json.confidence,
        elapsedMs: Date.now() - start,
        provider: json.provider as HTRResult["provider"],
      };
    } catch (e) {
      // Fallback: intentar DeepSeek-OCR vLLM directamente
      return await this.recognizeDirectDeepSeek(svgBase64, start);
    }
  }

  private async recognizeDirectDeepSeek(svgBase64: string, start: number): Promise<HTRResult> {
    const vllmUrl = (typeof process !== "undefined" && process.env?.DEEPSEEK_VLLM_URL) || "http://localhost:8000";
    try {
      const res = await fetch(`${vllmUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-ai/DeepSeek-OCR",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "<image>\nFree OCR. Recognize the handwriting in this image and return only the text." },
                { type: "image_url", image_url: { url: `data:image/svg+xml;base64,${svgBase64}` } },
              ],
            },
          ],
          max_tokens: 1024,
          temperature: 0.0,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error("DeepSeek not available");
      const json = (await res.json()) as { choices: { message: { content: string } }[] };
      const text = json.choices[0]?.message?.content ?? "";
      return { text, confidence: 0.9, elapsedMs: Date.now() - start, provider: "deepseek-ocr" };
    } catch {
      // Mock fallback
      return {
        text: "[HTR no disponible — el backend o DeepSeek-OCR no están configurados]",
        confidence: 0,
        elapsedMs: Date.now() - start,
        provider: "mock",
      };
    }
  }

  /**
   * Renderiza las anotaciones freehand como SVG.
   */
  renderToSvg(annotations: SpatialAnnotation[]): string {
    // Calcular bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ann of annotations) {
      if (ann.type === "freehand" && ann.points) {
        for (const p of ann.points) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
    }
    if (!isFinite(minX)) {
      minX = 0; minY = 0; maxX = 100; maxY = 100;
    }
    const padding = 20;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX - padding} ${minY - padding} ${width} ${height}">`;
    svg += `<rect x="${minX - padding}" y="${minY - padding}" width="${width}" height="${height}" fill="white" />`;
    for (const ann of annotations) {
      if (ann.type === "freehand" && ann.points && ann.points.length > 1) {
        const path = ann.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ");
        svg += `<path d="${path}" stroke="${ann.style.color}" stroke-width="${ann.style.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`;
      }
    }
    svg += `</svg>`;
    return svg;
  }
}

// HTR (Handwriting Text Recognition) — interface y providers.
//
// Estrategia: renderizar los trazos SVG a una imagen bitmap y enviar a un
// backend de reconocimiento. Soportamos:
//   - Tesseract (gratis, local, ok para handwriting limpio)
//   - MyScript Cloud (de pago, mejor precisión, 2000 requests/mes gratis)
//   - Local TrOCR (vía script Python propio, 100% local, requiere GPU)
//
// El SVG del dibujo se convierte a PNG a alta resolución (300 DPI) y se
// procesa por el backend elegido.

import { App, requestUrl } from "obsidian";
import { PressureStroke, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";

export interface HTRResult {
  text: string;
  confidence: number; // 0-1
  language: string;
  /** Líneas separadas (útil para mostrar antes de aceptar). */
  lines: string[];
  /** Tiempo en ms. */
  durationMs: number;
}

export interface HTRProvider {
  readonly id: string;
  readonly name: string;
  isConfigured(): boolean;
  /** Reconoce trazos a texto. */
  recognize(strokes: PressureStroke[], options?: HTROptions): Promise<HTRResult>;
}

export interface HTROptions {
  language?: string; // "es", "en", etc.
}

// ─── Helper: render SVG strokes to PNG dataURL ────────────────────────

export function renderStrokesToPng(
  strokes: PressureStroke[],
  options: { width: number; height: number; padding?: number; scale?: number } = { width: 800, height: 400 }
): string {
  const padding = options.padding ?? 20;
  const scale = options.scale ?? 2; // 2x para mejor OCR
  const w = options.width;
  const h = options.height;

  // Calcular bounding box de los trazos
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) {
    minX = 0; minY = 0; maxX = w; maxY = h;
  }
  const contentW = maxX - minX + padding * 2;
  const contentH = maxY - minY + padding * 2;

  // Generar SVG inline
  const pathData: string[] = [];
  for (const s of strokes) {
    if (s.points.length < 2) continue;
    const d = s.points.reduce(
      (acc, p, i) => acc + (i === 0 ? `M ${(p.x - minX + padding).toFixed(1)} ${(p.y - minY + padding).toFixed(1)}` : ` L ${(p.x - minX + padding).toFixed(1)} ${(p.y - minY + padding).toFixed(1)}`),
      ""
    );
    pathData.push(`<path d="${d}" stroke="${s.stroke}" stroke-width="${s.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${contentW} ${contentH}" width="${contentW * scale}" height="${contentH * scale}">
    <rect width="100%" height="100%" fill="white"/>
    ${pathData.join("\n")}
  </svg>`;

  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

/** Convierte SVG a PNG usando Canvas (en el navegador). */
export async function svgToPngBlob(svgDataUrl: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob falló"));
      }, "image/png");
    };
    img.onerror = () => reject(new Error("No se pudo cargar el SVG"));
    img.src = svgDataUrl;
  });
}

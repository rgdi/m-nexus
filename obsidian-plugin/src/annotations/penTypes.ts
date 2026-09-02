// v0.27: Sistema de bolígrafos tipo S Pen con múltiples tipos.
// Tipos: pen, pencil, highlighter, calligraphy, brush, marker, fountain.
// Cada tipo tiene presión, grosor, textura y comportamiento distintos.

export type PenType = "pen" | "pencil" | "highlighter" | "calligraphy" | "brush" | "marker" | "fountain" | "eraser";

export interface PenConfig {
  type: PenType;
  color: string;
  /** Grosor base en px. */
  baseSize: number;
  /** Variación por presión (0..1). */
  pressureMultiplier: number;
  /** Si tiene textura (lápiz, pincel). */
  textured: boolean;
  /** Opacidad base. */
  opacity: number;
  /** Si mezcla con lo de abajo (highlighter, marker). */
  blendMode: "source-over" | "multiply" | "screen" | "overlay";
  /** Para highlighter: es translúcido ancho. */
  isWide: boolean;
}

export const PEN_PRESETS: Record<PenType, Omit<PenConfig, "color">> = {
  pen: { type: "pen", baseSize: 2, pressureMultiplier: 0.5, textured: false, opacity: 1, blendMode: "source-over", isWide: false },
  pencil: { type: "pencil", baseSize: 1.5, pressureMultiplier: 1, textured: true, opacity: 0.8, blendMode: "source-over", isWide: false },
  highlighter: { type: "highlighter", baseSize: 18, pressureMultiplier: 0, textured: false, opacity: 0.4, blendMode: "multiply", isWide: true },
  calligraphy: { type: "calligraphy", baseSize: 4, pressureMultiplier: 0, textured: false, opacity: 1, blendMode: "source-over", isWide: false },
  brush: { type: "brush", baseSize: 6, pressureMultiplier: 1, textured: true, opacity: 0.9, blendMode: "source-over", isWide: false },
  marker: { type: "marker", baseSize: 8, pressureMultiplier: 0.2, textured: false, opacity: 0.85, blendMode: "source-over", isWide: false },
  fountain: { type: "fountain", baseSize: 2, pressureMultiplier: 0.8, textured: false, opacity: 1, blendMode: "source-over", isWide: false },
  eraser: { type: "eraser", baseSize: 12, pressureMultiplier: 0, textured: false, opacity: 1, blendMode: "source-over", isWide: false },
};

/** Calcula el grosor efectivo del trazo en función de la presión. */
export function strokeWidth(config: PenConfig, pressure: number): number {
  return config.baseSize * (1 + (pressure - 0.5) * config.pressureMultiplier);
}

/** Genera un path SVG con stroke-width variable por segmento. */
export function renderVariableStrokePath(
  points: Array<{ x: number; y: number; pressure?: number }>,
  config: PenConfig,
): string {
  if (points.length < 2) return "";
  const segments: string[] = [];
  // Simplificar: si más de 50 puntos, samplear
  const sampled = points.length > 50 ? samplePoints(points, 50) : points;
  for (let i = 0; i < sampled.length - 1; i++) {
    const p1 = sampled[i];
    const p2 = sampled[i + 1];
    const width = strokeWidth(config, p1.pressure ?? 0.5);
    // Línea individual con grosor
    segments.push(`<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${config.color}" stroke-width="${width}" stroke-linecap="round" opacity="${config.opacity}" />`);
  }
  return segments.join("");
}

function samplePoints<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(points[Math.floor(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

// ─── Shape recognition ────────────────────────────────────

/** Tipos de formas reconocidas. */
export type ShapeType = "line" | "rectangle" | "circle" | "triangle" | "arrow" | "polygon" | "none";

export interface RecognizedShape {
  type: ShapeType;
  /** Puntos corregidos. */
  correctedPoints: Array<{ x: number; y: number }>;
  /** Confianza 0..1. */
  confidence: number;
}

/**
 * Detecta y corrige la forma hecha a mano alzada.
 * Algoritmo:
 * 1. Calcular bounding box
 * 2. Calcular "rectangularidad" — qué tan cerca está de un rectángulo
 * 3. Calcular "circularidad" — qué tan cerca está de un círculo
 * 4. Calcular "linealidad" — qué tan cerca está de una línea recta
 * 5. Elegir la mejor
 */
export function recognizeShape(points: Array<{ x: number; y: number }>): RecognizedShape {
  if (points.length < 3) {
    return { type: "none", correctedPoints: points, confidence: 0 };
  }
  const bbox = boundingBox(points);
  const width = bbox.maxX - bbox.minX;
  const height = bbox.maxY - bbox.minY;
  const area = width * height;
  if (area === 0) {
    return { type: "none", correctedPoints: points, confidence: 0 };
  }

  // Si el path es muy "lineal" (muchos puntos en una línea), es una línea
  // Si los puntos cubren las 4 esquinas del bbox, es un rectángulo
  // Si están todos aproximadamente equidistantes de un centro, es un círculo
  const rectFit = rectangleFitError(points, bbox);
  const rectangularity = 1 - rectFit / Math.max(1, Math.min(width, height));

  const circFit = circleFitError(points);
  const circularity = 1 - circFit / Math.max(width, height);

  // Linealidad: ratio de puntos que están cerca de la línea principal
  const lineFit = lineFitError(points);
  const linearity = 1 - lineFit / Math.max(width, height);

  // Penalizar la linealidad cuando hay muchos puntos Y ocupa las 4 esquinas
  // (esto distingue una línea de un rectángulo)
  const cornersCovered = countCornersCovered(points, bbox);
  const linearityScore = (linearity * (1 - cornersCovered * 0.3));

  const candidates: Array<{ type: ShapeType; score: number; corrected: Array<{ x: number; y: number }> }> = [
    { type: "line", score: linearityScore, corrected: shapeToLine(bbox) },
    { type: "rectangle", score: rectangularity, corrected: shapeToRectangle(bbox) },
    { type: "circle", score: circularity, corrected: shapeToCircle(bbox) },
  ];

  if (points.length >= 6) {
    const triScore = triangleFitError(points);
    candidates.push({ type: "triangle", score: 1 - triScore / Math.max(width, height), corrected: shapeToTriangle(bbox) });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score > 0.7) {
    return { type: best.type, correctedPoints: best.corrected, confidence: best.score };
  }
  return { type: "none", correctedPoints: points, confidence: 0 };
}

function boundingBox(points: Array<{ x: number; y: number }>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Cuenta cuántas esquinas del bbox tienen un punto cercano. 0..1. */
function countCornersCovered(points: Array<{ x: number; y: number }>, bbox: { minX: number; minY: number; maxX: number; maxY: number }): number {
  const corners = [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
  ];
  const threshold = Math.hypot(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY) * 0.15;
  let count = 0;
  for (const c of corners) {
    for (const p of points) {
      if (Math.hypot(p.x - c.x, p.y - c.y) < threshold) {
        count++;
        break;
      }
    }
  }
  return count / 4;
}

function lineFitError(points: Array<{ x: number; y: number }>): number {
  if (points.length < 2) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  // Distancia perpendicular de cada punto a la línea first→last
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  let total = 0;
  for (const p of points) {
    const dist = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / len;
    total += dist;
  }
  return total / points.length;
}

function rectangleFitError(points: Array<{ x: number; y: number }>, bbox: { minX: number; minY: number; maxX: number; maxY: number }): number {
  // Suma de distancias a las 4 aristas
  let total = 0;
  for (const p of points) {
    const d1 = p.x - bbox.minX;
    const d2 = bbox.maxX - p.x;
    const d3 = p.y - bbox.minY;
    const d4 = bbox.maxY - p.y;
    const d = Math.min(d1, d2, d3, d4);
    total += d * d;
  }
  return Math.sqrt(total / points.length);
}

function circleFitError(points: Array<{ x: number; y: number }>): number {
  if (points.length < 3) return 0;
  // Centro medio
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;
  // Radio medio
  let r = 0;
  for (const p of points) r += Math.hypot(p.x - cx, p.y - cy);
  r /= points.length;
  // Varianza de radios
  let variance = 0;
  for (const p of points) {
    const d = Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
    variance += d * d;
  }
  return Math.sqrt(variance / points.length);
}

function triangleFitError(points: Array<{ x: number; y: number }>): number {
  // Simplificado: asume 3 vértices en los puntos más alejados del centro
  if (points.length < 3) return 0;
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;
  // 3 puntos más alejados del centro
  const sorted = [...points].sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy));
  return Math.hypot(sorted[0].x - cx, sorted[0].y - cy) / 3;
}

function shapeToLine(bbox: { minX: number; minY: number; maxX: number; maxY: number }): Array<{ x: number; y: number }> {
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
  ];
}

function shapeToRectangle(bbox: { minX: number; minY: number; maxX: number; maxY: number }): Array<{ x: number; y: number }> {
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.minY },
  ];
}

function shapeToCircle(bbox: { minX: number; minY: number; maxX: number; maxY: number }): Array<{ x: number; y: number }> {
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const rx = (bbox.maxX - bbox.minX) / 2;
  const ry = (bbox.maxY - bbox.minY) / 2;
  const points: Array<{ x: number; y: number }> = [];
  for (let a = 0; a <= 2 * Math.PI; a += Math.PI / 12) {
    points.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return points;
}

function shapeToTriangle(bbox: { minX: number; minY: number; maxX: number; maxY: number }): Array<{ x: number; y: number }> {
  const cx = (bbox.minX + bbox.maxX) / 2;
  return [
    { x: cx, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY },
    { x: cx, y: bbox.minY },
  ];
}

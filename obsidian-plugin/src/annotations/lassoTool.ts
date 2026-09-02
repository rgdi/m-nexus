// v0.27: Lasso tool + Eraser modes tipo Samsung Notes.

import type { Annotation, SpatialAnnotation, TextRangeAnnotation } from "./noteAnnotations";

/** Modos del borrador Samsung Notes. */
export type EraserMode = "stroke" | "area" | "pixel";

/** Resultado de la selección con lasso. */
export interface LassoSelection {
  /** Anotaciones seleccionadas. */
  annotations: Annotation[];
  /** Bounding box de la selección. */
  bbox: { x: number; y: number; width: number; height: number };
  /** Centro de la selección. */
  center: { x: number; y: number };
}

export class LassoTool {
  private path: Array<{ x: number; y: number }> = [];
  private isSelecting = false;

  start(x: number, y: number): void {
    this.path = [{ x, y }];
    this.isSelecting = true;
  }

  add(x: number, y: number): void {
    if (!this.isSelecting) return;
    this.path.push({ x, y });
  }

  end(): Array<{ x: number; y: number }> {
    this.isSelecting = false;
    if (this.path.length > 0) {
      this.path.push(this.path[0]); // cerrar
    }
    return this.path;
  }

  /**
   * Selecciona anotaciones dentro del path del lasso.
   * Si el path está completamente cerrado, usa point-in-polygon.
   * Si no, usa bounding box.
   */
  select(annotations: Annotation[]): LassoSelection {
    if (this.path.length < 3) {
      return { annotations: [], bbox: { x: 0, y: 0, width: 0, height: 0 }, center: { x: 0, y: 0 } };
    }
    const selected: Annotation[] = [];
    for (const ann of annotations) {
      if (this.touches(ann)) {
        selected.push(ann);
      }
    }
    const bbox = this.bbox();
    const center = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
    return { annotations: selected, bbox, center };
  }

  private touches(ann: Annotation): boolean {
    if (!("position" in ann)) return false;
    const cx = ann.position.x + (ann.position.width ?? 0) / 2;
    const cy = ann.position.y + (ann.position.height ?? 0) / 2;
    return pointInPolygon({ x: cx, y: cy }, this.path);
  }

  private bbox(): { x: number; y: number; width: number; height: number } {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of this.path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
}

/** Point-in-polygon (ray casting algorithm). */
function pointInPolygon(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Eraser con 3 modos:
 * - stroke: borra trazos completos
 * - area: borra todo dentro de un círculo
 * - pixel: sería muy costoso, simulamos con threshold
 */
export class SmartEraser {
  constructor(private mode: EraserMode = "stroke") {}

  /**
   * Devuelve las anotaciones a borrar según el modo y punto.
   */
  erase(
    point: { x: number; y: number },
    radius: number,
    annotations: Annotation[],
  ): Annotation[] {
    const toErase: Annotation[] = [];
    switch (this.mode) {
      case "stroke":
        // Borrar el trazo más cercano
        let closest: Annotation | null = null;
        let minDist = Infinity;
        for (const ann of annotations) {
          if (!("position" in ann)) continue;
          const d = distanceToAnn(point, ann);
          if (d < minDist && d < radius) {
            minDist = d;
            closest = ann;
          }
        }
        if (closest) toErase.push(closest);
        break;
      case "area":
        // Borrar todo dentro del radio
        for (const ann of annotations) {
          if (!("position" in ann)) continue;
          if (isInsideRadius(point, ann, radius)) {
            toErase.push(ann);
          }
        }
        break;
      case "pixel":
        // Simulamos: borrar lo que intersecta con un círculo
        for (const ann of annotations) {
          if (!("position" in ann)) continue;
          if (intersectsCircle(point, radius, ann)) {
            toErase.push(ann);
          }
        }
        break;
    }
    return toErase;
  }
}

function distanceToAnn(p: { x: number; y: number }, ann: SpatialAnnotation): number {
  const cx = ann.position.x + (ann.position.width ?? 0) / 2;
  const cy = ann.position.y + (ann.position.height ?? 0) / 2;
  return Math.hypot(p.x - cx, p.y - cy);
}

function isInsideRadius(p: { x: number; y: number }, ann: SpatialAnnotation, r: number): boolean {
  return distanceToAnn(p, ann) < r;
}

function intersectsCircle(p: { x: number; y: number }, r: number, ann: SpatialAnnotation): boolean {
  const cx = ann.position.x + (ann.position.width ?? 0) / 2;
  const cy = ann.position.y + (ann.position.height ?? 0) / 2;
  const annR = Math.max((ann.position.width ?? 0), (ann.position.height ?? 0)) / 2;
  return Math.hypot(p.x - cx, p.y - cy) < r + annR;
}

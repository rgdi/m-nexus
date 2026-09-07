// imageOcclusionService.ts: gestiona image occlusion cards (Fase 3.B).
//
// v0.46: Image Occlusion estilo Anki — enmascara regiones de una imagen
// para que el estudiante adivine qué hay debajo.
//
// Representamos cada máscara como coordenadas rectangulares sobre la imagen.
// El formato es portable: la card se guarda como JSON en el front matter
// de la nota Markdown.

export interface OcclusionMask {
  /** ID único de la máscara (0, 1, 2...) */
  id: number;
  /** Coordenadas en píxeles o % de la imagen original */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Etiqueta (qué hay debajo) */
  label: string;
  /** Color del mask en formato hex (default rojo) */
  color?: string;
}

export interface ImageOcclusionCard {
  /** ID de la card (cada máscara genera 1 card) */
  id: number;
  /** URL o path de la imagen */
  imageUrl: string;
  /** Ancho original de la imagen (px) */
  imageWidth: number;
  /** Alto original de la imagen (px) */
  imageHeight: number;
  /** Las máscaras — solo esta card's mask estará oculta */
  masks: OcclusionMask[];
  /** Etiqueta de esta card */
  label: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;
const OCCLUSION_KEY = "image_occlusion";

/**
 * Split inline YAML por comas, respetando comillas.
 * "a: 1, b: 'x, y'" → ["a: 1", " b: 'x, y'"]
 */
function splitYamlInline(s: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      current += c;
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      inQuote = c;
      current += c;
    } else if (c === ",") {
      parts.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

export class ImageOcclusionService {
  /**
   * Parsea el front matter de una nota para extraer image occlusion.
   * Formato esperado en el YAML:
   *   image_occlusion:
   *     image: path/to/image.png
   *     width: 800
   *     height: 600
   *     masks:
   *       - { id: 0, x: 10, y: 20, width: 100, height: 50, label: "Riñón" }
   */
  static parse(content: string): ImageOcclusionCard[] {
    const fmMatch = content.match(FRONTMATTER_RE);
    if (!fmMatch) return [];
    const fm = fmMatch[1];

    // Buscar bloque image_occlusion en YAML simple (sin dependencias externas)
    const occMatch = fm.match(/^image_occlusion:\s*$/m);
    if (!occMatch) return [];

    // Extraer image
    const imageMatch = fm.match(/^\s+image:\s*['"]?([^'"\n]+)['"]?\s*$/m);
    const widthMatch = fm.match(/^\s+width:\s*(\d+)/m);
    const heightMatch = fm.match(/^\s+height:\s*(\d+)/m);
    if (!imageMatch || !widthMatch || !heightMatch) return [];

    const imageUrl = imageMatch[1].trim();
    const imageWidth = parseInt(widthMatch[1], 10);
    const imageHeight = parseInt(heightMatch[1], 10);

    // Extraer máscaras
    const masks: OcclusionMask[] = [];
    const lines = fm.split("\n");
    let inMasks = false;
    let currentMask: Partial<OcclusionMask> | null = null;

    for (const line of lines) {
      if (line.match(/^\s+masks:\s*$/)) {
        inMasks = true;
        continue;
      }
      if (!inMasks) continue;
      if (line.match(/^\s+- /)) {
        // Nueva máscara inline
        const inline = line.replace(/^\s+- /, "").replace(/^\{|\}$/g, "");
        const m: Partial<OcclusionMask> = {};
        // Split por comas que NO estén dentro de comillas
        const parts = splitYamlInline(inline);
        for (const part of parts) {
          const [key, ...rest] = part.split(":");
          const val = rest.join(":").trim();
          const k = key.trim();
          if (k === "id") m.id = parseInt(val, 10);
          else if (k === "x") m.x = parseFloat(val);
          else if (k === "y") m.y = parseFloat(val);
          else if (k === "width") m.width = parseFloat(val);
          else if (k === "height") m.height = parseFloat(val);
          else if (k === "label") m.label = val.replace(/^['"]|['"]$/g, "");
          else if (k === "color") m.color = val.replace(/^['"]|['"]$/g, "");
        }
        if (m.id !== undefined) masks.push(m as OcclusionMask);
        currentMask = null;
      }
    }

    return masks.map((m) => ({
      id: m.id,
      imageUrl,
      imageWidth,
      imageHeight,
      masks,
      label: m.label,
    }));
  }

  /**
   * Genera el YAML front matter para una image occlusion card.
   */
  static toFrontmatter(
    imageUrl: string,
    imageWidth: number,
    imageHeight: number,
    masks: OcclusionMask[]
  ): string {
    const lines = ["---"];
    lines.push("image_occlusion:");
    lines.push(`  image: ${imageUrl}`);
    lines.push(`  width: ${imageWidth}`);
    lines.push(`  height: ${imageHeight}`);
    lines.push("  masks:");
    for (const m of masks) {
      const color = m.color ?? "#FF0000";
      lines.push(`    - { id: ${m.id}, x: ${m.x}, y: ${m.y}, width: ${m.width}, height: ${m.height}, label: "${m.label}", color: "${color}" }`);
    }
    lines.push("---");
    return lines.join("\n");
  }

  /**
   * Convierte coordenadas de píxeles a porcentaje (0-100).
   */
  static pixelsToPercent(
    masks: OcclusionMask[],
    imageWidth: number,
    imageHeight: number
  ): Array<OcclusionMask & { xPct: number; yPct: number; wPct: number; hPct: number }> {
    return masks.map((m) => ({
      ...m,
      xPct: (m.x / imageWidth) * 100,
      yPct: (m.y / imageHeight) * 100,
      wPct: (m.width / imageWidth) * 100,
      hPct: (m.height / imageHeight) * 100,
    }));
  }

  /**
   * Genera una card por máscara.
   */
  static generateCards(imageUrl: string, imageWidth: number, imageHeight: number, masks: OcclusionMask[]): ImageOcclusionCard[] {
    return masks.map((m) => ({
      id: m.id,
      imageUrl,
      imageWidth,
      imageHeight,
      masks,
      label: m.label,
    }));
  }

  /**
   * Valida que las máscaras estén dentro de la imagen.
   */
  static validate(masks: OcclusionMask[], imageWidth: number, imageHeight: number): string[] {
    const errors: string[] = [];
    for (const m of masks) {
      if (m.x < 0 || m.y < 0) errors.push(`Mask ${m.id}: coordenadas negativas`);
      if (m.x + m.width > imageWidth) errors.push(`Mask ${m.id}: excede ancho de imagen`);
      if (m.y + m.height > imageHeight) errors.push(`Mask ${m.id}: excede alto de imagen`);
      if (m.width <= 0 || m.height <= 0) errors.push(`Mask ${m.id}: dimensiones inválidas`);
      if (!m.label || m.label.trim().length === 0) errors.push(`Mask ${m.id}: label vacío`);
    }
    return errors;
  }
}

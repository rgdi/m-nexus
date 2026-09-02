// v0.27: Templates / booklets tipo Samsung Notes.
// Plantillas de fondo: blank, lined, grid, dotted, Cornell, etc.

export type TemplateType = "blank" | "lined" | "grid" | "dotted" | "cornell" | "music" | "todo" | "calendar-weekly" | "calendar-monthly" | "graph-5mm" | "storyboard" | "kanban";

export interface TemplateConfig {
  type: TemplateType;
  name: string;
  description: string;
  /** Color de las líneas. */
  lineColor: string;
  /** Espaciado en px. */
  spacing: number;
  /** Si tiene margen izquierdo (rojo). */
  marginLine: boolean;
  /** Tamaño del patrón. */
  size?: { width: number; height: number };
}

/** Catálogo de templates estilo Samsung Notes. */
export const TEMPLATES: Record<TemplateType, TemplateConfig> = {
  blank: { type: "blank", name: "En blanco", description: "Sin líneas", lineColor: "transparent", spacing: 0, marginLine: false },
  lined: { type: "lined", name: "Líneas", description: "Rayado horizontal clásico", lineColor: "#BBDEFB", spacing: 24, marginLine: true },
  grid: { type: "grid", name: "Cuadrícula", description: "Cuadros de 5mm", lineColor: "#E0E0E0", spacing: 18, marginLine: false },
  dotted: { type: "dotted", name: "Puntos", description: "Puntos para bullet journal", lineColor: "#CFD8DC", spacing: 20, marginLine: false },
  cornell: { type: "cornell", name: "Cornell", description: "Notas Cornell con margen", lineColor: "#FFE082", spacing: 24, marginLine: true },
  music: { type: "music", name: "Pentagrama", description: "5 líneas para música", lineColor: "#90A4AE", spacing: 12, marginLine: false },
  todo: { type: "todo", name: "To-do", description: "Lista de tareas", lineColor: "#FFCCBC", spacing: 32, marginLine: true },
  "calendar-weekly": { type: "calendar-weekly", name: "Semanal", description: "Vista semanal", lineColor: "#C5E1A5", spacing: 80, marginLine: false },
  "calendar-monthly": { type: "calendar-monthly", name: "Mensual", description: "Vista mensual", lineColor: "#FFAB91", spacing: 60, marginLine: false },
  "graph-5mm": { type: "graph-5mm", name: "Cuaderno 5mm", description: "Cuadrícula 5mm", lineColor: "#B0BEC5", spacing: 14, marginLine: false },
  storyboard: { type: "storyboard", name: "Storyboard", description: "6 cuadros", lineColor: "#B0BEC5", spacing: 0, marginLine: false, size: { width: 800, height: 1200 } },
  kanban: { type: "kanban", name: "Kanban", description: "3 columnas: hacer, haciendo, hecho", lineColor: "#FFE082", spacing: 0, marginLine: false },
};

/**
 * Renderiza un template como SVG de fondo.
 */
export function renderTemplate(config: TemplateConfig, width: number, height: number): string {
  const padding = 40;
  const w = width - padding * 2;
  const h = height - padding * 2;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" class="mnexus-template">`;

  switch (config.type) {
    case "blank":
      break;
    case "lined":
      for (let y = padding; y < height - padding; y += config.spacing) {
        svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="${config.lineColor}" stroke-width="0.5" />`;
      }
      if (config.marginLine) {
        svg += `<line x1="${padding + 80}" y1="${padding}" x2="${padding + 80}" y2="${height - padding}" stroke="#EF9A9A" stroke-width="0.8" />`;
      }
      break;
    case "grid":
      for (let x = padding; x < width - padding; x += config.spacing) {
        svg += `<line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" stroke="${config.lineColor}" stroke-width="0.3" />`;
      }
      for (let y = padding; y < height - padding; y += config.spacing) {
        svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="${config.lineColor}" stroke-width="0.3" />`;
      }
      break;
    case "dotted":
      for (let x = padding; x < width - padding; x += config.spacing) {
        for (let y = padding; y < height - padding; y += config.spacing) {
          svg += `<circle cx="${x}" cy="${y}" r="0.8" fill="${config.lineColor}" />`;
        }
      }
      break;
    case "cornell": {
      // Margen izquierdo 1/3 (cues)
      const cueX = padding + w / 3;
      svg += `<line x1="${cueX}" y1="${padding}" x2="${cueX}" y2="${height - padding - 100}" stroke="#FFB74D" stroke-width="1" />`;
      // Margen inferior (resumen)
      const summaryY = height - padding - 100;
      svg += `<line x1="${padding}" y1="${summaryY}" x2="${width - padding}" y2="${summaryY}" stroke="#FFB74D" stroke-width="1" />`;
      // Líneas en la zona de notas (2/3 derecha)
      for (let y = padding; y < summaryY; y += config.spacing) {
        svg += `<line x1="${cueX + 10}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="${config.lineColor}" stroke-width="0.5" />`;
      }
      // Texto
      svg += `<text x="${padding + 10}" y="${padding + 20}" font-size="14" fill="#FFB74D" font-family="sans-serif">Cues</text>`;
      svg += `<text x="${cueX + 10}" y="${padding + 20}" font-size="14" fill="#FFB74D" font-family="sans-serif">Notes</text>`;
      svg += `<text x="${padding + 10}" y="${summaryY + 25}" font-size="14" fill="#FFB74D" font-family="sans-serif">Summary</text>`;
      break;
    }
    case "music": {
      // 5 líneas horizontales cada 12px
      const lineCount = 5;
      const lineSpacing = 4;
      for (let staff = 0; staff < 10; staff++) {
        for (let i = 0; i < lineCount; i++) {
          const y = padding + staff * config.spacing * 4 + i * lineSpacing;
          svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="${config.lineColor}" stroke-width="0.5" />`;
        }
      }
      break;
    }
    case "todo": {
      // Lista con checkbox cada 32px
      for (let y = padding; y < height - padding; y += config.spacing) {
        svg += `<rect x="${padding}" y="${y + 4}" width="12" height="12" stroke="${config.lineColor}" fill="none" />`;
        svg += `<line x1="${padding + 20}" y1="${y + 10}" x2="${width - padding}" y2="${y + 10}" stroke="${config.lineColor}" stroke-width="0.5" />`;
      }
      break;
    }
    case "calendar-weekly": {
      // 7 columnas
      const colWidth = w / 7;
      const days = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
      for (let i = 0; i < 7; i++) {
        const x = padding + i * colWidth;
        svg += `<line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" stroke="${config.lineColor}" stroke-width="0.5" />`;
        svg += `<text x="${x + 10}" y="${padding + 20}" font-size="14" fill="#558B2F" font-family="sans-serif" font-weight="bold">${days[i]}</text>`;
      }
      svg += `<line x1="${padding}" y1="${padding + 30}" x2="${width - padding}" y2="${padding + 30}" stroke="${config.lineColor}" stroke-width="0.8" />`;
      break;
    }
    case "calendar-monthly": {
      // Grid 7x6
      const colWidth = w / 7;
      const rowHeight = (height - padding * 2 - 30) / 6;
      const days = ["L", "M", "X", "J", "V", "S", "D"];
      for (let i = 0; i < 7; i++) {
        const x = padding + i * colWidth;
        svg += `<line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" stroke="${config.lineColor}" stroke-width="0.5" />`;
        svg += `<text x="${x + 10}" y="${padding + 20}" font-size="12" fill="#D84315" font-family="sans-serif" font-weight="bold">${days[i]}</text>`;
      }
      for (let i = 0; i <= 6; i++) {
        const y = padding + 30 + i * rowHeight;
        svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="${config.lineColor}" stroke-width="0.5" />`;
      }
      break;
    }
    case "graph-5mm": {
      // Cuadrícula fina cada 14px (≈5mm)
      for (let x = padding; x < width - padding; x += config.spacing) {
        svg += `<line x1="${x}" y1="${padding}" x2="${x}" y2="${height - padding}" stroke="${config.lineColor}" stroke-width="0.2" />`;
      }
      for (let y = padding; y < height - padding; y += config.spacing) {
        svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}" stroke="${config.lineColor}" stroke-width="0.2" />`;
      }
      break;
    }
    case "storyboard": {
      // 6 cuadros (2x3)
      const cols = 2, rows = 3;
      const cw = w / cols;
      const ch = (h - 40) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = padding + c * cw;
          const y = padding + r * ch;
          svg += `<rect x="${x + 5}" y="${y + 5}" width="${cw - 10}" height="${ch - 10}" stroke="${config.lineColor}" stroke-width="1" fill="none" />`;
        }
      }
      break;
    }
    case "kanban": {
      // 3 columnas
      const cw = w / 3;
      const headers = ["Por hacer", "En progreso", "Hecho"];
      const colors = ["#FFCCBC", "#FFF59D", "#C8E6C9"];
      for (let i = 0; i < 3; i++) {
        const x = padding + i * cw;
        svg += `<rect x="${x + 5}" y="${padding}" width="${cw - 10}" height="${h}" stroke="${config.lineColor}" fill="${colors[i]}" opacity="0.3" />`;
        svg += `<text x="${x + cw / 2 - 30}" y="${padding + 25}" font-size="14" font-weight="bold" fill="#5D4037" font-family="sans-serif">${headers[i]}</text>`;
      }
      break;
    }
  }
  svg += `</svg>`;
  return svg;
}

/** Aplica un template al overlay de la nota. */
export function applyTemplateToContainer(container: HTMLElement, type: TemplateType, width: number, height: number): void {
  // Limpiar templates anteriores
  const existing = container.querySelectorAll(".mnexus-template-wrapper");
  existing.forEach((el) => el.remove());
  const config = TEMPLATES[type];
  const svgString = renderTemplate(config, width, height);
  const wrapper = document.createElement("div");
  wrapper.className = "mnexus-template-wrapper";
  wrapper.style.cssText = "position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; z-index: 1;";
  wrapper.innerHTML = svgString;
  container.prepend(wrapper);
}

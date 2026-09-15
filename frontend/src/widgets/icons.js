/* ============================================================
 * icons.js — sprite SVG inline para iconografía estilo SF Symbols.
 * v1.6.0 — reemplazamos glifos unicode por SVG nítidos.
 *
 * Uso:
 *   import { icon } from "./icons.js";
 *   icon("calendar", 18)   → `<svg ...>...</svg>`
 *
 * Estilo: stroke 1.6, redondeado, monocromo (usa currentColor).
 * ============================================================ */

const PATHS = {
  // Dock
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v4M16 3v4"/>',
  subjects: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  notes:    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  todos:    '<path d="M3 6l4 4L17 4M3 12l4 4L17 10M3 18l4 4L17 16"/>',
  tutor:    '<path d="M12 2l2.4 5.4L20 8l-4 4 1 5.6L12 15l-5 2.6L8 12 4 8l5.6-.6L12 2z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  // Toolbox notebook
  pen:        '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>',
  highlighter:'<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4 4-6-6 4-4 6 6z"/>',
  eraser:     '<path d="M18 13l-6 6-9-9 9-9 6 6v6z"/><path d="M9 7l9 9"/>',
  select:     '<path d="M3 3l7 17 2-8 8-2L3 3z"/>',
  ruler:      '<rect x="2" y="10" width="20" height="4" rx="1"/><path d="M6 10v3M10 10v3M14 10v3M18 10v3"/>',
  // Insert actions
  voice:    '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
  code:     '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  image:    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  graph:    '<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>',
  link:     '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  table:    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  flashcard:'<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20M7 14h6"/>',
  // Header buttons
  back:     '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  search:   '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  filter:   '<path d="M3 6h18M6 12h12M10 18h4"/>',
  close:    '<path d="M18 6L6 18M6 6l12 12"/>',
  check:    '<path d="M20 6L9 17l-5-5"/>',
  // AI submenu
  sparkles: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5zM19 14l1 2.5L23 18l-3 1.5L19 22l-1-2.5L15 18l3-1.5L19 14zM5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/>',
  bulb:     '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c1 .8 1.5 2 1.5 3.3v1h5v-1c0-1.3.5-2.5 1.5-3.3A7 7 0 0 0 12 2z"/>',
  wand:     '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h0M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5"/>',
  text:     '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  // Status
  rec:      '<circle cx="12" cy="12" r="6"/>',
  play:     '<path d="M5 3l14 9-14 9V3z"/>',
  pause:    '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  skip:     '<path d="M5 4l10 8-10 8V4zM19 5v14"/>',
  bookmark: '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
  // Cross-verify
  cross:    '<path d="M4 9l8 8M12 9l-8 8M16 4l4 4M20 4l-4 4"/>',
  // Trash
  trash:    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6"/>',
};

/**
 * Devuelve un string SVG inline.
 * @param name clave del icono en PATHS
 * @param size tamaño en px (cuadrado)
 * @param opts { stroke, fill, color, title }
 */
export function icon(name, size = 18, opts = {}) {
  const path = PATHS[name];
  if (!path) return `<span style="display:inline-block;width:${size}px;text-align:center">?</span>`;
  const stroke = opts.stroke ?? 1.8;
  const color = opts.color ?? "currentColor";
  const fill = opts.fill ?? "none";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:middle">${path}</svg>`;
}

export const ICON_PATHS = PATHS;

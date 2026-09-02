// Utilidades multi-plataforma para manejo de paths.
// Obsidian usa "/" en todos los SO internamente, pero hay que tener cuidado
// con: WebDAV (algunos servers usan "\\" en Windows), file:// URLs,
// paths de Windows con espacios o caracteres especiales, y case sensitivity
// en macOS (HFS+ por defecto es case-insensitive, APFS case-sensitive).

/**
 * Normaliza un path al estilo Obsidian: "/" como separador, sin "\\",
 * sin "//", sin trailing slash (excepto root).
 */
export function normalizePath(path: string): string {
  if (!path) return "";
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/$/, "");
}

/** Une paths asegurándose de no duplicar separadores. */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p) => normalizePath(p))
    .filter(Boolean)
    .join("/");
}

/** Normaliza un nombre de archivo para que sea seguro en todos los SO. */
export function sanitizeFilename(name: string): string {
  // Caracteres prohibidos en Windows: < > : " / \ | ? *
  // En macOS: : (en HFS+) y / (en APFS, y "" también)
  // En Linux: solo / y NUL
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/^\.+/, "") // No empezar con .
    .replace(/\s+/g, "-") // espacios → guiones
    .trim()
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200); // Límite conservador
}

/** Compara paths case-insensitive (compatible con Windows/macOS HFS+). */
export function pathEquals(a: string, b: string, caseInsensitive = true): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  return caseInsensitive ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** Detecta si el path es absoluto y del estilo Windows (C:\..., \\server\...). */
export function isWindowsPath(p: string): boolean {
  return /^[A-Z]:[\\\/]/i.test(p) || /^\\\\/.test(p);
}

/** Convierte un path local a file:// URL (multi-plataforma). */
export function pathToFileUrl(p: string): string {
  if (p.startsWith("file://")) return p;
  // Normalizar separadores
  const normalized = p.replace(/\\/g, "/");
  // Windows: file:///C:/Users/...
  if (/^[A-Z]:/i.test(normalized)) {
    return "file:///" + normalized;
  }
  // Unix: file:///home/user/...
  return "file://" + (normalized.startsWith("/") ? normalized : "/" + normalized);
}

/** Convierte un file:// URL a path local. */
export function fileUrlToPath(url: string): string {
  if (!url.startsWith("file://")) return url;
  // file:/// tiene 3 slashes (Unix) o file://C:/... tiene 2 (Windows)
  let stripped: string;
  try {
    stripped = decodeURIComponent(url.replace(/^file:\/+/, ""));
  } catch {
    stripped = url.replace(/^file:\/+/, "");
  }
  // Windows
  if (/^[A-Z]:/i.test(stripped)) {
    return stripped.replace(/\//g, "\\");
  }
  return "/" + stripped;
}

/** Genera un ID único para archivos, válido en todos los SO. */
export function safeId(prefix = "mnexus"): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

/** Trunca un path para mostrar en UI (sin romper la estructura). */
export function truncatePath(p: string, maxLen = 50): string {
  const normalized = normalizePath(p);
  if (normalized.length <= maxLen) return normalized;
  const parts = normalized.split("/");
  if (parts.length <= 2) return "…" + normalized.slice(-maxLen + 1);
  return `${parts[0]}/…/${parts[parts.length - 1]}`;
}

/** Construye un nombre de archivo basado en timestamp y nombre opcional. */
export function buildFilename(baseName: string, ext: string, prefix?: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const clean = sanitizeFilename(baseName || "file");
  const p = prefix ? `${prefix}-` : "";
  return `${p}${clean}-${ts}.${ext.replace(/^\./, "")}`;
}

// pathValidation.ts: previene path traversal (../ ../../etc/passwd).
//
// v0.60 (P3.1): todas las rutas que vienen del cliente DEBEN estar dentro
// del vault. Si no, rechazar con 400.

import { resolve, relative, sep, isAbsolute } from "node:path";
import { E } from "./errorCodes.js";

/**
 * Valida que un path este dentro del root permitido.
 * Devuelve el path absoluto normalizado, o throw un AppError 400.
 */
export function safePath(rootDir: string, userPath: string): string {
  if (!rootDir) throw E.val("EC-SEC-001", "rootDir requerido", { context: { userPath } });
  if (!userPath) throw E.val("EC-SEC-002", "path requerido", { context: { rootDir } });
  if (userPath.includes("\0")) {
    throw E.val("EC-SEC-003", "path contiene null bytes", { context: { userPath } });
  }
  // Resolver ambos a absolutos
  const absRoot = resolve(rootDir);
  let absPath: string;
  if (isAbsolute(userPath)) {
    absPath = resolve(userPath);
  } else {
    absPath = resolve(absRoot, userPath);
  }
  // Normalizar separadores (Windows compatible)
  const normRoot = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
  // Debe estar dentro del root
  if (!absPath.startsWith(normRoot) && absPath !== absRoot) {
    throw E.val("EC-SEC-004", "path fuera del root permitido (path traversal?)", {
      context: { userPath, absPath, rootDir: absRoot },
    });
  }
  // Tambien rechazar symlinks que apunten fuera (best effort)
  return absPath;
}

/**
 * Devuelve el path RELATIVO al root. Util para logs y respuestas.
 */
export function relativeSafePath(rootDir: string, absPath: string): string {
  return relative(rootDir, absPath).split(sep).join("/");
}

/**
 * Valida que un path sea solo un nombre (no contiene separadores).
 * Util para validar nombres de archivos subidos.
 */
export function safeName(name: string): string {
  if (!name) throw E.val("EC-SEC-005", "nombre requerido", { context: { name } });
  if (name.includes("/") || name.includes("\\") || name.includes("..") || name.includes("\0")) {
    throw E.val("EC-SEC-006", "nombre invalido (contiene /, \\, .. o \\0)", { context: { name } });
  }
  if (name.length > 255) {
    throw E.val("EC-SEC-007", "nombre demasiado largo (>255)", { context: { len: name.length } });
  }
  return name;
}

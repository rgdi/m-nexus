// Helpers de formato (bytes, fechas, duración).

/** Formatea bytes en formato humano (1.2 KB, 3.4 MB, etc). */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Formatea fecha relativa ("hace 2 horas", "ayer", "2026-09-07"). */
export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const absDiff = Math.abs(diffMs);
  const sign = diffMs >= 0 ? "" : "en ";

  if (absDiff < 60_000) return sign + "ahora";
  if (absDiff < 3600_000) return sign + `hace ${Math.round(absDiff / 60_000)} min`;
  if (absDiff < 86_400_000) return sign + `hace ${Math.round(absDiff / 3600_000)} h`;
  if (absDiff < 7 * 86_400_000) return sign + `hace ${Math.round(absDiff / 86_400_000)} d`;
  return date.toISOString().slice(0, 10);
}

/** Formatea duración en ms como "1.2s" o "456ms". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

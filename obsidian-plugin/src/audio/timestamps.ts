// Conversor entre segundos ↔ marcas de tiempo que Obsidian entiende en audio embebido.

export function secondsToObsidian(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const hh = h.toString().padStart(2, "0");
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Construye el enlace [[file.mp3#t=MM:SS]] que Obsidian renderiza como reproductor. */
export function buildAudioRefLink(fileName: string, seconds: number): string {
  return `[[${fileName}#t=${secondsToObsidian(seconds)}]]`;
}

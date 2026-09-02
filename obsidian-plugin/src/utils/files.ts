// Helpers de archivos compartidos.

import { App, normalizePath, TFile, TFolder } from "obsidian";

export async function ensureFolder(app: App, path: string): Promise<void> {
  const norm = normalizePath(path);
  if (await app.vault.adapter.exists(norm)) return;
  const parts = norm.split("/");
  let cur = "";
  for (const p of parts) {
    cur = cur ? `${cur}/${p}` : p;
    if (!(await app.vault.adapter.exists(cur))) {
      await app.vault.createFolder(cur);
    }
  }
}

export async function listAllFiles(app: App, folder: string): Promise<TFile[]> {
  const f = app.vault.getAbstractFileByPath(normalizePath(folder));
  if (!(f instanceof TFolder)) return [];
  return f.children.filter((c): c is TFile => c instanceof TFile);
}

export function isAudio(file: TFile): boolean {
  return /\.(mp3|wav|m4a|ogg|flac)$/i.test(file.path);
}

export function isImage(file: TFile): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(file.path);
}

export function isPdf(file: TFile): boolean {
  return /\.pdf$/i.test(file.path);
}

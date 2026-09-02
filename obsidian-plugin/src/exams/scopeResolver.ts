// ScopeResolver: traduce ExamScope → lista de paths de notas.
// v0.14: soporta notas individuales, carpetas (con/sin subcarpetas), tags y subjects.
//
// El resolver es INTENCIONALMENTE síncrono para el path lookup (no necesita
// indexing) y delega al vault de Obsidian. Para scopes grandes, devuelve
// streams en lugar de arrays.

import { App, normalizePath } from "obsidian";
import type { ExamScope } from "./types.js";

export interface ResolvedScope {
  path: string;
  source: ExamScope["type"];
  /** Si esta nota se incluyó por subcarpeta (subcarpeta N niveles). */
  depth?: number;
}

export interface ScopeResolveOptions {
  /** Tipos de archivo a incluir. Default: solo markdown. */
  extensions?: string[];
  /** Excluir paths (por ejemplo, borradores). */
  excludeFolders?: string[];
}

export class ScopeResolver {
  constructor(private app: App) {}

  /** Duck-typing checks (compatibles con mocks de tests). */
  private isFile(x: unknown): x is { path: string; extension: string } {
    return Boolean(x && typeof x === "object" && typeof (x as { path?: unknown }).path === "string" && typeof (x as { extension?: unknown }).extension === "string");
  }
  private isFolder(x: unknown): x is { path: string; children: unknown[] } {
    return Boolean(x && typeof x === "object" && typeof (x as { path?: unknown }).path === "string" && Array.isArray((x as { children?: unknown }).children));
  }

  /** Extrae el frontmatter del cache, soportando mocks que devuelven {frontmatter} o el FM directamente. */
  private frontmatterOf(file: { path: string }): Record<string, unknown> | null {
    const cache = this.app.metadataCache.getFileCache(file as unknown as Parameters<typeof this.app.metadataCache.getFileCache>[0]) as unknown;
    if (!cache || typeof cache !== "object") return null;
    const obj = cache as { frontmatter?: Record<string, unknown>; tags?: unknown; subject?: unknown };
    if (obj.frontmatter && typeof obj.frontmatter === "object") return obj.frontmatter;
    // Fallback: el mock puede devolver el FM directo
    if ("tags" in obj || "subject" in obj) return obj as Record<string, unknown>;
    return null;
  }

  /** Resuelve un scope a una lista de paths. */
  resolve(scope: ExamScope, opts: ScopeResolveOptions = {}): ResolvedScope[] {
    const exts = opts.extensions ?? ["md"];
    const exclude = new Set((opts.excludeFolders ?? []).map((p) => normalizePath(p)));
    switch (scope.type) {
      case "note":
        return this.resolveNote(scope.path, exts);
      case "folder":
        return this.resolveFolder(scope.path, scope.includeSubfolders, exts, exclude);
      case "tag":
        return this.resolveTag(scope.tag, exts, exclude);
      case "subject":
        return this.resolveSubject(scope.subject, exts, exclude);
    }
  }

  /** Resuelve múltiples scopes a la vez y deduplica. */
  resolveMany(scopes: ExamScope[], opts: ScopeResolveOptions = {}): ResolvedScope[] {
    const seen = new Map<string, ResolvedScope>();
    for (const s of scopes) {
      for (const r of this.resolve(s, opts)) {
        if (!seen.has(r.path)) seen.set(r.path, r);
      }
    }
    return Array.from(seen.values());
  }

  /** Cuenta rápida sin resolver paths (solo el scope folder). */
  count(scope: ExamScope, opts: ScopeResolveOptions = {}): number {
    return this.resolve(scope, opts).length;
  }

  private resolveNote(path: string, exts: string[]): ResolvedScope[] {
    const norm = normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(norm);
    if (!file) return [];
    // Duck-typing para soportar tests con mocks
    if (this.isFolder(file)) {
      // Si pasan una carpeta como "note", expandir a sus hijos
      return this.collectFromFolder(file, false, 0, exts, new Set());
    }
    if (this.isFile(file) && exts.includes((file as { extension: string }).extension)) {
      return [{ path: norm, source: "note" }];
    }
    return [];
  }

  private resolveFolder(
    path: string,
    recursive: boolean,
    exts: string[],
    exclude: Set<string>
  ): ResolvedScope[] {
    const norm = normalizePath(path);
    const folder = this.app.vault.getAbstractFileByPath(norm);
    if (!folder || !this.isFolder(folder)) return [];
    return this.collectFromFolder(folder, recursive, 0, exts, exclude);
  }

  private collectFromFolder(
    folder: { path: string; children: unknown[] },
    recursive: boolean,
    depth: number,
    exts: string[],
    exclude: Set<string>
  ): ResolvedScope[] {
    const out: ResolvedScope[] = [];
    if (exclude.has(folder.path)) return out;
    for (const child of folder.children) {
      const childPath = (child as { path?: string }).path;
      if (childPath && exclude.has(childPath)) continue; // Excluir archivos explícitamente
      if (this.isFile(child) && exts.includes((child as { extension: string }).extension)) {
        out.push({ path: (child as { path: string }).path, source: "folder", depth });
      } else if (this.isFolder(child)) {
        if (recursive) {
          out.push(...this.collectFromFolder(child, recursive, depth + 1, exts, exclude));
        }
      }
    }
    return out;
  }

  private resolveTag(tag: string, exts: string[], exclude: Set<string>): ResolvedScope[] {
    const norm = tag.startsWith("#") ? tag.slice(1) : tag;
    const out: ResolvedScope[] = [];
    const allFiles = this.app.vault.getMarkdownFiles();
    for (const file of allFiles) {
      if (!exts.includes(file.extension)) continue;
      if (exclude.has(file.path)) continue;
      const fm = this.frontmatterOf(file);
      const tags = this.getAllTags(fm);
      if (tags.includes(norm)) {
        out.push({ path: file.path, source: "tag" });
      }
    }
    return out;
  }

  private resolveSubject(subject: string, exts: string[], exclude: Set<string>): ResolvedScope[] {
    const allFiles = this.app.vault.getMarkdownFiles();
    const out: ResolvedScope[] = [];
    const norm = subject.toLowerCase();
    for (const file of allFiles) {
      if (!exts.includes(file.extension)) continue;
      if (exclude.has(file.path)) continue;
      const fm = this.frontmatterOf(file);
      const subj = (fm?.subject ?? "") as string;
      if (typeof subj === "string" && subj.toLowerCase() === norm) {
        out.push({ path: file.path, source: "subject" });
      }
    }
    return out;
  }

  private getAllTags(fm: unknown): string[] {
    if (!fm || typeof fm !== "object") return [];
    const tags = (fm as { tags?: unknown }).tags;
    if (Array.isArray(tags)) return tags.map((t) => String(t).replace(/^#/, ""));
    if (typeof tags === "string") return tags.split(/[,\s]+/).map((t) => t.replace(/^#/, ""));
    return [];
  }

  /** Listado rápido de carpetas (autocomplete). Devuelve paths sin el slash final. */
  listFolders(): string[] {
    const folders: string[] = [];
    const root = this.app.vault.getRoot();
    if (!root) return folders;
    const collect = (folder: { path: string; children: unknown[] }) => {
      if (folder.path) folders.push(folder.path);
      for (const child of folder.children) {
        if (this.isFolder(child)) collect(child as { path: string; children: unknown[] });
      }
    };
    for (const child of root.children) {
      if (this.isFolder(child)) collect(child as { path: string; children: unknown[] });
    }
    return folders;
  }

  /** Listado rápido de tags únicos del vault. */
  listTags(): string[] {
    const allFiles = this.app.vault.getMarkdownFiles();
    const tagSet = new Set<string>();
    for (const file of allFiles) {
      const fm = this.frontmatterOf(file);
      for (const t of this.getAllTags(fm)) {
        tagSet.add(t.toLowerCase());
      }
    }
    return Array.from(tagSet).sort();
  }

  /** Listado rápido de subjects únicos. */
  listSubjects(): string[] {
    const allFiles = this.app.vault.getMarkdownFiles();
    const subjSet = new Set<string>();
    for (const file of allFiles) {
      const fm = this.frontmatterOf(file);
      const subj = (fm?.subject ?? "") as string;
      if (typeof subj === "string" && subj.trim()) {
        subjSet.add(subj);
      }
    }
    return Array.from(subjSet).sort();
  }

  /** Búsqueda rápida por prefijo (para el NotePicker). */
  searchPrefix(query: string, max = 30): { notes: string[]; folders: string[]; tags: string[]; subjects: string[] } {
    const q = query.toLowerCase().trim();
    if (!q) return { notes: [], folders: [], tags: [], subjects: [] };
    const out = { notes: [] as string[], folders: [] as string[], tags: [] as string[], subjects: [] as string[] };
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.toLowerCase().includes(q)) {
        out.notes.push(f.path);
        if (out.notes.length >= max) break;
      }
    }
    if (out.notes.length < max) {
      for (const folder of this.listFolders()) {
        if (folder.toLowerCase().includes(q)) {
          out.folders.push(folder);
          if (out.folders.length >= max) break;
        }
      }
    }
    if (out.notes.length + out.folders.length < max) {
      for (const tag of this.listTags()) {
        if (tag.includes(q)) {
          out.tags.push(tag);
          if (out.tags.length >= max) break;
        }
      }
    }
    if (out.notes.length + out.folders.length + out.tags.length < max) {
      for (const subj of this.listSubjects()) {
        if (subj.toLowerCase().includes(q)) {
          out.subjects.push(subj);
          if (out.subjects.length >= max) break;
        }
      }
    }
    return out;
  }
}

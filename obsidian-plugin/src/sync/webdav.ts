// WebDAV client para sincronización cross-device.
// Compatible con Nextcloud, ownCloud, Apache mod_dav, iCloud (vía apps),
// 4shared, Box, etc. Usa XML para PROPFIND.
//
// Diseñado para sincronizar:
//   - El vault completo (notas .md)
//   - La carpeta _M-NEXUS/ (transcripciones, flashcards, drawings, templates)
//
// Estrategia: mantener un manifest con {path → mtime, size, etag, hash}.
// En cada sync, comparamos local vs remote y subimos/descargamos lo que difiera.

import { requestUrl } from "obsidian";
import { SyncFileEntry, SyncStatus } from "../types";
import { Logger } from "../utils/logger";

export interface WebDAVConfig {
  url: string;
  username: string;
  password: string;
  basePath: string; // ej: "/m-nexus/"
}

export class WebDAVClient {
  constructor(private config: WebDAVConfig, private log: Logger) {}

  isConfigured(): boolean {
    return Boolean(this.config.url && this.config.username && this.config.password);
  }

  private authHeader(): string {
    return "Basic " + btoa(`${this.config.username}:${this.config.password}`);
  }

  private endpoint(path: string): string {
    const base = this.config.url.replace(/\/+$/, "");
    const sub = (this.config.basePath + path).replace(/^\/+/, "");
    return `${base}/${sub}`;
  }

  /** PROPFIND: lista el directorio y devuelve metadatos. */
  async list(dir: string = ""): Promise<SyncFileEntry[]> {
    const url = this.endpoint(dir);
    const res = await requestUrl({
      url,
      method: "PROPFIND",
      headers: { Authorization: this.authHeader(), Depth: "1" },
      body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>`,
      throw: false,
    });
    if (res.status === 404) return []; // directorio no existe
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WebDAV PROPFIND ${res.status}: ${res.text.slice(0, 300)}`);
    }
    return this.parseMultistatus(res.text, dir);
  }

  /** Descarga un archivo como string. */
  async readText(path: string): Promise<string> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method: "GET",
      headers: { Authorization: this.authHeader() },
      throw: false,
    });
    if (res.status !== 200) {
      throw new Error(`WebDAV GET ${res.status}`);
    }
    return res.text;
  }

  /** Descarga como bytes (binarios: imágenes, PDFs, etc.). */
  async readBinary(path: string): Promise<ArrayBuffer> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method: "GET",
      headers: { Authorization: this.authHeader() },
      throw: false,
    });
    if (res.status !== 200) {
      throw new Error(`WebDAV GET ${res.status}`);
    }
    return res.arrayBuffer;
  }

  /** Sube un archivo (crea o sobreescribe). */
  async writeText(path: string, content: string): Promise<void> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method: "PUT",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "text/markdown",
      },
      body: content,
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WebDAV PUT ${res.status}: ${res.text.slice(0, 300)}`);
    }
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method: "PUT",
      headers: {
        Authorization: this.authHeader(),
        "Content-Type": "application/octet-stream",
      },
      body: content,
      throw: false,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WebDAV PUT ${res.status}`);
    }
  }

  /** Borra un archivo. */
  async delete(path: string): Promise<void> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method: "DELETE",
      headers: { Authorization: this.authHeader() },
      throw: false,
    });
    if (res.status !== 204 && res.status !== 200) {
      throw new Error(`WebDAV DELETE ${res.status}`);
    }
  }

  /** Crea directorio si no existe (MKCOL). */
  async mkdir(path: string): Promise<void> {
    const res = await requestUrl({
      url: this.endpoint(path),
      method: "MKCOL",
      headers: { Authorization: this.authHeader() },
      throw: false,
    });
    if (res.status !== 201 && res.status !== 405) {
      // 405 = ya existe
      throw new Error(`WebDAV MKCOL ${res.status}`);
    }
  }

  // ─── Parser de multistatus XML ────────────────────────────────────────

  private parseMultistatus(xml: string, baseDir: string): SyncFileEntry[] {
    const entries: SyncFileEntry[] = [];
    // Regex simple (no dependemos de un parser XML completo)
    const responses = xml.matchAll(/<response[^>]*>([\s\S]*?)<\/response>/g);
    for (const m of responses) {
      const block = m[1];
      const hrefMatch = block.match(/<href>([^<]+)<\/href>/);
      if (!hrefMatch) continue;
      const href = decodeURIComponent(hrefMatch[1]);
      // Filtrar la entrada raíz (es el directorio mismo)
      const isCollection = /<resourcetype[^>]*>[\s\S]*?<collection[\s\/]*>[\s\S]*?<\/resourcetype>/.test(block) ||
        /<resourcetype[^>]*\/>/.test(block) === false && /<collection[\/]?>/.test(block);
      if (isCollection && /\/$/.test(href)) continue;
      const mtime = block.match(/<getlastmodified>([^<]+)<\/getlastmodified>/);
      const size = block.match(/<getcontentlength>([^<]+)<\/getcontentlength>/);
      const etag = block.match(/<getetag>([^<]+)<\/getetag>/);
      entries.push({
        path: this.normalizePath(href, baseDir),
        size: size ? Number(size[1]) : 0,
        mtime: mtime ? Date.parse(mtime[1]) : 0,
        etag: etag ? etag[1].replace(/"/g, "") : undefined,
        status: "remote-only",
      });
    }
    return entries;
  }

  private normalizePath(href: string, baseDir: string): string {
    // Quitar la parte del host
    const u = new URL(href, "http://localhost");
    let p = u.pathname;
    // Quitar el basePath
    if (this.config.basePath && p.startsWith(this.config.basePath)) {
      p = p.slice(this.config.basePath.length);
    }
    if (baseDir && p.startsWith(baseDir)) {
      p = p.slice(baseDir.length);
    }
    return p.replace(/^\/+/, "");
  }
}

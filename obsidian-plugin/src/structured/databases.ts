// databases.ts: gestión de "databases" Notion-style.
//
// Una database es una carpeta del vault + un schema (qué propiedades tiene
// el frontmatter de cada nota). El plugin las guarda en _M-NEXUS/databases/
// como archivos JSON.
//
// Sync con backend: cuando hay conexión, los schemas también se sincronizan
// (para que los demás devices las vean).

import { App, TFile, TFolder, Vault } from "obsidian";
import type { DatabaseSchema, NoteRow, PropertySchema, ViewSchema } from "./schema";
import * as yaml from "yaml";

const DB_DIR = "_M-NEXUS/databases";

function dbFilePath(vault: Vault, name: string): string {
  return `${DB_DIR}/${name}.json`;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class DatabaseManager {
  constructor(private app: App) {}

  private async ensureDir(): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(DB_DIR);
    if (!folder) {
      await this.app.vault.createFolder(DB_DIR);
    }
  }

  /** Lista todas las databases del vault. */
  async list(): Promise<DatabaseSchema[]> {
    await this.ensureDir();
    const folder = this.app.vault.getAbstractFileByPath(DB_DIR) as TFolder;
    if (!folder || !folder.children) return [];
    const dbs: DatabaseSchema[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "json") {
        try {
          const content = await this.app.vault.read(child);
          dbs.push(JSON.parse(content));
        } catch (err) {
          console.warn(`[mnexus] failed to read db ${child.path}: ${err.message}`);
        }
      }
    }
    return dbs;
  }

  /** Carga una database por ID. */
  async get(id: string): Promise<DatabaseSchema | null> {
    const dbs = await this.list();
    return dbs.find((d) => d.id === id) ?? null;
  }

  /** Crea una nueva database. */
  async create(input: {
    name: string;
    folder: string;
    properties: PropertySchema[];
    titleProperty?: string;
    icon?: string;
    color?: string;
  }): Promise<DatabaseSchema> {
    if (!input.name || !input.folder || !input.properties?.length) {
      throw new Error("name, folder, and at least one property are required");
    }
    if (input.properties.length > 20) {
      throw new Error("max 20 properties per database");
    }
    await this.ensureDir();
    const now = Date.now();
    const schema: DatabaseSchema = {
      id: `db-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name,
      folder: input.folder,
      properties: input.properties,
      titleProperty: input.titleProperty ?? input.properties[0].name,
      icon: input.icon,
      color: input.color,
      createdAt: now,
      updatedAt: now,
    };
    // Crear la carpeta si no existe
    if (!this.app.vault.getAbstractFileByPath(input.folder)) {
      await this.app.vault.createFolder(input.folder);
    }
    await this.app.vault.create(
      dbFileName(this.app.vault, input.name),
      JSON.stringify(schema, null, 2)
    );
    return schema;
  }

  /** Actualiza el schema de una database. */
  async update(id: string, patch: Partial<DatabaseSchema>): Promise<DatabaseSchema> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Database not found: ${id}`);
    const updated: DatabaseSchema = {
      ...existing,
      ...patch,
      id: existing.id, // id no se puede cambiar
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    // Si cambió el nombre, renombrar el archivo
    if (patch.name && patch.name !== existing.name) {
      const oldFile = this.app.vault.getAbstractFileByPath(
        `${DB_DIR}/${safeFileName(existing.name)}.json`
      );
      if (oldFile instanceof TFile) {
        await this.app.vault.rename(oldFile, `${DB_DIR}/${safeFileName(patch.name)}.json`);
      }
    }
    await this.app.vault.adapter.write(
      `${DB_DIR}/${safeFileName(updated.name)}.json`,
      JSON.stringify(updated, null, 2)
    );
    return updated;
  }

  /** Borra una database. NO borra las notas. */
  async delete(id: string): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;
    const file = this.app.vault.getAbstractFileByPath(
      `${DB_DIR}/${safeFileName(existing.name)}.json`
    );
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }

  /** Lista las notas de una database (las que están en la carpeta). */
  async listRows(db: DatabaseSchema): Promise<NoteRow[]> {
    const folder = this.app.vault.getAbstractFileByPath(db.folder);
    if (!(folder instanceof TFolder) || !folder.children) return [];
    const rows: NoteRow[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      try {
        const content = await this.app.vault.read(child);
        const { frontmatter, body } = splitFrontmatter(content);
        const stat = child.stat;
        rows.push({
          path: child.path,
          name: child.basename,
          properties: frontmatter,
          body: body.trim(),
          cover: typeof frontmatter.cover === "string" ? frontmatter.cover : undefined,
          icon: typeof frontmatter.icon === "string" ? frontmatter.icon : undefined,
          createdAt: stat.ctime,
          updatedAt: stat.mtime,
        });
      } catch (err) {
        console.warn(`[mnexus] failed to read row ${child.path}: ${err.message}`);
      }
    }
    return rows;
  }

  /** Crea una nueva nota (row) en la database. */
  async createRow(db: DatabaseSchema, properties: Record<string, unknown>, body = ""): Promise<NoteRow> {
    // Genera un nombre de archivo basado en titleProperty
    const title = (properties[db.titleProperty] as string) ?? "Untitled";
    const safeName = safeFileName(String(title).slice(0, 100));
    const path = `${db.folder}/${safeName}.md`;
    const frontmatter = { ...properties };
    const content = "---\n" + yaml.stringify(frontmatter).trimEnd() + "\n---\n" + body;
    const file = await this.app.vault.create(path, content);
    return {
      path: file.path,
      name: file.basename,
      properties: frontmatter,
      body: body.trim(),
      cover: typeof frontmatter.cover === "string" ? frontmatter.cover : undefined,
      icon: typeof frontmatter.icon === "string" ? frontmatter.icon : undefined,
      createdAt: file.stat.ctime,
      updatedAt: file.stat.mtime,
    };
  }

  /** Actualiza una nota (row). Solo cambia el frontmatter, no el body. */
  async updateRow(path: string, properties: Record<string, unknown>): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Row not found: ${path}`);
    const content = await this.app.vault.read(file);
    const { body } = splitFrontmatter(content);
    const newContent = "---\n" + yaml.stringify(properties).trimEnd() + "\n---\n" + body;
    await this.app.vault.modify(file, newContent);
  }

  /** Borra una nota. */
  async deleteRow(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.vault.delete(file);
    }
  }
}

function dbFileName(vault: Vault, name: string): string {
  return `${DB_DIR}/${safeFileName(name)}.json`;
}

/** Split frontmatter del contenido. Retorna frontmatter (object) y body (string). */
export function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = (yaml.parse(match[1]) ?? {}) as Record<string, unknown>;
  return { frontmatter: fm, body: match[2] };
}

// BackupManagerModal — vista de backups con drag-and-drop.
//
// v0.28: FEATURES
//   - Lista backups locales + remotos (server)
//   - Drag & drop de un .zip desde el OS → upload al server
//   - Drag & drop de un .zip desde la lista → download al OS
//   - Crear backup manual (1-click)
//   - Restaurar desde local o remoto
//   - Eliminar backups
//   - Indicador de tamaño, fecha, kind

import { App, Modal, Notice, TFile } from "obsidian";
import { LocalBackup, BackupEntry } from "../backup/localBackup";
import { HTTPClient } from "../server/client";
import { AuthCredentials, BackupListItem } from "../server/types";
import { sha256Hex } from "../server/client";
import { Logger } from "../utils/logger";
import { formatBytes, formatRelativeDate } from "../utils/format";

export interface BackupManagerDeps {
  local: LocalBackup;
  client: () => HTTPClient | null;
  creds: () => AuthCredentials | null;
  log: Logger;
}

export class BackupManagerModal extends Modal {
  private localBackups: BackupEntry[] = [];
  private remoteBackups: BackupListItem[] = [];
  private loading = true;
  private dropZone: HTMLElement | null = null;

  constructor(app: App, private deps: BackupManagerDeps) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mnexus-backup-modal");

    // Header
    const header = contentEl.createDiv({ cls: "mnexus-backup-header" });
    header.createEl("h2", { text: "📦 Backups" });

    const actions = header.createDiv({ cls: "mnexus-backup-actions" });
    const createBtn = actions.createEl("button", { text: "➕ Backup manual" });
    createBtn.addClass("mod-cta");
    createBtn.onclick = () => this.createBackup();

    const refreshBtn = actions.createEl("button", { text: "🔄 Refrescar" });
    refreshBtn.onclick = () => this.refresh();

    // Drop zone
    this.dropZone = contentEl.createDiv({ cls: "mnexus-backup-dropzone" });
    this.dropZone.createEl("p", {
      text: "🪂 Arrastra un .zip aquí para subirlo al servidor",
      cls: "mnexus-backup-dropzone-text",
    });
    this.setupDragAndDrop(this.dropZone);

    // Local backups
    const localSection = contentEl.createDiv({ cls: "mnexus-backup-section" });
    localSection.createEl("h3", { text: "💾 Backups locales" });
    this.localListEl = localSection.createDiv({ cls: "mnexus-backup-list" });

    // Remote backups
    const remoteSection = contentEl.createDiv({ cls: "mnexus-backup-section" });
    remoteSection.createEl("h3", { text: "☁️ Backups en el servidor" });
    this.remoteListEl = remoteSection.createDiv({ cls: "mnexus-backup-list" });

    await this.refresh();
  }

  async onClose() {
    this.contentEl.empty();
  }

  private localListEl!: HTMLElement;
  private remoteListEl!: HTMLElement;

  private async refresh() {
    this.loading = true;
    this.localListEl.empty();
    this.remoteListEl.empty();
    this.localListEl.createEl("p", { text: "Cargando…", cls: "mnexus-backup-loading" });
    this.remoteListEl.createEl("p", { text: "Cargando…", cls: "mnexus-backup-loading" });
    try {
      this.localBackups = await this.deps.local.list();
      const client = this.deps.client();
      const creds = this.deps.creds();
      if (client && creds) {
        try {
          this.remoteBackups = await client.listBackups(creds);
        } catch (e) {
          this.remoteBackups = [];
          this.deps.log.warn(`No se pudo listar backups remotos: ${(e as Error).message}`);
        }
      } else {
        this.remoteBackups = [];
      }
    } finally {
      this.loading = false;
      this.renderLists();
    }
  }

  private renderLists() {
    this.localListEl.empty();
    this.remoteListEl.empty();

    if (this.localBackups.length === 0) {
      this.localListEl.createEl("p", {
        text: "No hay backups locales. Crea uno con el botón de arriba.",
        cls: "mnexus-empty",
      });
    } else {
      for (const b of this.localBackups) {
        this.localListEl.appendChild(this.renderLocalEntry(b));
      }
    }

    if (this.remoteBackups.length === 0) {
      this.remoteListEl.createEl("p", {
        text: "No hay backups en el servidor. Sube uno arrastrándolo o créalo local y se subirá auto.",
        cls: "mnexus-empty",
      });
    } else {
      for (const b of this.remoteBackups) {
        this.remoteListEl.appendChild(this.renderRemoteEntry(b));
      }
    }
  }

  private renderLocalEntry(b: BackupEntry): HTMLElement {
    const card = createDiv({ cls: "mnexus-backup-card" });
    card.draggable = true;
    card.createEl("div", {
      text: `${b.kind === "manual" ? "🖐" : b.kind === "emergency" ? "🚨" : "🤖"} ${b.id}`,
      cls: "mnexus-backup-card-title",
    });
    card.createEl("div", {
      text: `${formatBytes(b.size)} · ${b.fileCount} archivos · ${formatRelativeDate(b.createdAt)}`,
      cls: "mnexus-backup-card-meta",
    });
    if (b.durationMs) {
      card.createEl("div", {
        text: `Creado en ${b.durationMs}ms`,
        cls: "mnexus-backup-card-meta mnexus-backup-card-meta-secondary",
      });
    }
    const actions = card.createDiv({ cls: "mnexus-backup-card-actions" });
    const restoreBtn = actions.createEl("button", { text: "↩ Restaurar" });
    restoreBtn.onclick = () => this.restoreLocal(b);
    const uploadBtn = actions.createEl("button", { text: "☁ Subir" });
    uploadBtn.onclick = () => this.uploadLocal(b);
    const deleteBtn = actions.createEl("button", { text: "🗑 Borrar" });
    deleteBtn.addClass("mnexus-btn-danger");
    deleteBtn.onclick = () => this.deleteLocal(b);

    // Drag-and-drop: arrastrar el card para descargar
    card.addEventListener("dragstart", (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/x-mnexus-backup", b.id);
      e.dataTransfer.setData("DownloadURL", `application/zip:${b.id}.zip:data:application/zip;base64,`);
    });
    return card;
  }

  private renderRemoteEntry(b: BackupListItem): HTMLElement {
    const card = createDiv({ cls: "mnexus-backup-card" });
    card.draggable = true;
    card.createEl("div", {
      text: `${b.kind === "manual" ? "🖐" : b.kind === "emergency" ? "🚨" : "🤖"} ${b.id}`,
      cls: "mnexus-backup-card-title",
    });
    card.createEl("div", {
      text: `${formatBytes(b.size)} · ${b.fileCount} archivos · ${formatRelativeDate(b.uploadedAt)}`,
      cls: "mnexus-backup-card-meta",
    });
    card.createEl("div", {
      text: `SHA-256: ${b.sha256.slice(0, 12)}…`,
      cls: "mnexus-backup-card-meta mnexus-backup-card-meta-secondary",
    });
    const actions = card.createDiv({ cls: "mnexus-backup-card-actions" });
    const downloadBtn = actions.createEl("button", { text: "⬇ Descargar" });
    downloadBtn.onclick = () => this.downloadRemote(b);
    const restoreBtn = actions.createEl("button", { text: "↩ Restaurar" });
    restoreBtn.onclick = () => this.restoreRemote(b);
    const deleteBtn = actions.createEl("button", { text: "🗑 Borrar" });
    deleteBtn.addClass("mnexus-btn-danger");
    deleteBtn.onclick = () => this.deleteRemote(b);
    return card;
  }

  // ─── Acciones ─────────────────────────────────────────────────────

  private async createBackup() {
    new Notice("Creando backup…");
    try {
      const entry = await this.deps.local.create({ kind: "manual" });
      new Notice(`✅ Backup creado: ${entry.fileCount} archivos, ${formatBytes(entry.size)} en ${entry.durationMs}ms`);
      await this.refresh();
    } catch (e) {
      new Notice(`❌ Error al crear backup: ${(e as Error).message}`);
    }
  }

  private async restoreLocal(b: BackupEntry) {
    if (!confirm(`¿Restaurar ${b.id}? Esto sobrescribirá archivos del vault.`)) return;
    try {
      const r = await this.deps.local.restore(b.id);
      new Notice(`↩ Restaurado: ${r.restored} archivos${r.skipped ? `, ${r.skipped} errores` : ""}`);
    } catch (e) {
      new Notice(`❌ Error: ${(e as Error).message}`);
    }
  }

  private async uploadLocal(b: BackupEntry) {
    const client = this.deps.client();
    const creds = this.deps.creds();
    if (!client || !creds) {
      new Notice("❌ No hay credenciales de servidor configuradas");
      return;
    }
    new Notice("Subiendo backup…");
    try {
      const bytes = await this.deps.local.readBytes(b.id);
      const res = await client.uploadBackup(creds, {
        zipBytes: bytes,
        kind: b.kind,
        vaultPath: b.path,
        note: b.note,
        fileCount: b.fileCount,
      });
      new Notice(`☁ Subido: ${res.id} (${formatBytes(res.size)} en ${res.serverDurationMs}ms)`);
      await this.refresh();
    } catch (e) {
      new Notice(`❌ Error al subir: ${(e as Error).message}`);
    }
  }

  private async deleteLocal(b: BackupEntry) {
    if (!confirm(`¿Borrar backup local ${b.id}?`)) return;
    try {
      await this.deps.local.prune();
      new Notice("🗑 Backup borrado");
      await this.refresh();
    } catch (e) {
      new Notice(`❌ Error: ${(e as Error).message}`);
    }
  }

  private async downloadRemote(b: BackupListItem) {
    const client = this.deps.client();
    const creds = this.deps.creds();
    if (!client || !creds) {
      new Notice("❌ No hay credenciales");
      return;
    }
    new Notice("Descargando…");
    try {
      const bytes = await client.downloadBackup(creds, b.id);
      // Crear blob URL y disparar descarga
      // @ts-ignore — Blob en Electron/Node 18+
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${b.id}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      new Notice(`⬇ Descargado: ${b.id}.zip`);
    } catch (e) {
      new Notice(`❌ Error: ${(e as Error).message}`);
    }
  }

  private async restoreRemote(b: BackupListItem) {
    if (!confirm(`¿Descargar y restaurar ${b.id}? Esto sobrescribirá archivos del vault.`)) return;
    const client = this.deps.client();
    const creds = this.deps.creds();
    if (!client || !creds) {
      new Notice("❌ No hay credenciales");
      return;
    }
    new Notice("Descargando y restaurando…");
    try {
      const bytes = await client.downloadBackup(creds, b.id);
      // Guardar en local y restaurar
      // Por ahora: crear un backup entry local con los bytes y restaurar
      const id = `restored-${b.id}-${Date.now()}`;
      const filename = `${id}.mnexus-backup`;
      const path = `.mnexus-backups/${filename}`;
      await this.deps.local["app"].vault.adapter.writeBinary(path, bytes.buffer as ArrayBuffer);
      const r = await this.deps.local.restore(id);
      new Notice(`↩ Restaurado: ${r.restored} archivos`);
    } catch (e) {
      new Notice(`❌ Error: ${(e as Error).message}`);
    }
  }

  private async deleteRemote(b: BackupListItem) {
    if (!confirm(`¿Borrar backup remoto ${b.id}?`)) return;
    const client = this.deps.client();
    const creds = this.deps.creds();
    if (!client || !creds) return;
    try {
      const url = client["buildUrl"](`/api/v1/backup/${b.id}`);
      // @ts-ignore — acceso privado para DELETE; alternativa: añadir método al cliente
      await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${creds.authToken}`,
          "X-Device-Id": creds.deviceId,
        },
      });
      new Notice("🗑 Backup remoto borrado");
      await this.refresh();
    } catch (e) {
      new Notice(`❌ Error: ${(e as Error).message}`);
    }
  }

  // ─── Drag & Drop ──────────────────────────────────────────────────

  private setupDragAndDrop(zone: HTMLElement) {
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      zone.addClass("mnexus-backup-dropzone-active");
    });
    zone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.removeClass("mnexus-backup-dropzone-active");
    });
    zone.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.removeClass("mnexus-backup-dropzone-active");
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!file.name.endsWith(".zip")) {
        new Notice("❌ Solo se aceptan archivos .zip");
        return;
      }
      await this.handleDroppedFile(file);
    });
  }

  private async handleDroppedFile(file: File) {
    const client = this.deps.client();
    const creds = this.deps.creds();
    if (!client || !creds) {
      new Notice("❌ No hay credenciales de servidor configuradas");
      return;
    }
    new Notice(`Subiendo ${file.name} (${formatBytes(file.size)})…`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      // Verificar magic bytes ZIP
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        new Notice("❌ El archivo no es un ZIP válido");
        return;
      }
      const sha = await sha256Hex(bytes);
      const metadata = {
        kind: "manual" as const,
        vaultPath: "imported",
        note: `Importado por drag-and-drop: ${file.name}`,
        fileCount: 0,
        sha256: sha,
        imported: true,
        originalName: file.name,
      };
      const headers: Record<string, string> = {
        "Content-Type": "application/zip",
        "Authorization": `Bearer ${creds.authToken}`,
        "X-Device-Id": creds.deviceId,
        "X-Backup-Metadata": JSON.stringify(metadata),
      };
      const url = client["buildUrl"]("/api/v1/backup/upload");
      const res = await fetch(url, { method: "POST", headers, body: bytes });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { id: string; size: number; serverDurationMs: number };
      new Notice(`✅ Subido: ${data.id} en ${data.serverDurationMs}ms`);
      await this.refresh();
    } catch (e) {
      new Notice(`❌ Error al subir: ${(e as Error).message}`);
    }
  }
}

// Helper para evitar el import de obsidian.TFile en este archivo
function createDiv(opts: { cls?: string; text?: string }): HTMLElement {
  const d = document.createElement("div");
  if (opts.cls) d.addClass(opts.cls);
  if (opts.text) d.textContent = opts.text;
  return d;
}
// Suppress unused import warning (TFile se usa en plugins de tipo)
export type { TFile };

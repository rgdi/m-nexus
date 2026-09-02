// ServerControlModal: panel de control de la conexión con el servidor y backups.

import { App, Modal } from "obsidian";
import { ConnectionManager } from "../server/connectionManager";
import { OfflineQueue } from "../server/offlineQueue";
import { BackupManager } from "../backup/manager";
import { LocalBackup } from "../backup/localBackup";
import { ServerStatus } from "../server/types";

const STATUS_DESCRIPTION: Record<ServerStatus, string> = {
  disconnected: "No estás conectado al servidor. Pulsa Conectar para empezar.",
  connecting: "Estableciendo conexión…",
  connected: "Conexión activa. Los cambios se sincronizan automáticamente.",
  offline: "Sin conexión a internet. Los cambios se guardan en la cola local.",
  error: "Error de conexión. Reintentando automáticamente…",
};

export class ServerControlModal extends Modal {
  private statusEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private backupsEl: HTMLElement | null = null;
  private queueEl: HTMLElement | null = null;
  private unsubscribe: (() => void)[] = [];

  constructor(
    app: App,
    private connection: ConnectionManager,
    private queue: OfflineQueue,
    private backup: BackupManager,
    private localBackup: LocalBackup
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "600px";
    contentEl.createEl("h2", { text: "🌐 Servidor central M-NEXUS" });

    this.statusEl = contentEl.createDiv({ cls: "mnexus-server-status" });
    this.statusEl.style.cssText = "padding:12px;border-radius:6px;background:var(--background-secondary);margin:8px 0;";

    const actions = contentEl.createDiv({ cls: "mnexus-server-actions" });
    actions.style.cssText = "display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;";

    const connectBtn = actions.createEl("button", { text: "🔌 Conectar" });
    connectBtn.onclick = () => this.connection.connect();
    const disconnectBtn = actions.createEl("button", { text: "⛔ Desconectar" });
    disconnectBtn.onclick = () => this.connection.disconnect();
    const syncBtn = actions.createEl("button", { text: "🔄 Sincronizar ahora" });
    syncBtn.onclick = async () => {
      syncBtn.textContent = "Sincronizando…";
      try {
        await this.connection.syncNow();
      } catch (e) {
        alert("Error: " + (e as Error).message);
      } finally {
        syncBtn.textContent = "🔄 Sincronizar ahora";
      }
    };
    const backupBtn = actions.createEl("button", { text: "💾 Backup ahora" });
    backupBtn.onclick = async () => {
      backupBtn.textContent = "Creando…";
      try {
        const entry = await this.backup.runManual("manual desde modal");
        alert(`Backup creado: ${entry.id} (${entry.fileCount} archivos)`);
        await this.renderBackups();
      } catch (e) {
        alert("Error: " + (e as Error).message);
      } finally {
        backupBtn.textContent = "💾 Backup ahora";
      }
    };
    const emergencyBtn = actions.createEl("button", { text: "🚨 Backup de emergencia" });
    emergencyBtn.onclick = async () => {
      const reason = prompt("Motivo del backup de emergencia:", "manual");
      if (reason === null) return;
      emergencyBtn.textContent = "Creando…";
      try {
        const entry = await this.backup.runEmergency(reason);
        alert(entry ? `Backup de emergencia creado: ${entry.id}` : "Otro backup en curso");
        await this.renderBackups();
      } catch (e) {
        alert("Error: " + (e as Error).message);
      } finally {
        emergencyBtn.textContent = "🚨 Backup de emergencia";
      }
    };

    // Detalle + cola
    this.detailEl = contentEl.createDiv();
    this.queueEl = contentEl.createDiv();
    this.backupsEl = contentEl.createDiv();

    this.unsubscribe.push(
      this.connection.events.on("status", () => this.renderStatus()),
      this.connection.events.on("synced", () => this.renderStatus())
    );

    this.renderStatus();
    this.renderQueue();
    this.renderBackups();
  }

  onClose() {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.contentEl.empty();
  }

  private renderStatus() {
    if (!this.statusEl) return;
    this.statusEl.empty();
    const status = this.connection.getStatus();
    const title = this.statusEl.createEl("strong", { text: `Estado: ${status}` });
    title.style.fontSize = "1.1em";
    this.statusEl.createEl("p", { text: STATUS_DESCRIPTION[status], cls: "mnexus-label" });
    if (this.connection.getLastSnapshotVersion() !== null) {
      this.statusEl.createEl("p", {
        text: `Último snapshot: v${this.connection.getLastSnapshotVersion()}`,
        cls: "mnexus-label",
      });
    }
  }

  private async renderQueue() {
    if (!this.queueEl) return;
    this.queueEl.empty();
    this.queueEl.createEl("h3", { text: "📥 Cola offline" });
    const stats = await this.queue.stats();
    if (stats.pending === 0 && stats.archived === 0) {
      this.queueEl.createEl("p", { text: "Cola vacía. Todos los cambios están sincronizados.", cls: "mnexus-label" });
      return;
    }
    const info = this.queueEl.createEl("p", {
      text: `${stats.pending} pendientes · ${stats.archived} archivados · ${
        stats.oldestPendingAge > 0 ? Math.round(stats.oldestPendingAge / 60000) + " min de antigüedad" : "—"
      }`,
      cls: "mnexus-label",
    });
    const clearBtn = this.queueEl.createEl("button", { text: "🗑 Vaciar cola" });
    clearBtn.onclick = async () => {
      if (!confirm("¿Vaciar la cola? Los cambios pendientes se perderán.")) return;
      await this.queue.clear();
      await this.renderQueue();
    };
  }

  private async renderBackups() {
    if (!this.backupsEl) return;
    this.backupsEl.empty();
    this.backupsEl.createEl("h3", { text: "💾 Backups locales" });
    const list = await this.localBackup.list();
    if (list.length === 0) {
      this.backupsEl.createEl("p", { text: "Sin backups aún. Pulsa \"Backup ahora\" para crear uno.", cls: "mnexus-label" });
      return;
    }
    const ul = this.backupsEl.createEl("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0;";
    for (const b of list.slice(0, 10)) {
      const li = ul.createEl("li");
      li.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--background-modifier-border);";
      const info = li.createDiv();
      const kind = b.kind === "emergency" ? "🚨" : b.kind === "manual" ? "✋" : "⏰";
      info.createEl("span", { text: `${kind} ${b.id} ` });
      info.createEl("small", { text: `${Math.round(b.size / 1024)} KB · ${new Date(b.createdAt).toLocaleString()}`, cls: "mnexus-label" });
      const actions = li.createDiv();
      const restoreBtn = actions.createEl("button", { text: "↩ Restaurar (dry-run)" });
      restoreBtn.onclick = async () => {
        if (!confirm(`¿Simular restauración de ${b.id}? (no modifica nada)`)) return;
        const r = await this.localBackup.restore(b.id, { dryRun: true });
        alert(`Dry-run: ${r.restored} archivos se restaurarían. Errores: ${r.errors.length}`);
      };
      const realRestoreBtn = actions.createEl("button", { text: "⚠ Restaurar de verdad" });
      realRestoreBtn.onclick = async () => {
        if (!confirm(`⚠ ATENCIÓN: ${b.id} SOBREESCRIBIRÁ archivos. ¿Continuar?`)) return;
        const r = await this.localBackup.restore(b.id);
        alert(`Restaurado: ${r.restored} archivos. Errores: ${r.errors.length}`);
      };
    }
  }
}

// ServerStatusBadge: pequeño indicador en la barra de estado que muestra
// el estado de la conexión con el servidor central. Click abre modal
// de detalles con sync manual, backup, etc.

import { App, setIcon } from "obsidian";
import { ConnectionManager } from "../server/connectionManager";
import { OfflineQueue } from "../server/offlineQueue";
import { BackupManager } from "../backup/manager";
import { LocalBackup } from "../backup/localBackup";
import { ServerStatus } from "../server/types";
import { ServerControlModal } from "./serverControlModal";

const STATUS_LABEL: Record<ServerStatus, string> = {
  disconnected: "Desconectado",
  connecting: "Conectando…",
  connected: "Conectado",
  offline: "Sin red",
  error: "Error",
};

const STATUS_ICON: Record<ServerStatus, string> = {
  disconnected: "circle-slash",
  connecting: "loader",
  connected: "check-circle",
  offline: "wifi-off",
  error: "alert-triangle",
};

const STATUS_COLOR: Record<ServerStatus, string> = {
  disconnected: "var(--text-muted)",
  connecting: "var(--text-accent)",
  connected: "var(--text-success)",
  offline: "var(--text-warning)",
  error: "var(--text-error)",
};

export class ServerStatusBadge {
  private el: HTMLElement | null = null;
  private unsubscribe: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private connection: ConnectionManager,
    private queue: OfflineQueue,
    private backup: BackupManager,
    private localBackup: LocalBackup
  ) {}

  mount() {
    if (this.el) return;
    this.el = this.container.createDiv({ cls: "mnexus-server-badge" });
    this.el.style.cssText = "display:flex;align-items:center;gap:4px;padding:0 8px;cursor:pointer;border-radius:4px;";
    this.el.addEventListener("click", () => this.openDetails());
    this.unsubscribe.push(
      this.connection.events.on("status", () => this.render()),
      this.connection.events.on("synced", () => this.render())
    );
    this.render();
  }

  unmount() {
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.el?.remove();
    this.el = null;
  }

  private async render() {
    if (!this.el) return;
    const status = this.connection.getStatus();
    this.el.empty();
    const icon = this.el.createSpan({ cls: "mnexus-server-badge-icon" });
    setIcon(icon, STATUS_ICON[status]);
    icon.style.color = STATUS_COLOR[status];
    const label = this.el.createSpan({ text: STATUS_LABEL[status] });
    label.style.cssText = "font-size: var(--font-ui-smaller); color: var(--text-muted);";
    if (status === "connected") label.style.color = "var(--text-success)";
    if (status === "error" || status === "offline") label.style.color = "var(--text-warning)";

    // Indicador de cola pendiente
    const stats = await this.queue.stats();
    if (stats.pending > 0) {
      const badge = this.el.createSpan({ text: String(stats.pending), cls: "mnexus-server-badge-queue" });
      badge.style.cssText = "background: var(--text-accent); color: var(--text-on-accent); border-radius: 8px; padding: 0 6px; font-size: 10px; font-weight: 600;";
    }
  }

  private openDetails() {
    new ServerControlModal(
      (this.container as unknown as { app: App }).app,
      this.connection,
      this.queue,
      this.backup,
      this.localBackup
    ).open();
  }
}

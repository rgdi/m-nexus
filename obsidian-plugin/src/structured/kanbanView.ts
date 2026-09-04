// kanbanView.ts: renderiza una vista kanban (Notion-style).
//
// v0.33: agrupa rows por una propiedad (ej. "status") y los muestra en columnas.

import { App, ItemView, WorkspaceLeaf } from "obsidian";
import type { DatabaseSchema, NoteRow, ViewConfig } from "./schema";
import type { DatabaseManager } from "./databases";
import { groupBy } from "./validate";

export const KANBAN_VIEW_TYPE = "mnexus-database-kanban";

export class KanbanView extends ItemView {
  private database: DatabaseSchema;
  private config: Extract<ViewConfig, { type: "kanban" }>;
  private rows: NoteRow[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private dbManager: DatabaseManager,
    database: DatabaseSchema,
    config: Extract<ViewConfig, { type: "kanban" }>
  ) {
    super(leaf);
    this.database = database;
    this.config = config;
  }

  getViewType(): string {
    return KANBAN_VIEW_TYPE;
  }
  getDisplayText(): string {
    return `🗂 ${this.database.name}`;
  }
  getIcon(): string {
    return "kanban";
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
  async refresh(): Promise<void> {
    this.rows = await this.dbManager.listRows(this.database);
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass("mnexus-kanban-view");

    el.createEl("h2", { text: this.database.name });

    const grouped = groupBy(this.rows, this.config.groupBy);

    // Si showEmptyGroups, añadir columnas vacías de options no usados
    const schema = this.database.properties.find(
      (p) => p.name === this.config.groupBy
    );
    if (this.config.showEmptyGroups && schema?.options) {
      for (const opt of schema.options) {
        if (!grouped.has(opt)) grouped.set(opt, []);
      }
    }

    const board = el.createDiv({ cls: "mnexus-kanban-board" });
    for (const [group, rows] of grouped) {
      const col = board.createDiv({ cls: "mnexus-kanban-col" });
      const header = col.createDiv({ cls: "mnexus-kanban-col-header" });
      header.createEl("strong", { text: group || "(sin grupo)" });
      header.createEl("span", { text: ` (${rows.length})` });
      for (const row of rows) {
        const card = col.createDiv({ cls: "mnexus-kanban-card" });
        if (row.icon) card.createEl("span", { text: row.icon + " " });
        const link = card.createEl("a", { text: row.name, href: "#" });
        link.onclick = (e) => {
          e.preventDefault();
          this.app.workspace.openLinkText(row.path, "", false);
        };
        if (this.config.cardProperties.length > 0) {
          const meta = card.createDiv({ cls: "mnexus-kanban-card-meta" });
          for (const cp of this.config.cardProperties) {
            const v = row.properties[cp];
            if (v !== null && v !== undefined && v !== "") {
              meta.createEl("span", { text: `${cp}: ${v}` });
            }
          }
        }
      }
    }
  }
}

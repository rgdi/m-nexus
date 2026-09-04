// tableView.ts: renderiza una vista "table" de una database (Notion-style).
//
// v0.33: tabla HTML con todas las propiedades. Click en el nombre abre la nota.
// Se inyecta en el workspace de Obsidian como view efímera (no persistente).

import { App, ItemView, WorkspaceLeaf } from "obsidian";
import type { DatabaseSchema, NoteRow, ViewConfig } from "./schema";
import type { DatabaseManager } from "./databases";
import { applyFilters, applySorts } from "./validate";

export const TABLE_VIEW_TYPE = "mnexus-database-table";

export class TableView extends ItemView {
  private database: DatabaseSchema;
  private config: Extract<ViewConfig, { type: "table" }>;
  private rows: NoteRow[] = [];
  private filters: Array<{ property: string; op: string; value: unknown }> = [];
  private sort: Array<{ property: string; direction: "asc" | "desc" }> = [];

  constructor(
    leaf: WorkspaceLeaf,
    private dbManager: DatabaseManager,
    database: DatabaseSchema,
    config: Extract<ViewConfig, { type: "table" }>
  ) {
    super(leaf);
    this.database = database;
    this.config = config;
  }

  getViewType(): string {
    return TABLE_VIEW_TYPE;
  }
  getDisplayText(): string {
    return `📊 ${this.database.name}`;
  }
  getIcon(): string {
    return "table";
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

  setFilters(filters: typeof this.filters): void {
    this.filters = filters;
    this.render();
  }
  setSort(sort: typeof this.sort): void {
    this.sort = sort;
    this.render();
  }

  private render(): void {
    const el = this.contentEl;
    el.empty();
    el.addClass("mnexus-table-view");

    const header = el.createDiv({ cls: "mnexus-view-header" });
    header.createEl("h2", { text: this.database.name });
    if (this.database.icon) header.createEl("span", { text: this.database.icon });

    // Filter bar
    const filterBar = el.createDiv({ cls: "mnexus-filter-bar" });
    const addFilterBtn = filterBar.createEl("button", { text: "+ Filtro" });
    addFilterBtn.onclick = () => this.promptAddFilter();
    if (this.filters.length) {
      const clearBtn = filterBar.createEl("button", { text: "Limpiar" });
      clearBtn.onclick = () => {
        this.filters = [];
        this.render();
      };
    }

    // Apply filters + sort
    let rows = this.rows;
    rows = applyFilters(rows, this.filters);
    rows = applySorts(rows, this.sort);

    // Table
    const table = el.createEl("table", { cls: "mnexus-data-table" });
    const thead = table.createTHead();
    const trh = thead.createTr();
    trh.createTh({ text: "📄" });
    for (const prop of this.database.properties) {
      if (this.config.hiddenColumns.includes(prop.name)) continue;
      const th = trh.createTh({ text: prop.name });
      th.title = `${prop.type}${prop.options ? " (opciones: " + prop.options.join(", ") + ")" : ""}`;
    }

    const tbody = table.createTBody();
    if (rows.length === 0) {
      const tr = tbody.createTr();
      const td = tr.createTd({ text: "Sin notas. Crea una nueva." });
      td.colSpan = this.database.properties.length + 1;
    } else {
      for (const row of rows) {
        const tr = tbody.createTr();
        const iconCell = tr.createTd();
        if (row.icon) iconCell.setText(row.icon);
        else iconCell.setText("📄");
        for (const prop of this.database.properties) {
          if (this.config.hiddenColumns.includes(prop.name)) continue;
          const v = row.properties[prop.name];
          const td = tr.createTd();
          if (prop.name === this.database.titleProperty) {
            const link = td.createEl("a", { text: row.name, href: "#" });
            link.onclick = (e) => {
              e.preventDefault();
              this.app.workspace.openLinkText(row.path, "", false);
            };
          } else {
            td.setText(this.formatValue(v, prop.type));
          }
        }
      }
    }

    // Add row button
    const addRow = el.createEl("button", { text: "+ Nueva nota" });
    addRow.onclick = () => this.promptNewRow();
  }

  private formatValue(v: unknown, type: string): string {
    if (v === null || v === undefined) return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (type === "boolean") return v ? "✅" : "❌";
    if (type === "date") return String(v).slice(0, 10);
    return String(v);
  }

  private promptAddFilter(): void {
    const prop = prompt(
      `Filtrar por propiedad (${this.database.properties.map((p) => p.name).join(", ")}):`
    );
    if (!prop) return;
    const schema = this.database.properties.find((p) => p.name === prop);
    if (!schema) {
      alert(`Propiedad no existe: ${prop}`);
      return;
    }
    const op = prompt("Operador (=, !=, >, <, contains, isEmpty):", "=");
    if (!op) return;
    const value = prompt("Valor:");
    if (value === null) return;
    this.filters.push({
      property: prop,
      op: op as "=",
      value: typeCoerce(value, schema.type),
    });
    this.render();
  }

  private promptNewRow(): void {
    const properties: Record<string, unknown> = {};
    for (const prop of this.database.properties) {
      const v = prompt(`${prop.name} (${prop.type}${prop.default !== undefined ? ", default: " + JSON.stringify(prop.default) : ""}):`, String(prop.default ?? ""));
      if (v === null) {
        if (prop.required) {
          alert(`${prop.name} es obligatorio.`);
          return;
        }
        continue;
      }
      properties[prop.name] = typeCoerce(v, prop.type);
    }
    this.dbManager.createRow(this.database, properties).then(() => this.refresh());
  }
}

function typeCoerce(v: string, type: string): unknown {
  if (type === "number") return Number(v);
  if (type === "boolean") return v === "true";
  return v;
}

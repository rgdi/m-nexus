// calendarView.ts: muestra los rows en un calendario (Notion-style).
//
// v0.33: agrupa por la propiedad de fecha y los pone en el día correspondiente.

import { App, ItemView, WorkspaceLeaf } from "obsidian";
import type { DatabaseSchema, NoteRow, ViewConfig } from "./schema";
import type { DatabaseManager } from "./databases";

export const CALENDAR_VIEW_TYPE = "mnexus-database-calendar";

export class CalendarView extends ItemView {
  private database: DatabaseSchema;
  private config: Extract<ViewConfig, { type: "calendar" }>;
  private rows: NoteRow[] = [];
  private month: Date = new Date();

  constructor(
    leaf: WorkspaceLeaf,
    private dbManager: DatabaseManager,
    database: DatabaseSchema,
    config: Extract<ViewConfig, { type: "calendar" }>
  ) {
    super(leaf);
    this.database = database;
    this.config = config;
  }

  getViewType(): string {
    return CALENDAR_VIEW_TYPE;
  }
  getDisplayText(): string {
    return `📅 ${this.database.name}`;
  }
  getIcon(): string {
    return "calendar";
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
    el.addClass("mnexus-calendar-view");

    // Header
    const header = el.createDiv({ cls: "mnexus-calendar-header" });
    const monthName = this.month.toLocaleDateString("es", {
      year: "numeric",
      month: "long",
    });
    header.createEl("h2", { text: this.database.name });
    const nav = header.createDiv();
    const prev = nav.createEl("button", { text: "◀" });
    prev.onclick = () => {
      this.month = new Date(
        this.month.getFullYear(),
        this.month.getMonth() - 1,
        1
      );
      this.render();
    };
    nav.createEl("span", { text: " " + monthName + " " });
    const next = nav.createEl("button", { text: "▶" });
    next.onclick = () => {
      this.month = new Date(
        this.month.getFullYear(),
        this.month.getMonth() + 1,
        1
      );
      this.render();
    };

    // Grid: 7 cols (lun-dom)
    const grid = el.createDiv({ cls: "mnexus-calendar-grid" });
    const dayNames = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    for (const d of dayNames) grid.createDiv({ cls: "mnexus-cal-day-header", text: d });

    // Calcular primer día del mes (con lunes primero)
    const firstOfMonth = new Date(
      this.month.getFullYear(),
      this.month.getMonth(),
      1
    );
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday=0
    const daysInMonth = new Date(
      this.month.getFullYear(),
      this.month.getMonth() + 1,
      0
    ).getDate();

    // Empty cells before month starts
    for (let i = 0; i < firstWeekday; i++) {
      grid.createDiv({ cls: "mnexus-cal-day empty" });
    }

    // Index rows by day
    const byDay = new Map<number, NoteRow[]>();
    for (const row of this.rows) {
      const dateStr = String(row.properties[this.config.dateProperty] ?? "");
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (
        d.getFullYear() === this.month.getFullYear() &&
        d.getMonth() === this.month.getMonth()
      ) {
        const day = d.getDate();
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(row);
      }
    }

    // Day cells
    for (let day = 1; day <= daysInMonth; day++) {
      const cell = grid.createDiv({ cls: "mnexus-cal-day" });
      const dayLabel = cell.createDiv({ cls: "mnexus-cal-day-num" });
      dayLabel.setText(String(day));
      if (this.config.showWeekNumbers && (day === 1 || (day - 1) % 7 === 0)) {
        const weekNum = getWeekNumber(
          new Date(this.month.getFullYear(), this.month.getMonth(), day)
        );
        cell.createDiv({ cls: "mnexus-cal-week-num", text: `S${weekNum}` });
      }
      const entries = byDay.get(day) ?? [];
      for (const row of entries) {
        const e = cell.createDiv({ cls: "mnexus-cal-entry" });
        if (row.icon) e.setText(row.icon + " ");
        const link = e.createEl("a", { text: row.name, href: "#" });
        link.onclick = (evt) => {
          evt.preventDefault();
          this.app.workspace.openLinkText(row.path, "", false);
        };
      }
    }
  }
}

function getWeekNumber(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    )
  );
}

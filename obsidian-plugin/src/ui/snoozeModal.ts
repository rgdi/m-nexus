// v0.28: Modal de Snooze — pausa flashcards/recordings/notes/recursos.
//
// UI:
//   1) Botones de duración rápida: 1d, 3d, 1w, 1m, forever
//   2) Input para duración custom ("2d 4h")
//   3) Input para fecha concreta ("2026-12-31")
//   4) Razón opcional
//   5) Botón "Pausar"

import { App, Modal, Notice } from "obsidian";
import type { SnoozeableType, SnoozeManager } from "../study/snooze";
import { parseHumanDuration, formatHumanDuration, formatExpiry } from "../study/snooze";
import { SPACING, FONT_SIZE, FONT_WEIGHT } from "./designSystem";

export interface SnoozeTarget {
  type: SnoozeableType;
  id: string;
  name: string;
}

export class SnoozeModal extends Modal {
  private duration: number | null = 7 * 24 * 3600_000; // 7 días por defecto
  private reasonInput: HTMLInputElement | null = null;
  private customDateInput: HTMLInputElement | null = null;
  private customDurationInput: HTMLInputElement | null = null;

  constructor(
    app: App,
    private manager: SnoozeManager,
    private target: SnoozeTarget,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = "min-width:500px;max-width:650px;";

    // Header
    const header = contentEl.createDiv();
    Object.assign(header.style, {
      padding: `${SPACING.lg}px`,
      background: "var(--background-secondary)",
      borderRadius: "8px",
      marginBottom: `${SPACING.lg}px`,
    });
    const title = header.createEl("h2");
    title.style.cssText = `margin:0;font-size:${FONT_SIZE.h2}px;font-weight:${FONT_WEIGHT.semibold};`;
    title.textContent = "Pausar elemento";
    const sub = header.createDiv();
    sub.style.cssText = `margin-top:${SPACING.xs}px;font-size:${FONT_SIZE.bodySm}px;color:var(--text-muted);`;
    sub.textContent = `No se incluirá en repasos, FSRS ni knowledge graph hasta que expire.`;

    // Target info
    const targetInfo = contentEl.createDiv();
    Object.assign(targetInfo.style, {
      padding: `${SPACING.md}px`,
      background: "var(--background-primary)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "6px",
      marginBottom: `${SPACING.lg}px`,
    });
    targetInfo.innerHTML = `
      <div style="font-size:${FONT_SIZE.caption}px;color:var(--text-muted);">Tipo</div>
      <div style="font-size:${FONT_SIZE.body}px;font-weight:${FONT_WEIGHT.medium};">${this.target.type}</div>
      <div style="font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-top:${SPACING.xs}px;">Elemento</div>
      <div style="font-size:${FONT_SIZE.body}px;">${this.target.name}</div>
    `;

    // Quick durations
    const lbl = contentEl.createDiv();
    lbl.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-bottom:${SPACING.xs}px;`;
    lbl.textContent = "Duración";

    const quickRow = contentEl.createDiv();
    Object.assign(quickRow.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr",
      gap: `${SPACING.xs}px`,
      marginBottom: `${SPACING.md}px`,
    });
    const quickOptions: { label: string; ms: number | null }[] = [
      { label: "1 día", ms: 1 * 24 * 3600_000 },
      { label: "3 días", ms: 3 * 24 * 3600_000 },
      { label: "1 sem", ms: 7 * 24 * 3600_000 },
      { label: "1 mes", ms: 30 * 24 * 3600_000 },
      { label: "Siempre", ms: null },
    ];
    for (const opt of quickOptions) {
      const btn = quickRow.createEl("button");
      Object.assign(btn.style, {
        padding: `${SPACING.sm}px`,
        background: this.duration === opt.ms ? "var(--interactive-accent)" : "var(--background-secondary)",
        color: this.duration === opt.ms ? "var(--text-on-accent)" : "var(--text-normal)",
        border: "1px solid var(--background-modifier-border)",
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: `${FONT_SIZE.caption}px`,
      });
      btn.textContent = opt.label;
      btn.onclick = () => {
        this.duration = opt.ms;
        this.render();
      };
    }

    // Custom duration
    const customLbl = contentEl.createDiv();
    customLbl.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-bottom:${SPACING.xs}px;`;
    customLbl.textContent = "O duración custom (e.g., \"2d 4h\", \"5h\")";
    this.customDurationInput = contentEl.createEl("input");
    Object.assign(this.customDurationInput.style, {
      width: "100%",
      padding: `${SPACING.sm}px`,
      background: "var(--background-primary)",
      color: "var(--text-normal)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "6px",
      fontSize: `${FONT_SIZE.body}px`,
      marginBottom: `${SPACING.md}px`,
    });
    this.customDurationInput.placeholder = "2d, 5h, 1w, 30m, 1y";

    // Custom date
    const dateLbl = contentEl.createDiv();
    dateLbl.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-bottom:${SPACING.xs}px;`;
    dateLbl.textContent = "O hasta una fecha (YYYY-MM-DD)";
    this.customDateInput = contentEl.createEl("input");
    Object.assign(this.customDateInput.style, {
      width: "100%",
      padding: `${SPACING.sm}px`,
      background: "var(--background-primary)",
      color: "var(--text-normal)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "6px",
      fontSize: `${FONT_SIZE.body}px`,
      marginBottom: `${SPACING.lg}px`,
    });
    this.customDateInput.type = "date";

    // Reason
    const reasonLbl = contentEl.createDiv();
    reasonLbl.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-bottom:${SPACING.xs}px;`;
    reasonLbl.textContent = "Razón (opcional)";
    this.reasonInput = contentEl.createEl("input");
    Object.assign(this.reasonInput.style, {
      width: "100%",
      padding: `${SPACING.sm}px`,
      background: "var(--background-primary)",
      color: "var(--text-normal)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "6px",
      fontSize: `${FONT_SIZE.body}px`,
      marginBottom: `${SPACING.lg}px`,
    });
    this.reasonInput.placeholder = "e.g., Repaso del día del examen";

    // Confirm
    const confirmBtn = contentEl.createEl("button");
    Object.assign(confirmBtn.style, {
      padding: `${SPACING.md}px ${SPACING.xl}px`,
      width: "100%",
      minHeight: "44px",
      background: "var(--interactive-accent)",
      color: "var(--text-on-accent)",
      border: "none",
      borderRadius: "6px",
      fontSize: `${FONT_SIZE.body}px`,
      fontWeight: FONT_WEIGHT.medium,
      cursor: "pointer",
    });
    confirmBtn.textContent = this.duration === null ? "Pausar indefinidamente" : "Pausar";
    confirmBtn.onclick = () => this.confirm();

    // Show current
    if (this.duration !== null) {
      const summary = contentEl.createDiv();
      summary.style.cssText = `margin-top:${SPACING.sm}px;font-size:${FONT_SIZE.caption}px;color:var(--text-muted);text-align:center;`;
      summary.textContent = `Pausar por ${formatHumanDuration(this.duration)}`;
      confirmBtn.parentElement?.insertBefore(summary, confirmBtn.nextSibling);
    }
  }

  private confirm(): void {
    try {
      let durationMs: number | null = this.duration;
      // Override con custom inputs
      if (this.customDurationInput?.value) {
        const parsed = parseHumanDuration(this.customDurationInput.value);
        if (parsed === null) {
          new Notice("Duración custom no válida (e.g., 2d, 5h, 1w)");
          return;
        }
        durationMs = parsed;
      }
      if (this.customDateInput?.value) {
        const date = new Date(this.customDateInput.value);
        if (isNaN(date.getTime())) {
          new Notice("Fecha no válida");
          return;
        }
        const ms = date.getTime() - Date.now();
        if (ms < 0) {
          new Notice("La fecha debe ser futura");
          return;
        }
        durationMs = ms;
      }

      const reason = this.reasonInput?.value || undefined;
      this.manager.snooze(this.target.type, this.target.id, this.target.name, {
        durationMs,
        reason,
      });
      new Notice(
        durationMs === null
          ? "⏸️ Pausado indefinidamente"
          : `⏸️ Pausado por ${formatHumanDuration(durationMs)}`,
        3000,
      );
      this.close();
    } catch (err) {
      new Notice(`Error: ${(err as Error).message}`);
    }
  }
}

// ── Modal para gestionar snoozes activos ──

export class SnoozeListModal extends Modal {
  constructor(
    app: App,
    private manager: SnoozeManager,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = "min-width:540px;max-width:700px;";

    const title = contentEl.createEl("h2");
    title.style.cssText = `margin:0 0 ${SPACING.md}px 0;font-size:${FONT_SIZE.h2}px;font-weight:${FONT_WEIGHT.semibold};`;
    title.textContent = "Elementos en pausa";

    const stats = this.manager.stats();
    const sub = contentEl.createDiv();
    sub.style.cssText = `font-size:${FONT_SIZE.bodySm}px;color:var(--text-muted);margin-bottom:${SPACING.lg}px;`;
    sub.textContent = `${stats.total} elementos pausados · ${stats.indefinite} indefinidos · ${stats.expiringSoon} expiran pronto`;

    const list = this.manager.list();
    if (list.length === 0) {
      const empty = contentEl.createDiv();
      empty.style.cssText = `padding:${SPACING.xl}px;text-align:center;color:var(--text-muted);`;
      empty.textContent = "No hay elementos en pausa.";
      return;
    }

    for (const entry of list) {
      const row = contentEl.createDiv();
      Object.assign(row.style, {
        padding: `${SPACING.md}px`,
        background: "var(--background-secondary)",
        borderRadius: "6px",
        marginBottom: `${SPACING.sm}px`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      });
      const info = row.createDiv();
      info.innerHTML = `
        <div style="font-size:${FONT_SIZE.body}px;font-weight:${FONT_WEIGHT.medium};">${entry.targetName}</div>
        <div style="font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-top:4px;">
          ${entry.type} · ${formatExpiry(entry.expiresAt)}${entry.reason ? ` · ${entry.reason}` : ""}
        </div>
      `;
      const remove = row.createEl("button");
      Object.assign(remove.style, {
        padding: `${SPACING.xs}px ${SPACING.md}px`,
        background: "var(--background-primary)",
        color: "var(--text-error)",
        border: "1px solid var(--text-error)",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: `${FONT_SIZE.caption}px`,
      });
      remove.textContent = "Reanudar";
      remove.onclick = () => {
        this.manager.unsnooze(entry.type, entry.targetId);
        new Notice(`▶️ ${entry.targetName} reanudado`, 2000);
        this.render();
      };
    }
  }
}

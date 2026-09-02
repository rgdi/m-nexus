// ScheduleModal: muestra el plan de estudio generado para hoy/mañana.
// Permite regenerarlo, ajustar el tiempo disponible y exportarlo a la nota diaria.

import { App, Modal } from "obsidian";
import { TFile } from "obsidian";
import { DailyAgenda, SchedulePlanner, AgendaInput } from "../schedule/planner";
import { FlashcardDraft, MNexusSettings } from "../types";
import { Logger } from "../utils/logger";

export class ScheduleModal extends Modal {
  constructor(
    app: App,
    private settings: MNexusSettings,
    private log: Logger,
    private dueCards: FlashcardDraft[]
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "540px";
    contentEl.createEl("h2", { text: "Plan de estudio" });

    const controls = contentEl.createDiv();
    controls.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:12px;";
    const dateInp = controls.createEl("input") as HTMLInputElement;
    dateInp.type = "date";
    // Usar local time (no UTC) para evitar desfases por zona horaria.
    const now = new Date();
    dateInp.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const minInp = controls.createEl("input") as HTMLInputElement;
    minInp.type = "number";
    minInp.value = "120";
    minInp.min = "15";
    minInp.max = "600";
    minInp.style.width = "70px";
    minInp.title = "Minutos disponibles";
    const startInp = controls.createEl("input") as HTMLInputElement;
    startInp.type = "time";
    startInp.value = "09:00";
    const regen = controls.createEl("button", { text: "🔄 Regenerar" });
    const exportBtn = controls.createEl("button", { text: "📥 Exportar a nota" });

    const out = contentEl.createDiv({ cls: "mnexus-schedule-output" });
    out.style.cssText = "min-height:200px;max-height:400px;overflow:auto;border:1px solid var(--background-modifier-border);border-radius:6px;padding:8px;background:var(--background-secondary);";

    const buildAndRender = () => {
      const date = new Date(dateInp.value);
      const input: AgendaInput = {
        notes: this.app.vault.getMarkdownFiles().map((f) => {
          const fm = (this.app.metadataCache.getFileCache(f)?.frontmatter as Record<string, unknown>) ?? {};
          return { path: f.path, fm: fm as unknown as import("../types").MNexusFrontmatter };
        }),
        dueCards: this.dueCards,
        date,
        availableMinutes: Number(minInp.value) || 120,
        startTime: startInp.value || "09:00",
      };
      const planner = new SchedulePlanner(this.settings);
      const agenda = planner.generate(input);
      this.renderAgenda(out, agenda);
      exportBtn.onclick = () => this.exportAgenda(agenda, date);
    };

    regen.onclick = buildAndRender;
    buildAndRender();
  }

  private renderAgenda(parent: HTMLElement, agenda: DailyAgenda) {
    parent.empty();
    const head = parent.createDiv();
    head.createEl("strong", { text: `📅 ${agenda.date}` });
    head.createEl("small", { text: ` · ${agenda.totalMinutes} min · ${agenda.summary}` });
    parent.createEl("hr");
    for (const b of agenda.blocks) {
      const row = parent.createDiv({ cls: "mnexus-schedule-block" });
      row.style.cssText = "display:flex;gap:8px;align-items:flex-start;padding:6px;border-bottom:1px dashed var(--background-modifier-border);";
      const time = row.createDiv();
      time.style.cssText = "min-width:90px;font-family:var(--font-monospace);font-size:0.9em;color:var(--text-muted);";
      time.textContent = `${b.start} – ${b.end}`;
      const body = row.createDiv();
      body.style.flex = "1";
      const head = body.createDiv();
      const icon = this.iconFor(b.type);
      head.createEl("strong", { text: `${icon} ${b.description}` });
      if (b.subject) {
        const meta = body.createDiv({ cls: "mnexus-label" });
        meta.textContent = `materia: ${b.subject} · duración: ${b.durationMin} min`;
      }
      if (b.notePath) {
        const a = body.createEl("a", { text: "abrir nota" });
        a.style.cssText = "display:block;font-size:0.8em;color:var(--text-accent);cursor:pointer;";
        a.onclick = () => {
          this.app.workspace.openLinkText(b.notePath!, "", false);
          this.close();
        };
      }
    }
  }

  private iconFor(t: DailyAgenda["blocks"][number]["type"]): string {
    return (
      {
        review: "🃏",
        "new-cards": "✨",
        "deep-study": "📖",
        "exam-prep": "🎯",
        socratic: "🧠",
        break: "☕",
      } as Record<string, string>
    )[t];
  }

  private async exportAgenda(agenda: DailyAgenda, date: Date) {
    // Local time para evitar desfase de timezone.
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const path = `Daily/${localDate}.md`;
    const lines: string[] = [
      "---",
      `title: "Plan de estudio ${agenda.date}"`,
      "type: daily-agenda",
      "mnexus_generated: true",
      "---",
      "",
      `# 📅 Plan de estudio — ${agenda.date}`,
      "",
      `> ${agenda.summary} (${agenda.totalMinutes} min)`,
      "",
      "## Bloques",
      "",
    ];
    for (const b of agenda.blocks) {
      lines.push(`### ${b.start} – ${b.end} · ${this.iconFor(b.type)} ${b.description}`);
      if (b.subject) lines.push(`Materia: **${b.subject}**`);
      if (b.notePath) lines.push(`Nota: \`${b.notePath}\``);
      lines.push("");
    }
    // Asegurar carpeta
    const folder = "Daily";
    if (!(await this.app.vault.adapter.exists(folder))) await this.app.vault.createFolder(folder);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, lines.join("\n"));
    } else {
      await this.app.vault.create(path, lines.join("\n"));
    }
    this.app.workspace.openLinkText(path, "", false);
  }

  onClose() { this.contentEl.empty(); }
}

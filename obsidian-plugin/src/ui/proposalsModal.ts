// v0.28: Modal de propuestas de la IA — refactorizado con design system.
// Human-in-the-loop: revisar, aprobar, rechazar, aplicar.

import { App, Modal, Notice } from "obsidian";
import type { StudyOrchestrator } from "../ai/studyOrchestrator";
import type { Proposal, ProposalType, ProposalStatus } from "../ai/contentProposals";
import {
  SPACING, FONT_SIZE, FONT_WEIGHT, RADIUS, SHADOW, COLOR, ICON,
  title, card, primaryButton, secondaryButton, ghostButton, badge,
  input, cluster, stack, emptyState, separator, attachTooltip,
  spinner,
} from "./designSystem.js";

const TYPE_ICONS: Record<ProposalType, string> = {
  summary: ICON.note,
  flashcards: ICON.flashcard,
  "mind-map": "◈",
  "study-guide": "▥",
  "link-suggestion": "⇄",
  reorganize: "▦",
  "tag-suggestion": "#",
  "gap-fill": "+",
  merge: "⊕",
  "annotation-summary": "▤",
  recap: "↻",
};

const TYPE_LABELS: Record<ProposalType, string> = {
  summary: "Resumen",
  flashcards: "Flashcards",
  "mind-map": "Mapa mental",
  "study-guide": "Guía de estudio",
  "link-suggestion": "Enlazar",
  reorganize: "Reorganizar",
  "tag-suggestion": "Tags",
  "gap-fill": "Rellenar",
  merge: "Fusionar",
  "annotation-summary": "Anotaciones",
  recap: "Recap",
};

const STATUS_LABELS: Record<ProposalStatus, string> = {
  pending: "Pendiente",
  approved: "Aprobada",
  rejected: "Rechazada",
  applied: "Aplicada",
  failed: "Fallida",
};

const STATUS_BADGE: Record<ProposalStatus, "warning" | "success" | "error" | "info" | "neutral"> = {
  pending: "warning",
  approved: "info",
  rejected: "error",
  applied: "success",
  failed: "error",
};

const FILTER_STATUSES: ProposalStatus[] = ["pending", "approved", "applied", "rejected", "failed"];

export class ProposalsModal extends Modal {
  private currentFilter: ProposalStatus = "pending";
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private searchQuery: string = "";
  private bodyEl: HTMLElement | null = null;

  constructor(app: App, private orchestrator: StudyOrchestrator) {
    super(app);
  }

  onOpen(): void {
    this.render();
    // Auto-refresh cada 8s (no 5s, para no marear)
    this.refreshInterval = setInterval(() => {
      // v0.28: Obsidian Modal no expone isOpen. Asumimos que el interval
      // solo corre mientras el modal está visible (clearInterval en onClose).
      this.renderList();
    }, 8000);
  }

  onClose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = `min-width:680px;max-width:960px;`;
    this.renderHeader();
    this.renderControls();
    this.bodyEl = contentEl.createDiv({ cls: "mnexus-proposals-body" });
    this.renderList();
  }

  private renderHeader(): void {
    const { contentEl } = this;
    const header = contentEl.createDiv({ cls: "mnexus-proposals-header" });
    Object.assign(header.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: `${SPACING.lg}px ${SPACING.xl}px`,
      background: COLOR.bgSecondary,
      borderRadius: `${RADIUS.lg}px`,
      marginBottom: `${SPACING.lg}px`,
    });

    const left = header.createDiv();
    const h2 = left.createEl("h2");
    title(h2, 2);
    h2.textContent = "Propuestas";

    const stats = this.orchestrator.getProposals().stats();
    const sub = left.createDiv();
    sub.style.cssText = `margin-top:${SPACING.xs}px;font-size:${FONT_SIZE.caption}px;color:${COLOR.textMuted};`;
    sub.textContent = `${stats.total} propuestas · ${stats.byStatus.pending ?? 0} pendientes`;

    // Botón principal: ejecutar análisis
    const runBtn = header.createEl("button");
    primaryButton(runBtn);
    runBtn.textContent = "Analizar vault";
    attachTooltip(runBtn, "Genera nuevas propuestas a partir del contenido del vault", "Ctrl+Shift+A");
    runBtn.onclick = async () => {
      runBtn.disabled = true;
      const originalText = runBtn.textContent;
      runBtn.textContent = "Analizando…";
      try {
        await this.orchestrator.runAnalysis();
        this.render();
        new Notice("Análisis completado");
      } catch (e) {
        new Notice(`Error: ${(e as Error).message}`);
        runBtn.textContent = originalText;
        runBtn.disabled = false;
      }
    };
  }

  private renderControls(): void {
    const { contentEl } = this;
    const controls = contentEl.createDiv({ cls: "mnexus-proposals-controls" });
    Object.assign(controls.style, {
      display: "flex",
      flexDirection: "column",
      gap: `${SPACING.md}px`,
      marginBottom: `${SPACING.lg}px`,
    });

    // Filtros por status
    const filters = controls.createDiv();
    cluster(filters, "xs");
    for (const s of FILTER_STATUSES) {
      const isActive = this.currentFilter === s;
      const btn = filters.createEl("button");
      secondaryButton(btn);
      const counts = this.orchestrator.getProposals().stats().byStatus;
      const count = counts[s] ?? 0;
      btn.textContent = `${STATUS_LABELS[s]} (${count})`;
      if (isActive) {
        btn.style.background = COLOR.accent;
        btn.style.color = COLOR.textOnAccent;
        btn.style.borderColor = COLOR.accent;
      }
      attachTooltip(btn, `Mostrar propuestas ${STATUS_LABELS[s].toLowerCase()}`);
      btn.onclick = () => {
        this.currentFilter = s;
        this.renderControls();
        this.renderList();
      };
    }

    // Buscador
    const searchWrap = controls.createDiv();
    Object.assign(searchWrap.style, {
      display: "flex",
      alignItems: "center",
      gap: `${SPACING.sm}px`,
    });
    const search = searchWrap.createEl("input");
    input(search);
    search.placeholder = "Buscar propuesta…";
    search.value = this.searchQuery;
    search.oninput = () => {
      this.searchQuery = search.value;
      this.renderList();
    };
  }

  private renderList(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    this.bodyEl.style.cssText = `max-height:60vh;overflow-y:auto;`;
    let proposals = this.orchestrator.getProposals().list({ status: this.currentFilter });
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      proposals = proposals.filter(
        (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
      );
    }
    if (proposals.length === 0) {
      emptyState(
        this.bodyEl,
        this.searchQuery
          ? "Sin resultados para tu búsqueda"
          : `No hay propuestas ${STATUS_LABELS[this.currentFilter].toLowerCase()}s`,
        "Cambia de filtro o ejecuta un análisis del vault",
      );
      return;
    }
    const list = stack(this.bodyEl, "md");
    for (const p of proposals) this.renderProposal(p, list);
  }

  private renderProposal(p: Proposal, container: HTMLElement): void {
    const cardEl = container.createDiv({ cls: "mnexus-proposal-card" });
    card(cardEl, true);

    // Header: tipo + título + status
    const header = cardEl.createDiv();
    cluster(header, "sm", false);
    Object.assign(header.style, { justifyContent: "space-between", marginBottom: `${SPACING.sm}px` });

    const titleEl = header.createDiv();
    cluster(titleEl, "xs", false);
    const iconSpan = titleEl.createSpan();
    iconSpan.textContent = TYPE_ICONS[p.type];
    iconSpan.style.cssText = `font-size:${FONT_SIZE.h3}px;color:${COLOR.info};`;
    const titleText = titleEl.createSpan();
    titleText.style.cssText = `font-size:${FONT_SIZE.body}px;font-weight:${FONT_WEIGHT.semibold};`;
    titleText.textContent = p.title;

    const statusBadge = header.createSpan();
    badge(statusBadge, STATUS_BADGE[p.status]);
    statusBadge.textContent = STATUS_LABELS[p.status];

    // Descripción
    const desc = cardEl.createDiv();
    desc.style.cssText = `font-size:${FONT_SIZE.bodySm}px;color:${COLOR.textMuted};margin-bottom:${SPACING.md}px;line-height:${1.5};`;
    desc.textContent = p.description;

    // Metadata: confidence, priority, type
    const meta = cardEl.createDiv();
    cluster(meta, "sm");
    Object.assign(meta.style, { marginBottom: `${SPACING.md}px`, fontSize: `${FONT_SIZE.caption}px`, color: COLOR.textMuted });
    meta.appendText(TYPE_LABELS[p.type]);
    meta.appendText("·");
    const conf = meta.createSpan();
    conf.textContent = `confianza ${Math.round(p.confidence * 100)}%`;
    meta.appendText("·");
    const prio = meta.createSpan();
    prio.textContent = `prioridad ${Math.round(p.priority * 100)}%`;
    if (p.requiresDoubleApproval) {
      const warning = meta.createSpan();
      warning.style.cssText = `color:${COLOR.warning};font-weight:${FONT_WEIGHT.medium};`;
      warning.textContent = "· requiere doble aprobación";
    }

    // Acciones
    const actions = cardEl.createDiv();
    cluster(actions, "xs", false);
    if (p.status === "pending") {
      const approve = actions.createEl("button");
      primaryButton(approve);
      approve.textContent = "Aprobar";
      attachTooltip(approve, "Aprueba esta propuesta", "A");
      approve.onclick = async () => {
        approve.disabled = true;
        const ok = this.orchestrator.approveProposal(p.id);
        if (!ok) {
          approve.disabled = false;
          new Notice("No se pudo aprobar");
        } else {
          this.renderControls();
          this.renderList();
        }
      };

      const reject = actions.createEl("button");
      secondaryButton(reject);
      reject.textContent = "Rechazar";
      attachTooltip(reject, "Rechaza esta propuesta", "R");
      reject.onclick = () => {
        this.orchestrator.rejectProposal(p.id);
        this.renderControls();
        this.renderList();
      };

      const apply = actions.createEl("button");
      primaryButton(apply);
      apply.style.background = COLOR.success;
      apply.textContent = "Aplicar ahora";
      attachTooltip(apply, "Aprueba y aplica inmediatamente al vault");
      apply.onclick = async () => {
        apply.disabled = true;
        this.orchestrator.approveProposal(p.id);
        try {
          const result = await this.orchestrator.applyProposal(p.id);
          if (result) new Notice("Propuesta aplicada");
          else new Notice("No se pudo aplicar");
        } catch (e) {
          new Notice(`Error: ${(e as Error).message}`);
        }
        this.renderControls();
        this.renderList();
      };
    } else {
      const note = actions.createSpan();
      note.style.cssText = `font-size:${FONT_SIZE.caption}px;color:${COLOR.textFaint};`;
      note.textContent = STATUS_LABELS[p.status].toLowerCase();
    }
  }
}

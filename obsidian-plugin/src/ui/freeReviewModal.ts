// v0.28: Modal de Repaso Libre — "Hoy me apetece repasar anatomía".
//
// UI simple:
//   1) Input de búsqueda ("anatomía", "#cardio", "stale:7", "aleatorio", "todas")
//   2) Preview: "X cards encontradas"
//   3) Botón "Empezar repaso"
//   4) Quiz compacto (igual que adaptive quiz pero sin mastery updates)

import { App, Modal, Notice } from "obsidian";
import type { FlashcardDraft, Rating } from "../types";
import {
  findCardsForFreeReview,
  createFreeReviewSession,
  answerFreeReview,
  finishFreeReview,
  parseFreeReviewInput,
  describeFreeReviewSource,
  type FreeReviewSession,
  type FreeReviewResult,
} from "../study/freeReview";
import { showHint } from "./onboardingHints";
import { SPACING, FONT_SIZE, FONT_WEIGHT, COLOR } from "./designSystem";

export class FreeReviewModal extends Modal {
  private searchInput: HTMLInputElement | null = null;
  private previewEl: HTMLElement | null = null;
  private session: FreeReviewSession | null = null;
  private allCards: FlashcardDraft[];
  private currentPreviewSource: any = null;
  private currentPreviewCount = 0;

  constructor(
    app: App,
    private cards: FlashcardDraft[],
  ) {
    super(app);
    this.allCards = cards;
  }

  onOpen(): void {
    showHint("free-review");
    this.render();
  }

  onClose(): void {
    if (this.session && !this.session.completed) {
      const r = finishFreeReview(this.session);
      if (r.total > 0) {
        new Notice(
          `Repaso: ${r.correct}/${r.total} (${Math.round(r.accuracy * 100)}%)`,
          4000,
        );
      }
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = "min-width:540px;max-width:700px;";

    if (!this.session) {
      this.renderStart();
    } else {
      this.renderQuiz();
    }
  }

  // ── Pantalla de inicio ──

  private renderStart(): void {
    const { contentEl } = this;

    const header = contentEl.createDiv();
    Object.assign(header.style, {
      padding: `${SPACING.lg}px ${SPACING.xl}px`,
      background: COLOR.bgSecondary,
      borderRadius: "8px",
      marginBottom: `${SPACING.lg}px`,
    });

    const title = header.createEl("h2");
    title.style.cssText = `margin:0;font-size:${FONT_SIZE.h2}px;font-weight:${FONT_WEIGHT.semibold};`;
    title.textContent = "Repaso libre";

    const subtitle = header.createDiv();
    subtitle.style.cssText = `margin-top:${SPACING.xs}px;font-size:${FONT_SIZE.bodySm}px;color:${COLOR.textMuted};`;
    subtitle.textContent = "Estudia lo que TÚ quieras, sin importar el FSRS.";

    // Input
    const label = contentEl.createDiv();
    label.style.cssText = `font-size:${FONT_SIZE.caption}px;color:${COLOR.textMuted};margin-bottom:${SPACING.xs}px;`;
    label.textContent = "¿Qué quieres repasar?";

    const inputWrap = contentEl.createDiv();
    Object.assign(inputWrap.style, {
      display: "flex",
      gap: `${SPACING.sm}px`,
      marginBottom: `${SPACING.md}px`,
    });

    this.searchInput = inputWrap.createEl("input");
    Object.assign(this.searchInput.style, {
      flex: "1",
      padding: `${SPACING.sm}px ${SPACING.md}px`,
      minHeight: "40px",
      background: "var(--background-primary)",
      color: "var(--text-normal)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "6px",
      fontSize: `${FONT_SIZE.body}px`,
      outline: "none",
    });
    this.searchInput.placeholder = "anatomía, cardio, #tag, stale:7, aleatorio, todas";
    setTimeout(() => this.searchInput?.focus(), 50);

    this.searchInput.addEventListener("input", () => this.updatePreview());
    this.searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.currentPreviewCount > 0) {
        this.startSession();
      }
    });

    // Botón preview
    const previewBtn = inputWrap.createEl("button");
    Object.assign(previewBtn.style, {
      padding: `${SPACING.sm}px ${SPACING.lg}px`,
      background: "var(--background-secondary)",
      color: "var(--text-normal)",
      border: "1px solid var(--background-modifier-border)",
      borderRadius: "6px",
      cursor: "pointer",
    });
    previewBtn.textContent = "Vista previa";
    previewBtn.onclick = () => this.updatePreview();

    // Preview area
    this.previewEl = contentEl.createDiv();
    this.previewEl.style.cssText = `padding:${SPACING.md}px;background:var(--background-secondary);border-radius:6px;min-height:60px;margin-bottom:${SPACING.lg}px;`;
    this.previewEl.textContent = "Escribe algo y pulsa Vista previa";

    // Sugerencias
    const sug = contentEl.createDiv();
    Object.assign(sug.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: `${SPACING.xs}px`,
      marginBottom: `${SPACING.lg}px`,
    });
    const suggestions = ["anatomía", "fisiología", "cardio", "#farma", "stale:7", "aleatorio", "todas"];
    for (const s of suggestions) {
      const chip = sug.createEl("button");
      Object.assign(chip.style, {
        padding: "4px 10px",
        background: "var(--background-secondary)",
        color: "var(--text-muted)",
        border: "1px solid var(--background-modifier-border)",
        borderRadius: "999px",
        cursor: "pointer",
        fontSize: `${FONT_SIZE.caption}px`,
      });
      chip.textContent = s;
      chip.onclick = () => {
        if (this.searchInput) {
          this.searchInput.value = s;
          this.updatePreview();
        }
      };
    }

    // Botón principal
    const startBtn = contentEl.createEl("button");
    Object.assign(startBtn.style, {
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
    startBtn.textContent = "Empezar repaso";
    startBtn.disabled = true;
    startBtn.style.opacity = "0.5";
    startBtn.onclick = () => this.startSession();
    this.startBtn = startBtn;
  }

  private startBtn: HTMLButtonElement | null = null;

  // ── Preview ──

  private updatePreview(): void {
    if (!this.searchInput || !this.previewEl) return;
    const input = this.searchInput.value;
    const source = parseFreeReviewInput(input, 30);
    const cards = findCardsForFreeReview(this.allCards, source, { maxCards: 50 });
    this.currentPreviewSource = source;
    this.currentPreviewCount = cards.length;

    const desc = describeFreeReviewSource(source);
    if (cards.length === 0) {
      this.previewEl.innerHTML = `<span style="color:var(--text-muted);">No se encontraron cards para ${desc}.</span>`;
    } else {
      this.previewEl.innerHTML = `
        <div style="font-size:${FONT_SIZE.body}px;font-weight:${FONT_WEIGHT.medium};">
          ${cards.length} card${cards.length === 1 ? "" : "s"} encontrada${cards.length === 1 ? "" : "s"}
        </div>
        <div style="font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-top:4px;">
          Fuente: ${desc}
        </div>
      `;
    }

    if (this.startBtn) {
      this.startBtn.disabled = cards.length === 0;
      this.startBtn.style.opacity = cards.length === 0 ? "0.5" : "1";
    }
  }

  // ── Sesión de repaso ──

  private startSession(): void {
    if (!this.currentPreviewSource || this.currentPreviewCount === 0) {
      new Notice("No hay cards para repasar");
      return;
    }
    const cards = findCardsForFreeReview(this.allCards, this.currentPreviewSource, { maxCards: 50 });
    this.session = createFreeReviewSession(this.currentPreviewSource, cards);
    this.render();
  }

  private renderQuiz(): void {
    if (!this.session) return;
    const { contentEl } = this;
    contentEl.empty();

    const total = this.session.cards.length;
    const i = this.session.currentIndex;
    const card = this.session.cards[i];
    if (!card) return;

    // Header con progress
    const header = contentEl.createDiv();
    Object.assign(header.style, {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: `${SPACING.md}px`,
      fontSize: `${FONT_SIZE.caption}px`,
      color: "var(--text-muted)",
    });
    const progress = header.createDiv();
    progress.textContent = `Pregunta ${i + 1} / ${total}`;
    const source = header.createDiv();
    source.textContent = describeFreeReviewSource(this.session.source);

    // Progress bar
    const progressBar = contentEl.createDiv();
    Object.assign(progressBar.style, {
      height: "3px",
      background: "var(--background-modifier-border)",
      borderRadius: "999px",
      marginBottom: `${SPACING.lg}px`,
      overflow: "hidden",
    });
    const fill = progressBar.createDiv();
    Object.assign(fill.style, {
      width: `${((i + 1) / total) * 100}%`,
      height: "100%",
      background: "var(--interactive-accent)",
      transition: "width 200ms ease-out",
    });

    // Card
    const cardEl = contentEl.createDiv();
    Object.assign(cardEl.style, {
      padding: `${SPACING.xl}px`,
      background: "var(--background-secondary)",
      borderRadius: "8px",
      marginBottom: `${SPACING.lg}px`,
      textAlign: "center",
    });

    const note = cardEl.createDiv();
    note.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-bottom:${SPACING.sm}px;`;
    note.textContent = card.notePath ?? "";

    const front = cardEl.createEl("h2");
    front.style.cssText = `margin:0;font-size:${FONT_SIZE.h2}px;font-weight:${FONT_WEIGHT.medium};line-height:1.4;`;
    front.textContent = card.front;

    // Botones de respuesta
    const ratings: { rating: Rating; label: string; color: string }[] = [
      { rating: 1, label: "Otra vez", color: "var(--text-error)" },
      { rating: 2, label: "Difícil", color: "var(--text-warning)" },
      { rating: 3, label: "Bien", color: "var(--text-success)" },
      { rating: 4, label: "Fácil", color: "var(--interactive-accent)" },
    ];
    const btnRow = contentEl.createDiv();
    Object.assign(btnRow.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr 1fr",
      gap: `${SPACING.sm}px`,
    });

    for (const r of ratings) {
      const btn = btnRow.createEl("button");
      Object.assign(btn.style, {
        padding: `${SPACING.md}px`,
        background: "var(--background-primary)",
        color: r.color,
        border: `1px solid ${r.color}`,
        borderRadius: "6px",
        cursor: "pointer",
        fontSize: `${FONT_SIZE.bodySm}px`,
        fontWeight: FONT_WEIGHT.medium,
      });
      btn.textContent = r.label;
      btn.onclick = () => this.answer(r.rating);
    }

    // Acciones secundarias
    const actions = contentEl.createDiv();
    Object.assign(actions.style, {
      display: "flex",
      justifyContent: "space-between",
      marginTop: `${SPACING.md}px`,
      fontSize: `${FONT_SIZE.caption}px`,
    });
    const skipBtn = actions.createEl("button");
    Object.assign(skipBtn.style, {
      background: "transparent",
      border: "none",
      color: "var(--text-muted)",
      cursor: "pointer",
      padding: `${SPACING.xs}px ${SPACING.sm}px`,
    });
    skipBtn.textContent = "Saltar";
    skipBtn.onclick = () => this.answer(2);

    const flipBtn = actions.createEl("button");
    Object.assign(flipBtn.style, {
      background: "transparent",
      border: "none",
      color: "var(--text-muted)",
      cursor: "pointer",
      padding: `${SPACING.xs}px ${SPACING.sm}px`,
    });
    flipBtn.textContent = "Ver respuesta";
    flipBtn.onclick = () => {
      const answer = cardEl.createDiv();
      answer.style.cssText = `margin-top:${SPACING.md}px;padding:${SPACING.md}px;background:var(--background-primary);border-radius:6px;font-size:${FONT_SIZE.body}px;`;
      answer.textContent = card.back;
    };

    const stopBtn = actions.createEl("button");
    Object.assign(stopBtn.style, {
      background: "transparent",
      border: "none",
      color: "var(--text-muted)",
      cursor: "pointer",
      padding: `${SPACING.xs}px ${SPACING.sm}px`,
    });
    stopBtn.textContent = "Terminar";
    stopBtn.onclick = () => this.finish();
  }

  private answer(rating: Rating): void {
    if (!this.session) return;
    const card = this.session.cards[this.session.currentIndex];
    if (!card) return;
    const start = Date.now();
    answerFreeReview(this.session, card.id, rating, Date.now() - start);
    if (this.session.completed) {
      this.finish();
    } else {
      this.renderQuiz();
    }
  }

  private finish(): void {
    if (!this.session) return;
    const result = finishFreeReview(this.session);
    this.showResults(result);
  }

  private showResults(result: FreeReviewResult): void {
    const { contentEl } = this;
    contentEl.empty();

    const wrap = contentEl.createDiv();
    Object.assign(wrap.style, {
      padding: `${SPACING.lg}px`,
      textAlign: "center",
    });

    const title = wrap.createEl("h2");
    title.style.cssText = `margin:0 0 ${SPACING.lg}px 0;font-size:${FONT_SIZE.h1}px;font-weight:${FONT_WEIGHT.semibold};`;
    title.textContent = "Repaso completado";

    const grid = wrap.createDiv();
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: `${SPACING.lg}px`,
      marginBottom: `${SPACING.lg}px`,
    });
    const stats = [
      { v: `${result.correct}/${result.total}`, l: "Aciertos" },
      { v: `${Math.round(result.accuracy * 100)}%`, l: "Precisión" },
      { v: `${Math.round(result.averageTimeMs / 1000)}s`, l: "Por card" },
      { v: `${Math.round(result.durationMs / 1000)}s`, l: "Total" },
    ];
    for (const s of stats) {
      const box = grid.createDiv();
      Object.assign(box.style, {
        padding: `${SPACING.lg}px`,
        background: "var(--background-secondary)",
        borderRadius: "8px",
      });
      const v = box.createDiv();
      v.style.cssText = `font-size:${FONT_SIZE.h2}px;font-weight:${FONT_WEIGHT.semibold};`;
      v.textContent = s.v;
      const l = box.createDiv();
      l.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-top:${SPACING.xs}px;`;
      l.textContent = s.l;
    }

    const note = wrap.createDiv();
    note.style.cssText = `font-size:${FONT_SIZE.caption}px;color:var(--text-muted);margin-bottom:${SPACING.lg}px;`;
    note.textContent = "Este repaso NO afecta al FSRS scheduler. Es solo para refrescar.";

    const close = wrap.createEl("button");
    Object.assign(close.style, {
      padding: `${SPACING.md}px ${SPACING.xl}px`,
      background: "var(--interactive-accent)",
      color: "var(--text-on-accent)",
      border: "none",
      borderRadius: "6px",
      cursor: "pointer",
    });
    close.textContent = "Cerrar";
    close.onclick = () => this.close();
  }
}

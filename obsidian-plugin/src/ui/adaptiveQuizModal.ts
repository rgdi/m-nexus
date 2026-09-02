// v0.28: Modal del quiz adaptativo — refactorizado con design system.
// Compacto, rápido, inteligente. Una sola pantalla, sin distracciones.

import { App, Modal, Notice } from "obsidian";
import type { KnowledgeGraph } from "../study/knowledgeLayers";
import { LAYER_LABELS, LAYER_ICONS } from "../study/knowledgeLayers";
import { AdaptiveQuizEngine, type Question, type QuizSession } from "../study/adaptiveQuiz";
import {
  SPACING, FONT_SIZE, FONT_WEIGHT, RADIUS, COLOR, ICON,
  primaryButton, secondaryButton, input, badge, attachTooltip, stack, cluster,
} from "./designSystem.js";

const CONFIDENCE_PRESETS = [
  { value: 0.2, label: "No lo sé" },
  { value: 0.5, label: "Dudo" },
  { value: 0.8, label: "Bastante seguro" },
  { value: 1.0, label: "Totalmente seguro" },
] as const;

export class AdaptiveQuizModal extends Modal {
  private engine: AdaptiveQuizEngine;
  private currentQ: Question | null = null;
  private confidence: number = 0.7;
  private startTime = 0;

  constructor(app: App, private graph: KnowledgeGraph) {
    super(app);
    this.engine = new AdaptiveQuizEngine(graph, {
      maxQuestions: 15, // Reducido de 20 a 15 para sesiones más cortas
      stopOnMastery: true,
      mode: "diagnostic",
    });
  }

  onOpen(): void {
    this.engine.startSession();
    this.next();
  }

  onClose(): void {
    const r = this.engine.sessionResult();
    if (r.totalQuestions > 0) {
      new Notice(
        `Quiz: ${r.correct}/${r.totalQuestions} aciertos · ${Math.round(r.accuracy * 100)}% · ${Math.round(r.averageConfidence * 100)}% confianza`,
        5000,
      );
    }
  }

  private next(): void {
    this.currentQ = this.engine.nextQuestion();
    if (!this.currentQ) {
      this.renderResults();
      return;
    }
    this.startTime = Date.now();
    this.renderQuestion();
  }

  private renderQuestion(): void {
    if (!this.currentQ) return;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.cssText = `min-width:560px;max-width:720px;`;

    // ── Progress bar sutil ──
    const session = this.engine.getSession();
    const qNum = (session?.currentIndex ?? 0) + 1;
    const total = session?.questions.length ?? 0;
    const progress = (qNum / Math.max(1, total)) * 100;

    const progressBar = contentEl.createDiv({ cls: "mnexus-quiz-progress" });
    Object.assign(progressBar.style, {
      height: "2px",
      background: COLOR.border,
      borderRadius: `${RADIUS.pill}px`,
      marginBottom: `${SPACING.lg}px`,
      overflow: "hidden",
    });
    const progressFill = progressBar.createDiv();
    Object.assign(progressFill.style, {
      width: `${progress}%`,
      height: "100%",
      background: COLOR.accent,
      transition: "width 240ms ease-out",
    });

    // ── Capa: icono + label (context, no decoración) ──
    const layerContext = contentEl.createDiv();
    Object.assign(layerContext.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: `${SPACING.sm}px`,
      marginBottom: `${SPACING.md}px`,
      color: COLOR.textMuted,
      fontSize: `${FONT_SIZE.bodySm}px`,
    });
    const layerIcon = layerContext.createSpan();
    layerIcon.style.cssText = `font-size:${FONT_SIZE.h3}px;`;
    layerIcon.textContent = LAYER_ICONS[this.currentQ.layer];
    const layerText = layerContext.createSpan();
    layerText.textContent = LAYER_LABELS[this.currentQ.layer];

    // ── Pregunta ──
    const qEl = contentEl.createEl("h2");
    Object.assign(qEl.style, {
      textAlign: "center",
      fontSize: `${FONT_SIZE.h2}px`,
      fontWeight: FONT_WEIGHT.medium,
      lineHeight: "1.4",
      margin: `0 0 ${SPACING.sm}px 0`,
      color: COLOR.text,
    });
    qEl.textContent = this.currentQ.text;

    // ── Hint sutil (si existe) ──
    if (this.currentQ.hint) {
      const hintEl = contentEl.createDiv();
      Object.assign(hintEl.style, {
        textAlign: "center",
        fontSize: `${FONT_SIZE.caption}px`,
        color: COLOR.textFaint,
        marginBottom: `${SPACING.xl}px`,
      });
      hintEl.textContent = this.currentQ.hint;
    }

    // ── Input + acciones ──
    const inputRow = contentEl.createDiv();
    cluster(inputRow, "sm", false);
    Object.assign(inputRow.style, { marginBottom: `${SPACING.lg}px` });

    const textInput = inputRow.createEl("input");
    input(textInput);
    textInput.placeholder = "Escribe tu respuesta…";
    textInput.style.flex = "1";
    setTimeout(() => textInput.focus(), 60);

    // Atajo Enter
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && textInput.value.trim()) {
        this.answer(textInput.value.trim(), this.confidence);
      }
    });

    const submitBtn = inputRow.createEl("button");
    primaryButton(submitBtn);
    submitBtn.textContent = "Responder";
    attachTooltip(submitBtn, "Enviar respuesta", "Enter");
    submitBtn.onclick = () => {
      if (textInput.value.trim()) {
        this.answer(textInput.value.trim(), this.confidence);
      }
    };

    // ── Confidence: chips grandes (más rápido que slider) ──
    const confLabel = contentEl.createDiv();
    confLabel.style.cssText = `font-size:${FONT_SIZE.caption}px;color:${COLOR.textMuted};margin-bottom:${SPACING.sm}px;text-align:center;`;
    confLabel.textContent = "¿Qué tan seguro estás?";

    const confRow = contentEl.createDiv();
    cluster(confRow, "xs", true);
    Object.assign(confRow.style, { justifyContent: "center", marginBottom: `${SPACING.md}px` });
    for (const preset of CONFIDENCE_PRESETS) {
      const isActive = Math.abs(this.confidence - preset.value) < 0.05;
      const chip = confRow.createEl("button");
      secondaryButton(chip);
      chip.textContent = preset.label;
      attachTooltip(chip, `${Math.round(preset.value * 100)}% confianza`);
      if (isActive) {
        chip.style.background = COLOR.accent;
        chip.style.color = COLOR.textOnAccent;
        chip.style.borderColor = COLOR.accent;
      }
      chip.onclick = () => {
        this.confidence = preset.value;
        this.renderQuestion();
      };
    }

    // ── Acciones secundarias ──
    const actions = contentEl.createDiv();
    cluster(actions, "sm");
    Object.assign(actions.style, { justifyContent: "center" });

    const skipBtn = actions.createEl("button");
    secondaryButton(skipBtn);
    skipBtn.textContent = "Saltar";
    attachTooltip(skipBtn, "Saltar esta pregunta", "S");
    skipBtn.onclick = () => this.answer("__skip__", 0);

    const stopBtn = actions.createEl("button");
    secondaryButton(stopBtn);
    stopBtn.textContent = "Terminar";
    attachTooltip(stopBtn, "Terminar el quiz y ver resultados", "Esc");
    stopBtn.onclick = () => this.renderResults();
  }

  private async answer(answer: string, confidence: number): Promise<void> {
    if (!this.currentQ) return;
    if (answer === "__skip__") {
      // Marcar como incorrecto sin afectar mastery
      await this.engine.answerCurrent("__skip__", 0, Date.now() - this.startTime);
      this.next();
      return;
    }
    await this.engine.answerCurrent(answer, confidence, Date.now() - this.startTime);
    this.next();
  }

  private renderResults(): void {
    const { contentEl } = this;
    contentEl.empty();
    const r = this.engine.sessionResult();

    const wrap = contentEl.createDiv();
    Object.assign(wrap.style, { padding: `${SPACING.lg}px`, textAlign: "center" });

    const titleEl = wrap.createEl("h2");
    titleEl.textContent = "Resultados";
    Object.assign(titleEl.style, { margin: `0 0 ${SPACING.lg}px 0`, fontSize: `${FONT_SIZE.h1}px`, fontWeight: FONT_WEIGHT.semibold });

    // Stats grid
    const grid = wrap.createDiv();
    Object.assign(grid.style, {
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr",
      gap: `${SPACING.lg}px`,
      marginBottom: `${SPACING.xl}px`,
    });

    const statBoxes = [
      { value: `${r.correct}/${r.totalQuestions}`, label: "Aciertos" },
      { value: `${Math.round(r.accuracy * 100)}%`, label: "Precisión" },
      { value: `${Math.round(r.averageConfidence * 100)}%`, label: "Confianza media" },
    ];
    for (const stat of statBoxes) {
      const box = grid.createDiv();
      Object.assign(box.style, {
        padding: `${SPACING.lg}px`,
        background: COLOR.bgSecondary,
        borderRadius: `${RADIUS.lg}px`,
      });
      const v = box.createDiv();
      v.style.cssText = `font-size:${FONT_SIZE.h2}px;font-weight:${FONT_WEIGHT.semibold};color:${COLOR.text};`;
      v.textContent = stat.value;
      const l = box.createDiv();
      l.style.cssText = `font-size:${FONT_SIZE.caption}px;color:${COLOR.textMuted};margin-top:${SPACING.xs}px;`;
      l.textContent = stat.label;
    }

    // CTA
    const cta = wrap.createEl("button");
    primaryButton(cta);
    cta.textContent = "Cerrar";
    cta.onclick = () => this.close();
  }
}

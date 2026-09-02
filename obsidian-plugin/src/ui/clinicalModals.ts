// ClinicalModals: UI para viñetas y modo socrático.

import { App, Modal, TFile, normalizePath } from "obsidian";
import { Vignette, VignetteGenerator, VignetteStyle } from "../clinical/vignetteGenerator";
import { SocraticTutor, SocraticSession } from "../clinical/socratic";
import { LLMManager } from "../llm/manager";
import { Logger } from "../utils/logger";
import { MNexusSettings } from "../types";

export class VignetteModal extends Modal {
  private result: HTMLElement | null = null;
  private selected: string | null = null;
  private revealed = false;

  constructor(
    app: App,
    private file: TFile,
    private style: VignetteStyle,
    private llm: LLMManager,
    private log: Logger,
    private settings: MNexusSettings
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "700px";
    contentEl.createEl("h2", { text: `🩺 Viñeta: ${this.file.basename}` });
    contentEl.createEl("p", { text: `Estilo: ${this.style.toUpperCase()} · Generando…`, cls: "mnexus-label" });
    this.result = contentEl.createDiv();
    try {
      const gen = new VignetteGenerator(this.app, this.llm, this.log, this.settings);
      const v = await gen.generate({ notePath: this.file.path, style: this.style });
      this.renderVignette(v);
    } catch (e) {
      this.result?.createEl("p", { text: "Error: " + (e as Error).message, cls: "mnexus-label" });
    }
  }

  private renderVignette(v: Vignette) {
    if (!this.result) return;
    this.result.empty();
    this.result.createEl("p", { text: `📚 ${v.pathology} · dificultad ${v.difficulty}/5` });
    const sec = (label: string, body?: string) => {
      if (!body) return;
      const h = this.result!.createEl("strong", { text: label });
      this.result!.createEl("p", { text: body });
    };
    sec("PRESENTACIÓN", v.presentation);
    sec("ANTECEDENTES", v.history);
    sec("EXPLORACIÓN", v.physicalExam);
    sec("PRUEBAS", v.workup);
    this.result.createEl("h3", { text: v.question });
    const opts = this.result.createDiv();
    opts.style.cssText = "display:flex;flex-direction:column;gap:4px;margin:8px 0;";
    for (const o of v.options) {
      const btn = opts.createEl("button", { text: `${o.letter}) ${o.text}` });
      btn.style.cssText = "text-align:left;padding:8px;";
      btn.onclick = () => {
        this.selected = o.letter;
        if (this.revealed) return;
        this.revealed = true;
        const correct = o.isCorrect;
        const title = this.result!.createEl("p");
        title.innerHTML = correct
          ? `<strong style="color:var(--text-success)">✔ Correcto</strong>`
          : `<strong style="color:var(--text-error)">✘ Incorrecto</strong>`;
        const expl = this.result!.createEl("div");
        expl.style.cssText = "background:var(--background-secondary);padding:8px;border-radius:6px;";
        expl.createEl("strong", { text: "Explicación: " });
        expl.createEl("span", { text: v.correctAnswer.explanation });
        const saveBtn = this.result!.createEl("button", { text: "💾 Guardar como flashcard" });
        saveBtn.onclick = () => this.saveAsFlashcard(v);
      };
    }
  }

  private async saveAsFlashcard(v: Vignette) {
    const front = `[${v.style.toUpperCase()}] ${v.pathology}\n\n${v.presentation}\n\n${v.question}`;
    const back = `Correcta: ${v.correctAnswer.letter}\n${v.correctAnswer.explanation}`;
    const cardPath = normalizePath(`_M-NEXUS/Flashcards/Drafts/vignette-${Date.now()}.md`);
    const folder = normalizePath("_M-NEXUS/Flashcards/Drafts");
    if (!(await this.app.vault.adapter.exists(folder))) {
      try { await this.app.vault.createFolder(folder); } catch { /* idempotente */ }
    }
    await this.app.vault.create(cardPath, `---\nsubject: ${v.pathology}\ntags: [vignette, ${v.style}]\n---\n\n# ${front}\n\n${back}\n`);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

export class SocraticModal extends Modal {
  private session: SocraticSession | null = null;
  private conversationEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    private file: TFile,
    private tutor: SocraticTutor
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "650px";
    contentEl.createEl("h2", { text: `🎓 Modo socrático: ${this.file.basename}` });
    contentEl.createEl("p", { text: "El tutor NO te dará la respuesta. Te hará preguntas hasta que demuestres comprensión profunda.", cls: "mnexus-label" });
    this.conversationEl = contentEl.createDiv();
    this.conversationEl.style.cssText = "max-height:400px;overflow-y:auto;border:1px solid var(--background-modifier-border);padding:8px;border-radius:6px;margin:8px 0;";
    this.inputEl = contentEl.createEl("textarea");
    this.inputEl.style.cssText = "width:100%;min-height:60px;";
    this.inputEl.placeholder = "Tu respuesta…";
    const sendBtn = contentEl.createEl("button", { text: "Responder" });
    sendBtn.onclick = () => this.send();
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.send();
      }
    });
    if (!this.tutor.isAvailable()) {
      this.conversationEl.createEl("p", { text: "⚠ Configura un LLM en Ajustes primero.", cls: "mnexus-label" });
      return;
    }
    this.session = await this.tutor.startSession({ notePath: this.file.path, pathology: this.file.basename });
    this.renderSession();
  }

  private renderSession() {
    if (!this.conversationEl || !this.session) return;
    this.conversationEl.empty();
    for (const t of this.session.turns) {
      const wrap = this.conversationEl.createDiv();
      wrap.style.cssText = "margin:4px 0;";
      const who = document.createElement("strong");
      who.textContent = t.role === "tutor" ? "Tutor: " : t.role === "student" ? "Tú: " : "";
      who.style.color = t.role === "tutor" ? "var(--text-accent)" : "var(--text-normal)";
      wrap.appendChild(who);
      const body = document.createElement("span");
      body.textContent = t.content;
      wrap.appendChild(body);
    }
    if (this.session.finalAssessment) {
      const div = this.conversationEl.createDiv();
      div.style.cssText = "margin-top:8px;padding:8px;background:var(--background-secondary);border-radius:6px;";
      div.createEl("strong", { text: "📋 Resumen final" });
      div.createEl("p", { text: this.session.finalAssessment });
      if (this.session.demonstratedKnowledge.length > 0) {
        div.createEl("p", { text: "✅ Demostraste entender:", cls: "mnexus-label" });
        const ul = div.createEl("ul");
        for (const d of this.session.demonstratedKnowledge) ul.createEl("li", { text: d });
      }
      if (this.session.gaps.length > 0) {
        div.createEl("p", { text: "⚠ Huecos:", cls: "mnexus-label" });
        const ul = div.createEl("ul");
        for (const g of this.session.gaps) ul.createEl("li", { text: g });
      }
    }
    this.conversationEl.scrollTop = this.conversationEl.scrollHeight;
  }

  private async send() {
    if (!this.session || !this.inputEl) return;
    const answer = this.inputEl.value.trim();
    if (!answer) return;
    this.inputEl.value = "";
    await this.tutor.continueSession(this.session, answer);
    this.renderSession();
  }

  onClose() {
    this.contentEl.empty();
  }
}

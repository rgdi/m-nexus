// QuickChatModal: pregunta rápida con RAG sin abrir el panel.

import { App, Modal } from "obsidian";
import { RAGChat } from "../rag/chat";
import { VectorStore } from "../rag/vectorStore";

export class QuickChatModal extends Modal {
  constructor(
    app: App,
    private chat: RAGChat,
    private store: VectorStore
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.style.minWidth = "600px";
    contentEl.createEl("h2", { text: "Pregunta rápida a tus notas" });
    contentEl.createEl("small", {
      text: `🧠 ${this.store.size()} chunks indexados`,
      cls: "mnexus-label",
    });
    const ta = contentEl.createEl("textarea") as HTMLTextAreaElement;
    ta.placeholder = "¿Qué es...? ¿Cómo actúa...? ¿Cuáles son los efectos adversos de...?";
    ta.rows = 3;
    ta.style.cssText = "width:100%;padding:8px;margin:8px 0;border-radius:4px;border:1px solid var(--background-modifier-border);";
    const out = contentEl.createDiv({ cls: "mnexus-quickchat-output" });
    out.style.cssText = "min-height:120px;max-height:300px;overflow:auto;padding:8px;background:var(--background-secondary);border-radius:4px;";
    const btnRow = contentEl.createDiv();
    btnRow.style.cssText = "display:flex;gap:6px;margin-top:8px;";
    const ask = btnRow.createEl("button", { text: "Preguntar" });
    ask.style.cssText = "flex:1;background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:6px;border-radius:4px;cursor:pointer;";
    const close = btnRow.createEl("button", { text: "Cerrar" });
    close.onclick = () => this.close();

    const submit = async () => {
      const q = ta.value.trim();
      if (!q) return;
      ask.disabled = true;
      ask.textContent = "Preguntando…";
      out.empty();
      const status = out.createEl("p", { text: "Buscando contexto…", cls: "mnexus-label" });
      try {
        const ans = out.createEl("div");
        ans.createEl("strong", { text: "Respuesta: " });
        const span = ans.createEl("span");
        span.textContent = "";
        let sources: import("../types").RAGSearchResult[] = [];
        for await (const ev of this.chat.askStream(q)) {
          if (ev.type === "sources") {
            sources = ev.data as import("../types").RAGSearchResult[];
            status.textContent = `✔ ${sources.length} chunks relevantes. Generando respuesta…`;
          } else if (ev.type === "token") {
            span.textContent += ev.data as string;
            out.scrollTop = out.scrollHeight;
          } else if (ev.type === "done") {
            status.remove();
            if (sources.length > 0) {
              const src = out.createDiv();
              src.createEl("strong", { text: "Fuentes:" });
              for (const s of sources) {
                const a = src.createEl("a", {
                  text: `• ${s.chunk.noteTitle}${s.chunk.section ? " › " + s.chunk.section : ""} (${(s.score * 100).toFixed(0)}%)`,
                });
                a.style.cssText = "display:block;cursor:pointer;color:var(--text-accent);";
                a.onclick = () => {
                  this.app.workspace.openLinkText(s.chunk.notePath, "", false);
                  this.close();
                };
              }
            }
          }
        }
      } catch (e) {
        out.empty();
        out.createEl("p", { text: "Error: " + (e as Error).message, cls: "mnexus-coverage-alert" });
      } finally {
        ask.disabled = false;
        ask.textContent = "Preguntar";
      }
    };
    ask.onclick = submit;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
  }

  onClose() { this.contentEl.empty(); }
}

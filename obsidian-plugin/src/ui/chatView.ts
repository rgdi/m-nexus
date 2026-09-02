// ChatView: panel lateral con el chat RAG. Muestra historial, fuentes y permite enviar preguntas.

import { ItemView, WorkspaceLeaf } from "obsidian";
import { ChatMessage, RAGSearchResult } from "../types";
import { RAGChat } from "../rag/chat";
import { VectorStore } from "../rag/vectorStore";
import { Logger } from "../utils/logger";
import { VIEW_TYPE_DASHBOARD, PLUGIN_NAME } from "../constants";
import { PluginLike } from "../plugin-api";

const VIEW_TYPE_CHAT = "m-nexus-chat";

export class ChatView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private chat: RAGChat,
    private store: VectorStore,
    private log: Logger,
    private plugin: PluginLike
  ) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_CHAT; }
  getDisplayText(): string { return `${PLUGIN_NAME} — Chat RAG`; }
  getIcon(): string { return "message-circle"; }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass("mnexus-panel mnexus-chat");
    this.render(root);
  }

  async onClose() {
    this.containerEl.children[1].empty();
  }

  async refresh() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    this.render(root);
  }

  private render(root: HTMLElement) {
    // Header
    const header = root.createDiv({ cls: "mnexus-chat-header" });
    header.createEl("h2", { text: "Chat RAG" });
    const idxInfo = header.createEl("small", { cls: "mnexus-label" });
    idxInfo.textContent = ` · ${this.store.size()} chunks indexados`;
    const actions = header.createDiv({ cls: "mnexus-chat-actions" });

    const newBtn = actions.createEl("button", { text: "➕" });
    newBtn.title = "Nueva conversación";
    newBtn.onclick = () => {
      this.chat.newSession();
      this.refresh();
    };
    const idxBtn = actions.createEl("button", { text: "🧠" });
    idxBtn.title = "Indexar vault (puede tardar)";
    idxBtn.onclick = async () => {
      idxBtn.textContent = "⏳";
      try {
        const r = await (this.plugin as unknown as { indexVault: () => Promise<{ indexed: number }> }).indexVault();
        idxBtn.textContent = "🧠";
        this.log.info(`Indexadas ${r.indexed} notas.`);
        this.refresh();
      } catch (e) {
        idxBtn.textContent = "🧠";
        this.log.error("Index falló: " + (e as Error).message);
      }
    };

    // Lista de sesiones
    const sessionList = root.createDiv({ cls: "mnexus-chat-sessions" });
    for (const s of this.chat.listSessions()) {
      const item = sessionList.createDiv({ cls: "mnexus-chat-session" + (this.chat.active()?.id === s.id ? " active" : "") });
      item.createEl("div", { text: s.title, cls: "title" });
      item.createEl("small", { text: new Date(s.updatedAt).toLocaleString(), cls: "mnexus-label" });
      item.onclick = () => {
        this.chat.setActive(s.id);
        this.refresh();
      };
    }

    // Mensajes de la sesión activa
    const messages = root.createDiv({ cls: "mnexus-chat-messages" });
    const active = this.chat.active();
    if (active) {
      for (const m of active.messages) {
        this.renderMessage(messages, m);
      }
      messages.scrollTop = messages.scrollHeight;
    } else {
      messages.createEl("div", { cls: "mnexus-empty", text: "Crea una nueva conversación para empezar." });
    }

    // Input
    const inputArea = root.createDiv({ cls: "mnexus-chat-input" });
    const ta = inputArea.createEl("textarea") as HTMLTextAreaElement;
    ta.placeholder = "Pregunta algo sobre tus notas… (Shift+Enter para nueva línea)";
    ta.rows = 2;
    ta.style.cssText = "width:100%;padding:6px;border-radius:4px;border:1px solid var(--background-modifier-border);";
    const send = inputArea.createEl("button", { text: "Enviar" });
    send.style.cssText = "margin-top:4px;width:100%;background:var(--interactive-accent);color:var(--text-on-accent);border:none;padding:6px;border-radius:4px;cursor:pointer;";
    const submit = async () => {
      const q = ta.value.trim();
      if (!q) return;
      ta.value = "";
      send.disabled = true;
      send.textContent = "Pensando…";
      try {
        // Crear placeholder de la respuesta del asistente que se irá rellenando
        const assistantMsg = messages.createDiv({ cls: "mnexus-chat-msg mnexus-chat-assistant streaming" });
        assistantMsg.createEl("div", { cls: "role", text: "M-NEXUS" });
        const contentEl = assistantMsg.createDiv({ cls: "content" });
        contentEl.textContent = "";
        let sources: import("../types").RAGSearchResult[] = [];
        for await (const ev of this.chat.askStream(q)) {
          if (ev.type === "sources") {
            sources = ev.data as import("../types").RAGSearchResult[];
          } else if (ev.type === "token") {
            contentEl.textContent += ev.data as string;
            messages.scrollTop = messages.scrollHeight;
          } else if (ev.type === "done") {
            // Añadir fuentes
            if (sources.length > 0) {
              const src = assistantMsg.createDiv({ cls: "sources" });
              src.createEl("small", { text: `📎 ${sources.length} fuentes`, cls: "mnexus-label" });
              for (const r of sources) {
                const a = src.createEl("a", { text: `• ${r.chunk.noteTitle}${r.chunk.section ? " › " + r.chunk.section : ""} (${(r.score * 100).toFixed(0)}%)` });
                a.style.cssText = "display:block;font-size:0.8em;color:var(--text-accent);cursor:pointer;text-decoration:none;";
                a.onclick = () => this.app.workspace.openLinkText(r.chunk.notePath, "", false);
              }
            }
            assistantMsg.classList.remove("streaming");
          }
        }
        this.refresh(); // refresca para mostrar el session title actualizado
      } catch (e) {
        const err = messages.createDiv({ cls: "mnexus-coverage-alert" });
        err.createEl("strong", { text: "Error: " });
        err.createEl("span", { text: (e as Error).message });
      } finally {
        send.disabled = false;
        send.textContent = "Enviar";
      }
    };
    send.onclick = submit;
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
  }

  private renderMessage(parent: HTMLElement, m: ChatMessage) {
    const wrap = parent.createDiv({ cls: `mnexus-chat-msg mnexus-chat-${m.role}` });
    wrap.createEl("div", { cls: "role", text: m.role === "user" ? "Tú" : "M-NEXUS" });
    wrap.createEl("div", { cls: "content", text: m.content });
    if (m.sources && m.sources.length > 0) {
      const src = wrap.createDiv({ cls: "sources" });
      src.createEl("small", { text: `📎 ${m.sources.length} fuentes`, cls: "mnexus-label" });
      src.style.cssText = "margin-top:4px;";
      for (const r of m.sources) {
        const a = src.createEl("a", { text: `• ${r.chunk.noteTitle}${r.chunk.section ? " › " + r.chunk.section : ""} (${(r.score * 100).toFixed(0)}%)` });
        a.style.cssText = "display:block;font-size:0.8em;color:var(--text-accent);cursor:pointer;text-decoration:none;";
        a.onclick = () => this.app.workspace.openLinkText(r.chunk.notePath, "", false);
      }
    }
  }
}

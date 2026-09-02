// RAG Chat: combina retriever + LLM para responder preguntas con contexto.
// Mantiene historial de sesión. Soporta streaming básico (no tokens, sino chunks).

import { ChatMessage, ChatSession, LLMMessage, MNexusSettings, RAGSearchResult, AcademicLevel } from "../types";
import { LLMProvider } from "../llm/provider";
import { Retriever } from "./retriever";
import { Logger } from "../utils/logger";
import { injectLevel } from "../levels/levelInjector";
import { LevelDetector } from "../levels/levelDetector";

const SYSTEM_PROMPT = `Eres M-NEXUS, un asistente de estudio de medicina integrado en Obsidian.
Tienes acceso al contexto de las notas del estudiante (se proporciona abajo).
Reglas:
- Responde en español, claro y conciso.
- Cita la nota/sección de donde sale la información con el formato [n] (los números se corresponden con el contexto).
- Si el contexto no contiene la respuesta, dilo explícitamente. No inventes.
- Si la pregunta es ambigua, pide aclaración breve.
- Usa terminología médica correcta.`;

export interface ChatOptions {
  topK: number;
  minScore: number;
  /** Si es true, incluye todo el historial de la sesión. */
  useHistory: boolean;
  /** Máximo de mensajes de historial a incluir. */
  maxHistory: number;
  /** v0.9: nivel académico para esta consulta. Si se omite, usa settings.userLevel. */
  level?: AcademicLevel;
}

export class RAGChat {
  private sessions = new Map<string, ChatSession>();
  private activeId: string | null = null;

  constructor(
    private settings: MNexusSettings,
    private log: Logger,
    private provider: LLMProvider,
    private retriever: Retriever
  ) {}

  newSession(title?: string): ChatSession {
    const now = new Date().toISOString();
    const s: ChatSession = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title ?? "Nueva conversación",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(s.id, s);
    this.activeId = s.id;
    return s;
  }

  getSession(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  active(): ChatSession | null {
    return this.activeId ? this.sessions.get(this.activeId) ?? null : null;
  }

  setActive(id: string): void {
    if (this.sessions.has(id)) this.activeId = id;
  }

  listSessions(): ChatSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Envía una pregunta y devuelve la respuesta del asistente.
   * Hace retrieval, construye el prompt y llama al LLM.
   */
  async ask(
    question: string,
    options: Partial<ChatOptions> = {}
  ): Promise<{ answer: string; sources: RAGSearchResult[]; session: ChatSession }> {
    const opts: ChatOptions = { topK: 5, minScore: 0.55, useHistory: true, maxHistory: 6, ...options };
    if (!this.provider.isConfigured()) {
      throw new Error("LLM no configurado. Configúralo en Ajustes → M-NEXUS → LLM.");
    }
    let session = this.active();
    if (!session) session = this.newSession();

    // Retrieval
    const sources = await this.retriever.retrieve(question, { topK: opts.topK, minScore: opts.minScore });
    const context = this.retriever.buildContext(sources);

    // Historial para mantener conversación
    const history: LLMMessage[] = opts.useHistory
      ? session.messages.slice(-opts.maxHistory).map((m) => ({ role: m.role, content: m.content }))
      : [];
    const messages: LLMMessage[] = [
      { role: "system" as const, content: SYSTEM_PROMPT + "\n\n" + context },
      ...history,
      { role: "user" as const, content: question },
    ];
    // v0.9: inyectar el nivel académico del usuario (o el de la nota activa)
    const level = opts.level ?? this.settings.userLevel;
    const finalMessages = injectLevel(messages, level, this.settings.levelAware);

    const t0 = Date.now();
    const answer = await this.provider.chat(finalMessages, {
      temperature: 0.3,
      maxTokens: 1200,
    });
    const dt = Date.now() - t0;
    this.log.info(`Chat: respuesta en ${dt}ms, ${sources.length} fuentes.`);

    // Guardar en sesión
    session.messages.push(
      { id: `m-${Date.now()}-u`, role: "user", content: question, createdAt: new Date().toISOString() },
      { id: `m-${Date.now()}-a`, role: "assistant", content: answer, sources, createdAt: new Date().toISOString() }
    );
    session.updatedAt = new Date().toISOString();
    if (session.title === "Nueva conversación") {
      session.title = question.slice(0, 60);
    }

    return { answer, sources, session };
  }

  /**
   * Versión streaming de ask. Devuelve un AsyncIterable que emite el contenido
   * token a token. La sesión se actualiza al final.
   */
  async *askStream(
    question: string,
    options: Partial<ChatOptions> = {}
  ): AsyncGenerator<{ type: "sources" | "token" | "done"; data: string | RAGSearchResult[] | { answer: string; session: ChatSession } }> {
    const opts: ChatOptions = { topK: 5, minScore: 0.55, useHistory: true, maxHistory: 6, ...options };
    if (!this.provider.isConfigured()) {
      throw new Error("LLM no configurado.");
    }
    let session = this.active();
    if (!session) session = this.newSession();

    // Retrieval
    const sources = await this.retriever.retrieve(question, { topK: opts.topK, minScore: opts.minScore });
    yield { type: "sources", data: sources };
    const context = this.retriever.buildContext(sources);

    const history: LLMMessage[] = opts.useHistory
      ? session.messages.slice(-opts.maxHistory).map((m) => ({ role: m.role, content: m.content }))
      : [];
    const messages: LLMMessage[] = [
      { role: "system" as const, content: SYSTEM_PROMPT + "\n\n" + context },
      ...history,
      { role: "user" as const, content: question },
    ];
    const level = opts.level ?? this.settings.userLevel;
    const finalMessages = injectLevel(messages, level, this.settings.levelAware);

    let fullAnswer = "";
    for await (const token of this.provider.streamChat(finalMessages, { temperature: 0.3, maxTokens: 1200 })) {
      fullAnswer += token;
      yield { type: "token", data: token };
    }

    // Persistir en sesión
    session.messages.push(
      { id: `m-${Date.now()}-u`, role: "user", content: question, createdAt: new Date().toISOString() },
      { id: `m-${Date.now()}-a`, role: "assistant", content: fullAnswer, sources, createdAt: new Date().toISOString() }
    );
    session.updatedAt = new Date().toISOString();
    if (session.title === "Nueva conversación") {
      session.title = question.slice(0, 60);
    }
    yield { type: "done", data: { answer: fullAnswer, session } };
  }

  /**
   * Resumen rápido de una nota o tema usando RAG.
   */
  async summarize(query: string, topK = 8): Promise<{ answer: string; sources: RAGSearchResult[] }> {
    const sources = await this.retriever.retrieve(query, { topK, minScore: 0.4 });
    const context = this.retriever.buildContext(sources);
    const messages: LLMMessage[] = [
      {
        role: "system" as const,
        content: "Eres un asistente que resume notas de medicina. Sintetiza los puntos clave de forma estructurada (listas, negritas). Si falta información, indícalo.",
      },
      { role: "user" as const, content: `Resume lo esencial sobre: ${query}\n\n${context}` },
    ];
    const answer = await this.provider.chat(messages, { temperature: 0.2, maxTokens: 1500 });
    return { answer, sources };
  }
}

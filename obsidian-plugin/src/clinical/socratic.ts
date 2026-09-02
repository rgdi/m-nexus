// Socratic Mode: el LLM NO da la respuesta. Hace preguntas tipo profesor
// picajoso para que el alumno razone sobre su propia nota.
//
// Patrón de diálogo:
//   1. Alumno lee la nota
//   2. Socratic propone una pregunta incisiva basada en la nota
//   3. Alumno responde
//   4. Socratic evalúa (sin decir si está bien/mal directamente) y
//      hace la siguiente pregunta que lleve más profundo
//   5. Cuando el alumno muestra comprensión, Socratic felicita y resume

import { LLMManager } from "../llm/manager";
import { Logger } from "../utils/logger";
import { App, TFile, normalizePath } from "obsidian";
import { LLMMessage } from "../types";

export interface SocraticTurn {
  role: "tutor" | "student" | "system";
  content: string;
  timestamp: string;
  /** Si el tutor considera que la explicación fue completa. */
  isComplete?: boolean;
}

export interface SocraticSession {
  notePath: string;
  pathology: string;
  turns: SocraticTurn[];
  /** Resumen final cuando se completa. */
  finalAssessment?: string;
  /** Lo que el alumno demostró entender. */
  demonstratedKnowledge: string[];
  /** Huecos detectados. */
  gaps: string[];
}

const SOCRATIC_SYSTEM = `Eres un PROFESOR UNIVERSITARIO DE MEDICINA con décadas de experiencia.
Tu misión NO es dar respuestas, sino HACER PREGUNTAS que lleven al alumno a razonar.

Reglas ABSOLUTAS:
- NUNCA des el diagnóstico o el nombre del mecanismo. Si el alumno te lo pide, responde:
  "¿Qué datos del caso te hacen pensar eso? ¿Por qué esos y no otros?"
- Cada respuesta del alumno debe ser seguida por UNA pregunta que profundice.
- Si el alumno dice algo incorrecto, NO le corrijas directamente. Pregunta:
  "¿Estás seguro? ¿Qué dice la nota sobre X? ¿Hay otra posibilidad?"
- Si el alumno llega a la conclusión correcta por sí mismo, di:
  "¡Exacto! Has llegado solo. ¿Puedes explicar POR QUÉ es así a nivel [fisiopatológico/
  molecular/anatómico]?"
- Cuando la comprensión es clara (3 respuestas coherentes seguidas), di
  "COMPRENSIÓN DEMOSTRADA" y resume brevemente qué ha demostrado entender.
- Tono: cercano pero exigente. Como un adjunto en sesión clínica.
- Máximo 3-4 frases por turno. Las preguntas deben ser CORTAS y DIRECTAS.

Tema a explorar: {{PATHOLOGY}}
Contexto: {{CONTEXT}}
Tu primera pregunta debe ser sobre la PRESENTACIÓN o MOTIVO de consulta del paciente.`;

export class SocraticTutor {
  constructor(
    private app: App,
    private llm: LLMManager,
    private log: Logger,
    private settings: import("../types").MNexusSettings,
    private levelDetector: import("../levels/levelDetector").LevelDetector,
  ) {}

  isAvailable(): boolean {
    return this.llm.isAvailable();
  }

  async startSession(opts: {
    notePath: string;
    pathology: string;
    customContext?: string;
  }): Promise<SocraticSession> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(opts.notePath));
    let context = opts.customContext ?? "";
    if (file) {
      const content = await this.app.vault.read(file as never);
      context = context ? `${context}\n\n${String(content).slice(0, 4000)}` : String(content).slice(0, 4000);
    }
    const session: SocraticSession = {
      notePath: opts.notePath,
      pathology: opts.pathology,
      turns: [],
      demonstratedKnowledge: [],
      gaps: [],
    };
    if (!this.llm.isAvailable()) {
      session.turns.push({
        role: "tutor",
        content: "⚠ El modo socrático requiere un LLM configurado. Ve a Ajustes → M-NEXUS → LLM.",
        timestamp: new Date().toISOString(),
      });
      return session;
    }
    const first = await this.ask(session, context, null);
    session.turns.push(first);
    return session;
  }

  async continueSession(session: SocraticSession, studentAnswer: string, customContext?: string): Promise<SocraticTurn> {
    session.turns.push({
      role: "student",
      content: studentAnswer,
      timestamp: new Date().toISOString(),
    });
    let context = customContext ?? "";
    if (context === "") {
      const file = this.app.vault.getAbstractFileByPath(normalizePath(session.notePath));
      if (file) context = String(await this.app.vault.read(file as never)).slice(0, 4000);
    }
    const turn = await this.ask(session, context, studentAnswer);
    session.turns.push(turn);
    if (turn.isComplete) {
      session.finalAssessment = turn.content;
      const summary = await this.summarize(session, context);
      session.demonstratedKnowledge = summary.demonstrated;
      session.gaps = summary.gaps;
    }
    return turn;
  }

  private async ask(session: SocraticSession, context: string, _studentLast?: string | null): Promise<SocraticTurn> {
    let systemContent = SOCRATIC_SYSTEM.replace("{{PATHOLOGY}}", session.pathology).replace("{{CONTEXT}}", context);
    // v0.9: inyectar nivel académico
    const level = await this.levelDetector.resolveForNote(session.notePath);
    if (this.settings.levelAware) {
      const { getLevelInfo } = await import("../levels/taxonomy");
      const info = getLevelInfo(level);
      if (info.prompt) systemContent += "\n\n" + info.prompt;
    }
    const messages: LLMMessage[] = [
      { role: "system", content: systemContent },
    ];
    for (const t of session.turns) {
      if (t.role === "system") continue;
      messages.push({ role: t.role === "tutor" ? "assistant" : "user", content: t.content });
    }
    try {
      const res = await this.llm.getProvider().chat(messages, {
        temperature: 0.6,
        maxTokens: 600,
      });
      const isComplete = /COMPRENSI[ÓO]N DEMOSTRADA/i.test(res);
      // Limpiar el marcador del contenido
      const clean = res.replace(/COMPRENSI[ÓO]N DEMOSTRADA/gi, "").trim();
      return {
        role: "tutor",
        content: clean || res,
        timestamp: new Date().toISOString(),
        isComplete,
      };
    } catch (e) {
      this.log.warn(`Socratic LLM falló: ${(e as Error).message}`);
      return {
        role: "tutor",
        content: "Error contactando con el LLM. Inténtalo de nuevo.",
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async summarize(session: SocraticSession, context: string): Promise<{ demonstrated: string[]; gaps: string[] }> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content:
          "Eres un evaluador. Analiza la conversación y devuelve JSON con dos arrays: 'demonstrated' (lo que el alumno demostró entender) y 'gaps' (lo que sigue sin quedar claro). Sin más texto.",
      },
      {
        role: "user",
        content: `Contexto:\n${context.slice(0, 2000)}\n\nConversación:\n${session.turns
          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
          .join("\n")}\n\nJSON:`,
      },
    ];
    try {
      const res = await this.llm.getProvider().chat(messages, { temperature: 0.2, maxTokens: 600, responseFormat: "json" });
      const m = res.match(/\{[\s\S]*?\}/);
      if (!m) return { demonstrated: [], gaps: [] };
      const obj = JSON.parse(m[0]) as { demonstrated?: string[]; gaps?: string[] };
      return {
        demonstrated: obj.demonstrated ?? [],
        gaps: obj.gaps ?? [],
      };
    } catch {
      return { demonstrated: [], gaps: [] };
    }
  }
}

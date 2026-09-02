// Generador de viñetas clínicas estilo USMLE / MIR.
// Toma una nota de patología y genera un caso clínico estructurado
// (presentación, antecedentes, exploración, labs, pregunta, opciones).
//
// El LLM es opcional: si está disponible, produce la viñeta rica.
// Si no, devuelve un esqueleto que el usuario puede rellenar.

import { TFile } from "obsidian";
import { LLMManager } from "../llm/manager";
import { Logger } from "../utils/logger";
import { App, normalizePath } from "obsidian";

export type VignetteStyle = "usmle" | "mir" | "osce" | "case-presentation";

export interface VignetteOption {
  letter: "A" | "B" | "C" | "D" | "E";
  text: string;
  isCorrect: boolean;
}

export interface Vignette {
  style: VignetteStyle;
  pathology: string;
  /** Presentación clínica. */
  presentation: string;
  /** Historia del paciente. */
  history?: string;
  /** Exploración física. */
  physicalExam?: string;
  /** Resultados de pruebas. */
  workup?: string;
  /** La pregunta. */
  question: string;
  /** Opciones (5 por defecto en USMLE). */
  options: VignetteOption[];
  /** Respuesta correcta con explicación. */
  correctAnswer: { letter: string; explanation: string };
  /** Metadatos extra. */
  difficulty: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  generatedAt: string;
  sourceNote: string;
}

const SYSTEM_PROMPT_BY_STYLE: Record<VignetteStyle, string> = {
  usmle: `Eres un experto en crear viñetas USMLE Step 1/2 CK.
Estructura OBLIGATORIA:
- presentation: 2-3 frases con edad, sexo, motivo de consulta
- history: antecedentes relevantes (positivos y negativos)
- physicalExam: hallazgos clave de la exploración
- workup: labs/imagen relevantes
- question: "¿Cuál es el diagnóstico más probable?" o "¿Cuál es el siguiente paso?"
- options: 5 opciones A-E, una correcta
- correctAnswer: letra + explicación fisiopatológica clara (3-5 frases)
- difficulty: 1-5
- tags: temas USMLE

Devuelve SOLO un JSON con esta estructura.`,
  mir: `Eres un experto en crear viñetas tipo MIR (examen médico español).
Estructura:
- presentation: caso clínico breve
- question: pregunta directa o de razonamiento
- options: 4-5 opciones A-D
- correctAnswer: letra + razonamiento paso a paso
- difficulty: 1-5

Devuelve SOLO JSON.`,
  osce: `Eres un experto en crear estaciones OSCE.
- presentation: contexto (consulta, planta, urgencias)
- question: tarea concreta (ej. "Realiza la anamnesis", "Comunica el diagnóstico")
- options: lista de check-items o preguntas guía
- correctAnswer: lista de elementos clave a evaluar
Devuelve SOLO JSON.`,
  "case-presentation": `Eres un adjunto de medicina. Crea una presentación de caso
para sesión clínica:
- presentation, history, physicalExam, workup
- pregunta: "¿Cuál es tu impresión diagnóstica y plan?"
- options: 3-4 diagnósticos diferenciales ordenados
- correctAnswer: diagnóstico final con justificación
Devuelve SOLO JSON.`,
};

export class VignetteGenerator {
  constructor(
    private app: App,
    private llm: LLMManager,
    private log: Logger,
    private settings: import("../types").MNexusSettings,
  ) {}

  /**
   * Genera una viñeta a partir de una nota de patología.
   * Si el LLM no está disponible, devuelve un esqueleto.
   */
  async generate(opts: {
    notePath: string;
    style: VignetteStyle;
    customContext?: string;
    /** v0.9: override del nivel académico. Si no, infiere del frontmatter. */
    level?: import("../types").AcademicLevel;
  }): Promise<Vignette> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(opts.notePath));
    if (!file) {
      throw new Error(`Nota no encontrada: ${opts.notePath}`);
    }
    const content = await this.app.vault.read(file as never);
    const pathology = opts.notePath.replace(/^.*\//, "").replace(/\.md$/i, "");
    const fm = this.parseFrontmatter(String(content));
    if (!this.llm.isAvailable()) {
      return this.skeleton(pathology, opts.style, opts.notePath);
    }
    let systemPrompt = SYSTEM_PROMPT_BY_STYLE[opts.style];
    // v0.9: inyectar nivel académico
    const level = opts.level ?? (fm.level as import("../types").AcademicLevel | undefined) ?? this.settings.userLevel;
    if (this.settings.levelAware) {
      const { getLevelInfo } = await import("../levels/taxonomy");
      const info = getLevelInfo(level);
      if (info.prompt) systemPrompt += "\n\n" + info.prompt;
    }
    const userPrompt = `Nota de patología: ${pathology}
Frontmatter: ${JSON.stringify(fm)}
Nivel académico activo: ${level}
${opts.customContext ? `Contexto extra: ${opts.customContext}` : ""}

Contenido:
${content.slice(0, 5000)}

Devuelve JSON con la estructura indicada.`;

    try {
      const raw = await this.llm.getProvider().complete(userPrompt, {
        temperature: 0.7,
        maxTokens: 2500,
        responseFormat: "json",
        systemPrompt,
      });
      const parsed = this.parseVignette(raw, pathology, opts.style, opts.notePath);
      return parsed;
    } catch (e) {
      this.log.warn(`Vignette LLM falló: ${(e as Error).message}, usando esqueleto.`);
      return this.skeleton(pathology, opts.style, opts.notePath);
    }
  }

  /** Esqueleto que el usuario puede rellenar manualmente. */
  private skeleton(pathology: string, style: VignetteStyle, notePath: string): Vignette {
    return {
      style,
      pathology,
      presentation: `[EDAD] [SEXO] acude a [servicio] por [síntoma principal]…`,
      history: "Antecedentes:",
      physicalExam: "Exploración:",
      workup: "Pruebas complementarias:",
      question: `¿Cuál es el diagnóstico más probable de ${pathology}?`,
      options: [
        { letter: "A", text: "Diagnóstico A", isCorrect: true },
        { letter: "B", text: "Diagnóstico B", isCorrect: false },
        { letter: "C", text: "Diagnóstico C", isCorrect: false },
        { letter: "D", text: "Diagnóstico D", isCorrect: false },
        { letter: "E", text: "Diagnóstico E", isCorrect: false },
      ],
      correctAnswer: { letter: "A", explanation: "Explicación del diagnóstico correcto." },
      difficulty: 3,
      tags: [pathology, style, "esqueleto"],
      generatedAt: new Date().toISOString(),
      sourceNote: notePath,
    };
  }

  private parseVignette(raw: string, pathology: string, style: VignetteStyle, notePath: string): Vignette {
    // Limpiar fences
    let json = raw.trim();
    const m = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) json = m[1].trim();
    try {
      const obj = JSON.parse(json) as Partial<Vignette>;
      const opts: VignetteOption[] = (obj.options ?? []).map((o, i) => ({
        letter: (o.letter ?? ["A", "B", "C", "D", "E"][i]) as VignetteOption["letter"],
        text: String(o.text ?? ""),
        isCorrect: Boolean(o.isCorrect),
      }));
      return {
        style,
        pathology,
        presentation: obj.presentation ?? "",
        history: obj.history,
        physicalExam: obj.physicalExam,
        workup: obj.workup,
        question: obj.question ?? `¿Cuál es el diagnóstico más probable?`,
        options: opts,
        correctAnswer: {
          letter: obj.correctAnswer?.letter ?? opts.find((o) => o.isCorrect)?.letter ?? "A",
          explanation: obj.correctAnswer?.explanation ?? "",
        },
        difficulty: (obj.difficulty as 1 | 2 | 3 | 4 | 5) ?? 3,
        tags: obj.tags ?? [pathology, style],
        generatedAt: new Date().toISOString(),
        sourceNote: notePath,
      };
    } catch {
      return this.skeleton(pathology, style, notePath);
    }
  }

  private parseFrontmatter(content: string): Record<string, string> {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const fm: Record<string, string> = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^([\w_-]+):\s*(.+)$/);
      if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
    }
    return fm;
  }
}

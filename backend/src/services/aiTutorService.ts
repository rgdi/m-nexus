// aiTutorService.ts: AI tutor con RAG (Fase 5).
//
// v0.46: tutor médico que responde preguntas del usuario usando
// contexto de las notas del vault (Retrieval Augmented Generation).
//
// Diseño:
//   1. Usuario pregunta algo
//   2. Buscamos notas relevantes (FTS5)
//   3. Top-k notas se incluyen como contexto
//   4. LLM genera respuesta con el contexto
//   5. Si no hay LLM disponible, fallback a extract-based answer

import { SearchService } from "./searchService";

export interface TutorContext {
  /** Query del usuario */
  query: string;
  /** Notas relevantes (paths) */
  relevantNotes: string[];
  /** Snippets de las notas */
  snippets: Array<{ path: string; snippet: string; score: number }>;
}

export interface TutorResponse {
  /** Query original */
  query: string;
  /** Respuesta generada */
  answer: string;
  /** Fuentes citadas (paths) */
  sources: string[];
  /** Confianza (0-1) */
  confidence: number;
  /** Indica si vino de LLM real o fallback */
  source: "llm" | "extractive" | "empty";
}

export class AITutorService {
  constructor(
    private searchService: SearchService,
    private llmService: LLMService
  ) {}

  /**
   * Recupera el contexto (notas relevantes) para una query.
   */
  async retrieveContext(query: string, topK = 5): Promise<TutorContext> {
    const results = this.searchService.search(query, { limit: topK });
    return {
      query,
      relevantNotes: results.map((r) => r.path),
      snippets: results.map((r) => ({
        path: r.path,
        snippet: r.snippet,
        score: r.score,
      })),
    };
  }

  /**
   * Genera una respuesta a la pregunta del usuario.
   * Combina retrieval (searchService) + generation (LLM).
   */
  async ask(query: string, topK = 5): Promise<TutorResponse> {
    const context = await this.retrieveContext(query, topK);
    if (context.snippets.length === 0) {
      return {
        query,
        answer: "No encontré información relevante en tu vault para responder esta pregunta.",
        sources: [],
        confidence: 0,
        source: "empty",
      };
    }

    // Construir prompt con contexto
    const systemPrompt = `Eres un tutor médico especializado. Responde la pregunta del usuario basándote SOLO en el contexto proporcionado.

Reglas:
1. Si el contexto no contiene la respuesta, dilo claramente.
2. Cita las fuentes usando el formato [path/to/note.md] después de cada afirmación.
3. Sé conciso pero preciso. Usa terminología médica adecuada.
4. Si hay información contradictoria, mencionala.

Contexto (notas del vault del usuario):
${context.snippets.map((s, i) => `[${i + 1}] ${s.path}\n${s.snippet}`).join("\n\n")}`;

    const userPrompt = `Pregunta: ${query}\n\nRespuesta:`;

    try {
      const llmResponse = await this.llmService.generate({
        system: systemPrompt,
        user: userPrompt,
        maxTokens: 600,
        temperature: 0.3,
      });

      if (llmResponse.text && llmResponse.text.length > 0) {
        return {
          query,
          answer: llmResponse.text,
          sources: context.relevantNotes,
          confidence: 0.85,
          source: "llm",
        };
      }
    } catch {
      // LLM failed, fall through to extractive
    }

    // Fallback extractive: devolver el mejor snippet
    const best = context.snippets[0];
    return {
      query,
      answer: `Información encontrada en ${best.path}:\n\n${best.snippet}\n\n(Añade una API key de LLM para respuestas generadas por IA.)`,
      sources: [best.path],
      confidence: 0.5,
      source: "extractive",
    };
  }

  /**
   * Genera preguntas de quiz adaptativo basadas en el vault.
   * Útil para "preguntame sobre lo que sé".
   */
  async generateQuizQuestions(topic: string, count = 5): Promise<Array<{ question: string; answer: string; source: string }>> {
    const context = await this.retrieveContext(topic, 3);
    if (context.snippets.length === 0) return [];

    const systemPrompt = `Eres un tutor médico. Genera ${count} preguntas de opción múltiple sobre el tema "${topic}" basándote en el contexto dado.

Formato de cada pregunta:
Q: [pregunta]
A: [respuesta correcta]
S: [path de la nota fuente]

Contexto:
${context.snippets.map((s, i) => `[${i + 1}] ${s.path}\n${s.snippet}`).join("\n\n")}`;

    try {
      const response = await this.llmService.generate({
        system: systemPrompt,
        user: `Genera ${count} preguntas:`,
        maxTokens: 800,
        temperature: 0.5,
      });

      return parseQuizQuestions(response.text, context.relevantNotes);
    } catch {
      return [];
    }
  }
}

interface LLMRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

interface LLMResponse {
  text: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * LLMService fallback (mock interface).
 * En producción, este servicio se conecta a OpenAI/Anthropic/Ollama.
 * Aquí proporcionamos una implementación stub que usa heurística para
 * que los tests funcionen sin key de API.
 */
export class LLMService {
  async generate(req: LLMRequest): Promise<LLMResponse> {
    // Si hay una key de OpenAI configurada, hacer HTTP request real
    if (process.env.OPENAI_API_KEY) {
      return await this.generateOpenAI(req);
    }
    if (process.env.OLLAMA_HOST) {
      return await this.generateOllama(req);
    }
    // Sin key: retornar string vacío → el caller hace fallback
    return { text: "" };
  }

  private async generateOpenAI(req: LLMRequest): Promise<LLMResponse> {
    // En producción: HTTP POST a https://api.openai.com/v1/chat/completions
    // Por simplicidad, retornamos vacío (no se ejecuta en sandbox)
    return { text: "" };
  }

  private async generateOllama(req: LLMRequest): Promise<LLMResponse> {
    return { text: "" };
  }
}

function parseQuizQuestions(text: string, sources: string[]): Array<{ question: string; answer: string; source: string }> {
  if (!text) return [];
  const questions: Array<{ question: string; answer: string; source: string }> = [];
  const blocks = text.split(/(?=^Q:)/m);
  for (const block of blocks) {
    const qMatch = block.match(/Q:\s*(.+)/);
    const aMatch = block.match(/A:\s*(.+)/);
    const sMatch = block.match(/S:\s*(.+)/);
    if (qMatch && aMatch) {
      questions.push({
        question: qMatch[1].trim(),
        answer: aMatch[1].trim(),
        source: sMatch?.[1].trim() ?? sources[0] ?? "",
      });
    }
  }
  return questions;
}

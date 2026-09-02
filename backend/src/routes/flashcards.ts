// Flashcards routes: genera borradores a partir de una nota (mueve lógica del plugin).
// v0.11: el plugin envía el contenido de la nota + frontmatter + nivel académico,
// el backend lo formatea, llama al LLM con el template apropiado y devuelve los
// borradores ya parseados. El plugin SOLO renderiza y aprueba.

import { FastifyInstance } from "fastify";
import { LLMService } from "../services/llm.js";

const STYLE_INSTRUCTIONS: Record<string, string> = {
  generic: `Genera flashcards variadas: basic, cloze (usa {{c1::término}}), reversed, list según el contenido.`,
  conceptual: `Genera flashcards pregunta-respuesta claras y específicas.`,
  cloze: `Genera flashcards cloze. Usa {{c1::término}} para ocultar el término clave.`,
  list: `Genera flashcards de tipo lista/pasos. Numeradas si son secuenciales.`,
  summary: `Genera 3-5 flashcards de resumen rápido.`,
};

const LEVEL_INSTRUCTIONS: Record<string, string> = {
  "1_MED": `Nivel 1_MED: usa SOLO terminología molecular/celular. NO uses terminología clínica.`,
  "2_MED": `Nivel 2_MED: usa terminología fisiológica y microbiana. Introduce conceptos funcionales.`,
  "3_MED": `Nivel 3_MED: introduce semiología y diagnóstico diferencial inicial (3-4 entidades).`,
  "4_MED": `Nivel 4_MED: plantea casos con comorbilidades, manejo escalonado, valores numéricos.`,
  "5_MED": `Nivel 5_MED: casos complejos multidisciplinares, ética, comunicación.`,
  "6_MED_MIR": `Nivel MIR/USMLE: 4-5 opciones, "siguiente paso" / "más probable", estilo examen.`,
  custom: `Sin restricción de nivel.`,
};

export interface FlashcardsRequest {
  noteTitle: string;
  noteContent: string;
  frontmatter?: Record<string, string>;
  /** Estilo del template: generic, conceptual, cloze, list, summary. */
  style?: string;
  /** Nivel académico. */
  level?: string;
  /** Número máximo de tarjetas a generar. */
  maxCards?: number;
}

export interface FlashcardDraftOut {
  id: string;
  front: string;
  back: string;
  cardType: "basic" | "cloze" | "reversed" | "list" | "image-occlusion" | "freeform";
  tags: string[];
  confidence: number;
}

export interface FlashcardsResponse {
  cards: FlashcardDraftOut[];
  model: string;
  tokens: { prompt: number; completion: number };
}

export async function flashcardsRoutes(app: FastifyInstance): Promise<void> {
  const llm = new LLMService();

  app.post("/api/v1/flashcards/generate", async (req, reply) => {
    const body = req.body as FlashcardsRequest;
    if (!body?.noteContent) {
      reply.code(400).send({ code: "BAD_REQUEST", message: "noteContent requerido" });
      return;
    }
    const style = body.style ?? "generic";
    const level = body.level ?? "1_MED";
    const maxCards = body.maxCards ?? 10;
    const styleInstr = STYLE_INSTRUCTIONS[style] ?? STYLE_INSTRUCTIONS.generic;
    const levelInstr = LEVEL_INSTRUCTIONS[level] ?? "";

    const systemPrompt = `Eres un generador de flashcards de medicina.
${styleInstr}
${levelInstr}
Responde SOLO un JSON array con la forma:
[{ "front": "...", "back": "...", "cardType": "basic|cloze|reversed|list|freeform", "tags": ["..."] }]
Sin texto extra fuera del JSON.`;

    const userPrompt = `Nota: ${body.noteTitle}
Frontmatter: ${JSON.stringify(body.frontmatter ?? {})}

Contenido:
${body.noteContent.slice(0, 8000)}

Genera hasta ${maxCards} flashcards.`;

    try {
      const res = await llm.chat({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        responseFormat: "json",
        temperature: 0.7,
      });
      const cards = parseFlashcards(res.content, maxCards);
      return {
        cards,
        model: res.model,
        tokens: res.usage ?? { prompt: 0, completion: 0 },
      };
    } catch (e) {
      reply.code(502).send({ code: "FLASHCARDS_ERROR", message: (e as Error).message });
    }
  });
}

function parseFlashcards(raw: string, max: number): FlashcardDraftOut[] {
  let json = raw.trim();
  const m = json.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) json = m[1].trim();
  try {
    const arr = JSON.parse(json) as Array<Partial<FlashcardDraftOut>>;
    return arr
      .filter((c) => c.front && c.back)
      .slice(0, max)
      .map((c, i) => ({
        id: `c-${Date.now()}-${i}`,
        front: String(c.front),
        back: String(c.back),
        cardType: (c.cardType as FlashcardDraftOut["cardType"]) ?? "basic",
        tags: Array.isArray(c.tags) ? c.tags : [],
        confidence: 0.8,
      }));
  } catch {
    return [];
  }
}

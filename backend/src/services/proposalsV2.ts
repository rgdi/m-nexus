// proposalsV2.ts: generador de proposals (flashcards, resúmenes, tags) USANDO LLM REAL (v0.46).
//
// v0.46: reemplazo del proposals.ts (regex) por integración con LLMService.
// Si el LLM no está disponible (Ollama down, sin OpenRouter key), usa fallback heurístico.
//
// Estrategia:
//   1) Intentar con LLM (Ollama local o OpenRouter cloud)
//   2) Si falla, fallback a heurística regex (proposals.ts original)
//   3) Cache: no regenerar si el hash de la nota no cambió

import { LLMService } from "./llm.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync, safeCall } from "../utils/safeCall.js";
import { logOp, logError } from "../utils/log.js";
import { createHash } from "node:crypto";
import type { VaultEvaluationResult, NoteSnapshotInput } from "./vaultEval.js";
import type { Proposal } from "./proposalsTypes.js";
import { genProposalId } from "./proposalsTypes.js";
// v0.60 (P0.5): proposals.ts (legacy heuristica) borrado por ser codigo muerto.
// Si el LLM no esta disponible, devolvemos propuesta vacia en vez de heuristica.

// Tipos de card que el LLM puede generar
type CardType = "basic" | "cloze" | "front-back" | "list" | "image-occlusion";

interface LLMGeneratedCard {
  type: CardType;
  front?: string;
  back?: string;
  /** Para cloze: "texto con {{c1::marcador}}". */
  text?: string;
  /** Para list: array de items */
  items?: string[];
  hint?: string;
  reasoning?: string;
}

interface LLMGeneratedProposal {
  type: "flashcards" | "tag-suggestion" | "link-suggestion" | "summary";
  title: string;
  description: string;
  reasoning: string;
  cards?: LLMGeneratedCard[];
  suggestedTags?: string[];
  summary?: string;
  keyPoints?: string[];
  score: number; // 0-1, qué tan buena es la proposal
}

const SYSTEM_PROMPT = `Sos un profesor de medicina experto en generar flashcards de alta calidad para spaced repetition (FSRS/SM-2).

Reglas para generar flashcards médicas de calidad:
1. CLINICAL RELEVANCE: cada card debe tener aplicación clínica real, no solo definición académica.
2. ACTIVE RECALL: la pregunta debe forzar retrieval activo, no reconocimiento pasivo.
3. PRECISION: usa terminología médica correcta (anatomía, fisiología, patología, farmacología).
4. CONTEXT: cuando aplique, incluye el contexto clínico (síntomas, diagnóstico, tratamiento).
5. NO DUPLICATES: no repitas información ya preguntada.
6. COVERAGE: prioriza conceptos de alto rendimiento (high-yield).
7. LANGUAGE: responde SIEMPRE en español a menos que se indique otro idioma.

Tipos de cards preferidos (en orden):
- "cloze": oculta una palabra clave en contexto (ideal para términos, valores, definiciones)
- "front-back": pregunta directa con respuesta (ideal para clinical vignettes)
- "list": enumerar items (ideal para differential diagnosis, mecanismos)

Devuelve SIEMPRE JSON válido.`;

/** Llama al LLM y parsea la respuesta. */
async function callLLMForProposals(
  llm: LLMService,
  note: NoteSnapshotInput,
  options: { model?: string; maxCards?: number; temperature?: number; language?: string } = {}
): Promise<LLMGeneratedProposal[]> {
  const model = options.model ?? "llama3.1:8b";
  const maxCards = options.maxCards ?? 5;
  const temperature = options.temperature ?? 0.3;
  const language = options.language ?? "español";

  const userPrompt = `Analizá la siguiente nota médica y generá ${maxCards} flashcards de alta calidad en formato JSON.

NOTA:
Título: ${note.basename ?? note.path}
Contenido:
"""
${note.content.slice(0, 4000)}
"""

Devolvé un JSON array con este formato exacto:
[
  {
    "type": "flashcards",
    "title": "Título descriptivo de la proposal",
    "description": "Qué generaste y por qué",
    "reasoning": "Por qué esta card es médicamente relevante",
    "score": 0.85,
    "cards": [
      {
        "type": "cloze",
        "text": "El {{c1::músculo diafragma}} es inervado por el nervio {{c2::frénico}} (C3-C5).",
        "hint": "Inervación",
        "reasoning": "Pregunta de alta relevancia para anatomía médica"
      },
      {
        "type": "front-back",
        "front": "¿Cuál es la función principal del diafragma?",
        "back": "Músculo principal de la inspiración. Separa las cavidades torácica y abdominal.",
        "reasoning": "Función clínica esencial"
      }
    ]
  }
]

Idioma: ${language}.
IMPORTANTE:
- Devolvé SOLO el JSON array, sin markdown, sin explicaciones adicionales.
- Las cards deben ser específicas al contenido, NO genéricas como "¿Qué es X?".
- ${maxCards} cards como máximo.`;

  const r = await safeCallAsync({
    component: "llm",
    code: "EC-LLM-010",
    message: "LLM proposals generation failed",
    context: { notePath: note.path, model, maxCards },
    op: async () => {
      return await llm.chat({
        model,
        temperature,
        maxTokens: 2000,
        responseFormat: "json",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
    },
  });
  if (!r.success || !r.value) throw r.error!;

  // Parsear JSON
  let content = r.value.content.trim();
  // A veces el LLM envuelve el JSON en ```json ... ```, limpiar
  content = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  let parsed: LLMGeneratedProposal[] | LLMGeneratedProposal;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    logError("llm", {
      code: "EC-LLM-011",
      category: "LLM",
      message: "LLM returned invalid JSON for proposals",
      context: { notePath: note.path, contentPreview: content.slice(0, 200) },
      hint: "LLM may not support responseFormat=json or returned malformed output",
    });
    throw E.llm("EC-LLM-012", "LLM returned invalid JSON", {
      context: { notePath: note.path, contentPreview: content.slice(0, 200) },
      hint: "Try a different model or set MOCK_LLM=1 for testing",
    });
  }

  // Aceptar tanto array como objeto único
  const candidates = Array.isArray(parsed) ? parsed : [parsed];

  // Validar shape: cada propuesta debe tener `type` válido y los campos requeridos
  const validTypes = new Set(["flashcards", "tag-suggestion", "link-suggestion", "summary"]);
  const valid: LLMGeneratedProposal[] = [];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const cand = c as Partial<LLMGeneratedProposal>;
    if (!cand.type || !validTypes.has(cand.type)) continue;
    if (typeof cand.title !== "string" || cand.title.length === 0) continue;
    if (typeof cand.description !== "string") continue;
    if (typeof cand.reasoning !== "string") continue;
    if (typeof cand.score !== "number" || cand.score < 0 || cand.score > 1) continue;
    valid.push(cand as LLMGeneratedProposal);
  }

  if (valid.length === 0) {
    throw E.llm("EC-LLM-013", "LLM returned JSON without valid proposals", {
      context: {
        notePath: note.path,
        contentPreview: content.slice(0, 200),
        candidatesCount: candidates.length,
      },
      hint: "LLM may be returning unexpected format; check the prompt or model",
    });
  }

  return valid;
}

/** Convierte LLMGeneratedProposal a Proposal (formato legacy compatible). */
function llmToProposal(llm: LLMGeneratedProposal, note: NoteSnapshotInput): Proposal {
  const baseProposal = {
    id: genProposalId(),
    type: llm.type, // CRÍTICO: incluir el type, sin esto la proposal es inválida
    title: llm.title,
    description: llm.description,
    reasoning: llm.reasoning,
    score: llm.score,
    confidence: llm.score,
    priority: (llm.score > 0.7 ? "high" : llm.score > 0.4 ? "medium" : "low") as "high" | "medium" | "low",
    createdAt: Date.now(),
    status: "pending" as const,
    sourceNote: note.path,
    autoApply: false,
    requiresDoubleApproval: llm.score < 0.5,
  } as Proposal;

  if (llm.type === "flashcards" && llm.cards) {
    (baseProposal as any).cards = llm.cards.map((c) => {
      if (c.type === "cloze" && c.text) {
        // Convertir cloze text a formato front-back para compatibilidad
        const clozeMatch = c.text.match(/\{\{c\d+::([^}]+?)\}\}/);
        return {
          front: c.text.replace(/\{\{c\d+::([^}]+?)\}\}/g, "$1"), // texto con respuesta visible
          back: clozeMatch?.[1] ?? c.text,
          type: "cloze",
          text: c.text,
        };
      }
      return {
        front: c.front ?? "",
        back: c.back ?? "",
        type: c.type,
      };
    });
  }

  if (llm.type === "tag-suggestion" && llm.suggestedTags) {
    (baseProposal as any).suggestedTags = llm.suggestedTags;
    (baseProposal as any).notePath = note.path;
  }

  if (llm.type === "summary") {
    (baseProposal as any).summary = llm.summary;
    (baseProposal as any).keyPoints = llm.keyPoints;
    (baseProposal as any).length = "medium";
  }

  return baseProposal;
}

// Cache de proposals (en memoria, simple)
const proposalCache = new Map<string, { hash: string; proposals: Proposal[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Genera proposals usando LLM real, con fallback heurístico. */
export async function generateProposalsV2(
  input: GenerateProposalsInput
): Promise<GenerateProposalsResult> {
  const r = await safeCallAsync<GenerateProposalsResult>({
    component: "prop",
    code: "EC-PROP-010",
    message: "generateProposalsV2 failed",
    context: { snapshotCount: input.snapshots?.length ?? 0 },
    op: async () => {
      const llm = new LLMService();
      const proposals: Proposal[] = [];
      const byType: Record<string, number> = {};

      // Intentar LLM primero
      const llmAvailable = await llm.ollamaAvailable() || Boolean(process.env.OPENROUTER_API_KEY);

      if (!llmAvailable) {
        logOp("prop", "LLM unavailable, returning empty proposals", true, {
          context: { reason: "no Ollama and no OpenRouter key" },
        });
        // v0.60 (P0.5): proposals vacias (la heuristica legacy fue removida por ser codigo muerto)
        return {
          proposals: [],
          stats: {
            generated: 0,
            byType: {},
            source: "heuristic",
          },
        };
      }

      // LLM disponible: procesar notas sin flashcards
      const notesToProcess = input.evaluation.notesWithoutFlashcards.slice(0, 5);
      for (const note of notesToProcess) {
        try {
          // Check cache
          const cacheKey = note.path;
          const contentHash = hashContent(note.content);
          const cached = proposalCache.get(cacheKey);
          if (cached && cached.hash === contentHash && Date.now() - cached.timestamp < CACHE_TTL_MS) {
            logOp("prop", "proposal cache hit", true, { notePath: note.path });
            proposals.push(...cached.proposals);
            for (const p of cached.proposals) byType[p.type] = (byType[p.type] ?? 0) + 1;
            continue;
          }

          // Llamar LLM
          const llmProposals = await callLLMForProposals(llm, note, {
            model: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
            maxCards: 5,
            temperature: 0.3,
          });

          // Convertir a Proposal
          const noteProposals = llmProposals.map((llmP) => llmToProposal(llmP, note));
          proposals.push(...noteProposals);
          for (const p of noteProposals) byType[p.type] = (byType[p.type] ?? 0) + 1;

          // Cache
          proposalCache.set(cacheKey, {
            hash: contentHash,
            proposals: noteProposals,
            timestamp: Date.now(),
          });
        } catch (err) {
          // Si falla el LLM para una nota específica, seguir con las demás
          logError("prop", {
            code: "EC-PROP-011",
            category: "PROP",
            message: "LLM proposal failed for note, continuing with next",
            context: { notePath: note.path, err: err instanceof Error ? err.message : String(err) },
          });
        }
      }

      // Tags también via LLM (opcional)
      if (input.config.autoGenerateTypes.includes("tag-suggestion") && input.evaluation.untagged.length > 0) {
        const untaggedNote = input.evaluation.untagged[0];
        try {
          const tagProposals = await callLLMForProposals(llm, untaggedNote, {
            model: process.env.OLLAMA_MODEL ?? "llama3.1:8b",
            maxCards: 1,
            temperature: 0.2,
          });
          for (const tp of tagProposals) {
            if (tp.type === "tag-suggestion" && tp.suggestedTags) {
              const proposal = llmToProposal(tp, untaggedNote);
              proposals.push(proposal);
              byType[proposal.type] = (byType[proposal.type] ?? 0) + 1;
            }
          }
        } catch (err) {
          // Silently continue
        }
      }

      return {
        proposals,
        stats: {
          generated: proposals.length,
          byType,
          source: "llm",
        },
      };
    },
  });
  return r.value ?? { proposals: [], stats: { generated: 0, byType: {} } };
}

export interface GenerateProposalsInput {
  evaluation: VaultEvaluationResult;
  snapshots: NoteSnapshotInput[];
  config: {
    autoGenerateTypes: string[];
    minScore: number;
    maxPendingProposals: number;
  };
}

export interface GenerateProposalsResult {
  proposals: Proposal[];
  stats: { generated: number; byType: Record<string, number>; source?: "llm" | "heuristic" };
}

/** Limpia el cache (útil para tests). */
export function clearProposalCache(): void {
  proposalCache.clear();
}

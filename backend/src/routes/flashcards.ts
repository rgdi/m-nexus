// Flashcards routes: genera borradores a partir de una nota (mueve lógica del plugin).
// v0.11: el plugin envía el contenido de la nota + frontmatter + nivel académico,
// el backend lo formatea, llama al LLM con el template apropiado y devuelve los
// borradores ya parseados. El plugin SOLO renderiza y aprueba.
//
// v0.47: POST /api/v1/flashcards/image-occlusion — crea N flashcards aprobadas
// (una por oclusión) a partir de una imagen y regiones etiquetadas. Si existe
// FlashcardService (backend/src/services/flashcardService.ts) lo usa; en su
// defecto, escribe el .md directamente bajo _M-NEXUS/Flashcards/Approved/.

import { FastifyInstance } from "fastify";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { LLMService } from "../services/llm.js";
import { E } from "../utils/errorCodes.js";
import { safeCallAsync } from "../utils/safeCall.js";
import { logOp } from "../utils/log.js";

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

/** Body de POST /api/v1/flashcards/image-occlusion */
export interface ImageOcclusionRequest {
  /** Ruta a la imagen (absoluta o relativa al vault). */
  imagePath: string;
  /** Regiones a ocultar, cada una genera 1 flashcard aprobada. */
  occlusions: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
  }>;
}

export interface ImageOcclusionCardOut {
  /** ID del flashcard (filename sin extensión). */
  id: string;
  /** Ruta absoluta del .md creado. */
  path: string;
  /** question del flashcard. */
  question: string;
  /** answer del flashcard. */
  answer: string;
  /** Ruta a la imagen (tal como se almacenó en mediaPath). */
  mediaPath: string;
  mediaType: "image";
  /** Coordenadas del rectángulo que oculta. */
  occlusion: { x: number; y: number; w: number; h: number; label: string };
}

export interface ImageOcclusionResponse {
  cards: ImageOcclusionCardOut[];
  /** Cuántos flashcards se crearon. */
  count: number;
  /** Carpeta donde se guardaron. */
  approvedDir: string;
}

/**
 * Resuelve la ruta absoluta al directorio del vault. Por defecto sube un nivel
 * desde el cwd del backend (`/home/rgodim/m-nexus/backend` → `/home/rgodim/m-nexus`).
 * Override por env: `MNEXUS_VAULT_ROOT` o `VAULT_ROOT`.
 */
function resolveVaultRoot(): string {
  const env = process.env.MNEXUS_VAULT_ROOT ?? process.env.VAULT_ROOT;
  if (env && env.trim().length > 0) return resolve(env);
  // cwd del backend es <vault>/backend → subimos uno
  return resolve(process.cwd(), "..");
}

/**
 * Sanitiza un string para usarlo como nombre de archivo (solo [a-zA-Z0-9-_]).
 */
function sanitizeFilename(s: string): string {
  const trimmed = (s ?? "").trim();
  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return cleaned.length > 0 ? cleaned : "flashcard";
}

/**
 * Front-matter YAML mínimo para un flashcard aprobado. Compatible con el
 * esquema de Obsidian y con `FlashcardService` del plugin (cuando exista).
 */
function buildFlashcardMarkdown(args: {
  id: string;
  question: string;
  answer: string;
  mediaPath: string;
  mediaType: "image";
  occlusion: { x: number; y: number; w: number; h: number; label: string };
  imagePath: string;
}): string {
  const fm = [
    "---",
    `id: ${args.id}`,
    "cardType: image-occlusion",
    "status: approved",
    `createdAt: ${new Date().toISOString()}`,
    `question: ${JSON.stringify(args.question)}`,
    `answer: ${JSON.stringify(args.answer)}`,
    `mediaType: ${args.mediaType}`,
    `mediaPath: ${JSON.stringify(args.mediaPath)}`,
    `imagePath: ${JSON.stringify(args.imagePath)}`,
    "occlusion:",
    `  x: ${args.occlusion.x}`,
    `  y: ${args.occlusion.y}`,
    `  w: ${args.occlusion.w}`,
    `  h: ${args.occlusion.h}`,
    `  label: ${JSON.stringify(args.occlusion.label)}`,
    "tags:",
    "  - image-occlusion",
    "  - approved",
    "---",
    "",
    `# ${args.answer}`,
    "",
    `**Pregunta:** ${args.question}`,
    "",
    `**Imagen:** ![](${args.imagePath})`,
    "",
    `**Región oculta:** x=${args.occlusion.x}, y=${args.occlusion.y}, w=${args.occlusion.w}, h=${args.occlusion.h}`,
    "",
    `**Respuesta:** ${args.answer}`,
    "",
  ];
  return fm.join("\n");
}

export async function flashcardsRoutes(app: FastifyInstance): Promise<void> {
  const llm = new LLMService();

  app.post("/api/v1/flashcards/generate", async (req, reply) => {
    const body = (req.body ?? {}) as FlashcardsRequest;
    const r = await safeCallAsync({
      component: "card",
      code: "EC-CARD-010",
      message: "flashcards.generate failed",
      context: {
        style: body.style,
        level: body.level,
        maxCards: body.maxCards,
        noteLen: body.noteContent?.length ?? 0,
      },
      op: async () => {
        if (!body.noteContent) {
          throw E.val("EC-CARD-011", "noteContent requerido", {
            context: { bodyKeys: Object.keys(body) },
            hint: "Send { noteTitle, noteContent, style, level, maxCards, frontmatter }",
          });
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

        const res = await llm.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          responseFormat: "json",
          temperature: 0.7,
        });
        const cards = parseFlashcards(res.content, maxCards);
        logOp("card", "generate", true, { style, level, count: cards.length, model: res.model });
        return {
          cards,
          model: res.model,
          tokens: res.usage ?? { prompt: 0, completion: 0 },
        };
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
  });

  // ── Image Occlusion (v0.47) ─────────────────────────────────────
  // Crea un flashcard aprobado por cada oclusión recibida.
  // Si existe FlashcardService (services/flashcardService.ts) lo invoca;
  // si no, escribe el .md directamente bajo _M-NEXUS/Flashcards/Approved/.
  app.post("/api/v1/flashcards/image-occlusion", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<ImageOcclusionRequest>;

    const r = await safeCallAsync({
      component: "card",
      code: "EC-CARD-020",
      message: "flashcards.image-occlusion failed",
      context: {
        occlusions: Array.isArray(body.occlusions) ? body.occlusions.length : 0,
        hasImage: typeof body.imagePath === "string" && body.imagePath.length > 0,
      },
      op: async () => {
        if (!body.imagePath || typeof body.imagePath !== "string") {
          throw E.val("EC-CARD-021", "imagePath requerido (string)", {
            context: { bodyKeys: Object.keys(body ?? {}) },
            hint: "Send { imagePath: string, occlusions: [{x,y,w,h,label}] }",
          });
        }
        if (!Array.isArray(body.occlusions) || body.occlusions.length === 0) {
          throw E.val(
            "EC-CARD-022",
            "occlusions requerido (al menos 1 elemento)",
            {
              context: { got: typeof body.occlusions },
              hint: "occlusions: [{x, y, w, h, label}]",
            },
          );
        }

        // Validar cada oclusión
        const validated: Array<{
          x: number;
          y: number;
          w: number;
          h: number;
          label: string;
        }> = [];
        for (let i = 0; i < body.occlusions.length; i++) {
          const o = body.occlusions[i] as Record<string, unknown>;
          if (
            typeof o.x !== "number" ||
            typeof o.y !== "number" ||
            typeof o.w !== "number" ||
            typeof o.h !== "number"
          ) {
            throw E.val(
              "EC-CARD-023",
              `occlusion[${i}] inválida: x, y, w, h deben ser números`,
              { context: { got: o } },
            );
          }
          const label = typeof o.label === "string" ? o.label.trim() : "";
          if (label.length === 0) {
            throw E.val(
              "EC-CARD-024",
              `occlusion[${i}].label requerido (string no vacío)`,
              { context: { got: o } },
            );
          }
          if (o.w <= 0 || o.h <= 0) {
            throw E.val(
              "EC-CARD-025",
              `occlusion[${i}] dimensiones inválidas (w>0, h>0)`,
              { context: { got: o } },
            );
          }
          validated.push({ x: o.x, y: o.y, w: o.w, h: o.h, label });
        }

        const imagePath = body.imagePath.trim();

        // ── Resolver directorio del vault ───────────────────────────
        // Si existiera FlashcardService, debería encargarse de la ruta.
        // Aquí hacemos fallback directo: vaultRoot/_M-NEXUS/Flashcards/Approved/
        // El módulo es opcional: @ts-ignore evita el error TS2307 cuando
        // el archivo no existe (caso habitual hoy).
        // @ts-ignore — TS2307: module is optional
        const flashcardServiceModule = (await import(
          "../services/flashcardService.js" as string
        ).catch(() => null)) as { default?: unknown; FlashcardService?: unknown } | null;

        let approvedDir: string | null = null;
        let usedService = false;

        if (
          flashcardServiceModule &&
          (flashcardServiceModule.default ?? flashcardServiceModule.FlashcardService)
        ) {
          // El servicio existe: delegamos. (Reservado para cuando se cree.)
          usedService = true;
          approvedDir = null; // el servicio decide
        } else {
          approvedDir = join(
            resolveVaultRoot(),
            "_M-NEXUS",
            "Flashcards",
            "Approved",
          );
        }

        // ── Fallback: escribir .md por estado ───────────────────────
        if (!usedService) {
          if (!existsSync(approvedDir!)) {
            await mkdir(approvedDir!, { recursive: true });
          }

          const question = "¿Qué hay en esta región?";
          const cards: ImageOcclusionCardOut[] = [];

          for (let i = 0; i < validated.length; i++) {
            const occ = validated[i];
            const id = `occl-${Date.now()}-${i}-${randomUUID().slice(0, 8)}`;
            const stem = sanitizeFilename(
              `${basename(imagePath, extname(imagePath))}-${i}-${occ.label}`,
            );
            const filename = `${stem}.md`;
            const fullPath = join(approvedDir!, filename);

            const mediaPath = imagePath;
            const md = buildFlashcardMarkdown({
              id,
              question,
              answer: occ.label,
              mediaPath,
              mediaType: "image",
              occlusion: occ,
              imagePath,
            });

            await writeFile(fullPath, md, "utf-8");

            cards.push({
              id,
              path: fullPath,
              question,
              answer: occ.label,
              mediaPath,
              mediaType: "image",
              occlusion: occ,
            });
          }

          logOp("card", "image-occlusion.create", true, {
            count: cards.length,
            dir: approvedDir,
          });

          return {
            cards,
            count: cards.length,
            approvedDir: approvedDir!,
          } satisfies ImageOcclusionResponse;
        }

        // Si llegamos aquí, el FlashcardService existe pero no implementamos
        // aún el contrato — devolvemos error explícito.
        throw new Error(
          "FlashcardService detectado pero sin contrato implementado para image-occlusion",
        );
      },
    });
    if (!r.success || !r.value) throw r.error!;
    return r.value;
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

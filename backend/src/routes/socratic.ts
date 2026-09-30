// routes/socratic.ts — el tutor, como actividad de una nota.
//
// v2.38.10
//
//   POST /api/v1/socratic/ask     una respuesta, y lo que sigue
//   GET  /api/v1/socratic/gaps    los huecos que van dejando
//   GET  /api/v1/socratic/seed    preguntas extraídas de una nota
//
// Las preguntas se extraen de la nota del usuario, no de un catálogo:
// es lo unico que hay, y hace que la referencia sea verificable porque
// el usuario puede mirar el texto del que salio.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { currentSubject, readCollection, writeCollection } from "../services/userStore.js";
import { buildGraph, loadGraph, saveGraph } from "../services/resourceGraph.js";
import {
  compare, recordGap, splitKeyTerms, judgeReasoning,
  type SocraticGap, type Reference,
} from "../services/socratic.js";
import { contentWords, normalise } from "../services/resourceIndex.js";
import { logOp } from "../utils/log.js";

const GAPS = "socratic-gaps.json";

/**
 * Extrae preguntas y su respuesta de una nota.
 *
 * Heurística y a propósito: sin modelo es la unica via que siempre
 * funciona, y una referencia mal cortada da una pregunta mala pero
 * recuperable, mientras que un modelo que falla deja al usuario sin
 * poder estudiar.
 *
 * Tres formas, en orden de lo que mejor funcionan:
 *   · "X es Y"           → "¿Qué es X?"      respuesta: Y
 *   · "X se debe a Y"     → "¿A qué se debe X?" respuesta: Y
 *   · "X son Y"           → "¿Qué son X?"     respuesta: Y
 */
export function harvest(note: { title: string; body: string }, limit = 8): { q: string; a: string }[] {
  const text = `${note.title}. ${note.body || ""}`;
  const out: { q: string; a: string }[] = [];
  const seen = new Set<string>();

  const patterns: [RegExp, (m: RegExpMatchArray) => string, (m: RegExpMatchArray) => string][] = [
    [/\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:s)?)\s+es\s+([^.;\n]{6,90})/g, (m) => `¿Qué es ${m[1]}?`, (m) => m[2].trim()],
    [/\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:s)?)\s+se debe a\s+([^.;\n]{6,90})/g, (m) => `¿A qué se debe ${m[1]}?`, (m) => m[2].trim()],
    // Igual que el de arriba, en minuscula: "La mucoviscidosis se debe a..."
    [/\b(?:La|El|Los|Las)\s+([a-záéíóúñ][\wáéíóúñ ]{2,40}?)\s+se debe a\s+([^.;\n]{6,90})/gi,
      (m) => `¿A qué se debe ${/^La\b/i.test(m[0]) ? "la " : /^Las\b/i.test(m[0]) ? "las " : /^Los\b/i.test(m[0]) ? "los " : "el "}${m[1].trim()}?`,
      (m) => m[2].trim()],
    [/\b([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:s)?)\s+son\s+([^.;\n]{6,90})/g, (m) => `¿Qué son ${m[1]}?`, (m) => m[2].trim()],
    // "La fibrosis quística es una enfermedad..." — el sujeto va en
    // minúscula, asi que el patron de arriba, que exigia mayuscula, no
    // la pillaba. Este es el que mas se usa en apuntes de medicina.
    [/\b(?:La|El|Los|Las)\s+([a-záéíóúñ][\wáéíóúñ ]{2,40}?)\s+es\s+([^.;\n]{6,90})/gi,
      (m) => `¿Qué es ${/^La\b/i.test(m[0]) ? "la " : /^Las\b/i.test(m[0]) ? "las " : /^Los\b/i.test(m[0]) ? "los " : "el "}${m[1].trim()}?`,
      (m) => m[2].trim()],
  ];

  for (const [re, q, a] of patterns) {
    for (const m of text.matchAll(re)) {
      const question = q(m);
      const answer = a(m);
      const k = normalise(question);
      if (seen.has(k) || contentWords(answer).length < 3) continue;
      seen.add(k);
      out.push({ q: question, a: answer });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export async function socraticRoutes(app: FastifyInstance): Promise<void> {
  const sub = (_req: FastifyRequest) => currentSubject();

  /** Preguntas de una nota, con su referencia. */
  app.get<{ Querystring: { noteId?: string; limit?: string } }>(
    "/api/v1/socratic/seed",
    async (req, reply) => {
      const s = sub(req);
      if (!s) return reply.code(401).send({ error: "unauthorized" });
      const noteId = req.query.noteId || "";
      const notes = await readCollection<Record<string, unknown>[]>(s, "notes.json", []);
      const note = notes.find((n) => String(n.id) === noteId);
      if (!note) return reply.code(404).send({ error: "note_not_found" });

      const qs = harvest(
        { title: String(note.title ?? ""), body: String(note.body ?? "") },
        Number(req.query.limit) || 8,
      );
      return {
        noteId,
        title: String(note.title ?? ""),
        source: { noteId, title: String(note.title ?? "") },
        questions: qs.map((q, i) => ({ id: `q${i}`, ...q })),
        note:
          qs.length < 3
            ? "Esta nota da pocas preguntas: está escrita en prosa, no en definiciones. Añade frases tipo «X es Y» y saldrán más."
            : undefined,
      };
    },
  );

  const askSchema = z.object({
    question: z.string().min(1).max(500),
    reference: z.string().min(1).max(4000),
    /** Lo que no puede decir: para detectar el modelo invertido. */
    mustNot: z.array(z.string().max(120)).optional(),
    mustInclude: z.array(z.string().max(120)).optional(),
    noteId: z.string().optional(),
    cardId: z.string().optional(),
    userAnswer: z.string().max(4000),
    /** Con modelo, si lo hay. Sin él, la capa 3 se salta. */
    useLlm: z.boolean().optional(),
  });

  app.post("/api/v1/socratic/ask", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = askSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });

    const ref: Reference = {
      answer: body.data.reference,
      mustInclude: body.data.mustInclude?.length ? body.data.mustInclude : splitKeyTerms(body.data.reference),
      mustNot: body.data.mustNot,
    };

    // Capa 1 y 2: determinista.
    let detail = compare(body.data.userAnswer, ref);

    // Capa 3: solo si el deterministic no está seguro Y hay modelo.
    let reasoning: { ok: boolean; why: string; usedLlm: boolean } | null = null;
    const uncertain = !detail || (detail.score > 0.25 && detail.score < 0.75);
    if (uncertain && body.data.useLlm) {
      // v2.38.10 — el proveedor se pregunta antes de gastar nada. Un
      // LLM para juzgar un razonamiento es la unica capa que lo
      // necesita, y si no hay ninguno se dice y se salta.
      const providers = await import("../services/aiProviders.js");
      const cfg = await providers.getAIConfig();
      const hayModelo = cfg.provider !== "mock" && Boolean(cfg.apiKey || cfg.provider === "ollama");
      reasoning = hayModelo
        ? await judgeReasoning(body.data.userAnswer, ref, (prompt) => providers.generateCompletion(prompt, { maxTokens: 80 }))
        : { ok: false, why: `No hay modelo configurado (proveedor: ${cfg.provider}). La capa de razonamiento se salta.`, usedLlm: false };
    } else if (uncertain) {
      reasoning = {
        ok: false,
        why: "Sin modelo de lenguaje solo se comprueban los términos: el razonamiento no se juzga.",
        usedLlm: false,
      };
    }

    if (body.data.noteId) {
      const gaps = await readCollection<SocraticGap[]>(s, GAPS, []);
      const g = recordGap(
        gaps.find((x) => x.noteId === body.data.noteId && x.cardId === body.data.cardId) ?? null,
        detail!,
        { noteId: body.data.noteId, cardId: body.data.cardId },
      );
      const at = gaps.findIndex((x) => x.noteId === body.data.noteId && x.cardId === body.data.cardId);
      if (at >= 0) gaps[at] = g;
      else gaps.push(g);
      await writeCollection(s, GAPS, gaps.slice(-500));
    }

    logOp("socratic", "ask", true, {
      verdict: detail?.verdict, score: detail?.score, usedLlm: reasoning?.usedLlm ?? false,
    });

    return {
      verdict: detail,
      reasoning,
      usedLlm: reasoning?.usedLlm ?? false,
      // Lo que se le enseña: el veredicto y la pregunta que sigue. El
      // detalle de los términos que faltan se queda en el log y en los
      // huecos, no en la pantalla:no es un examen.
      say: detail?.followUp ?? "Dime más.",
    };
  });

  app.get<{ Querystring: { noteId?: string } }>("/api/v1/socratic/gaps", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const all = await readCollection<SocraticGap[]>(s, GAPS, []);
    const list = req.query.noteId ? all.filter((g) => g.noteId === req.query.noteId) : all;
    return {
      count: list.length,
      // Lo peor primero: los huecos con más términos sin decir.
      gaps: list
        .sort((a, b) => b.missing.length - a.missing.length || b.attempts - a.attempts)
        .slice(0, 100),
    };
  });

  /** Reconstruir el grafo desde aquí, para quien lo necesite. */
  app.post("/api/v1/socratic/reindex", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const g = await buildGraph(s);
    await saveGraph(s, g);
    return { resources: g.resources.length, edges: g.edges.length, stats: g.stats };
  });
}

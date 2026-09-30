// routes/diagnostic.ts — "¿qué sabes ya?" y la excavación.
//
// v2.38.5
//
// Tres endpoints:
//
//   GET  /plan              qué toca hoy y por qué
//   POST /session           abre una excavación sobre un concepto
//   POST /answer/:id        una respuesta; devuelve el siguiente nivel
//   GET  /report            el resumen de la sesión
//
// El estado vive en el store por usuario de siempre. No hay tabla
// nueva: son ficheros bajo data/users/<sub>/, igual que las notas.

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  DEFAULT_DIAGNOSTIC_CONFIG,
  buildPlan,
  judge,
  narrate,
  nextStep,
  updateEstimate,
  chooseProbeLevel,
  type ExamWindow,
  type KnowledgeEstimate,
  type ProbeLevel,
  type ProbeSession,
} from "../services/diagnostic.js";
import { readCollection, writeCollection, currentSubject } from "../services/userStore.js";

const sessionSchema = z.object({
  concept: z.string().min(1).max(200),
  reason: z.enum(["initial", "stale", "exam-near", "lapse", "drill", "manual"]).default("manual"),
  daysToExam: z.number().int().optional(),
});

const answerSchema = z.object({
  level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  kind: z.enum(["open", "choice", "pivot", "control"]),
  correct: z.boolean(),
  ms: z.number().int().nonnegative().max(3_600_000),
  answer: z.string().max(4000).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  pivotChoice: z.string().max(500).optional(),
  referenceBack: z.string().max(500).optional(),
  // Para L3: cual de los controles fallo, si fallo alguno.
  failedControl: z.string().max(100).optional(),
});

/** Las sesiones vivas, por usuario. Corta vida: es una sesion de dos minutos. */
const live = new Map<string, ProbeSession & { results: unknown[]; estimate: KnowledgeEstimate }>();

const key = (sub: string, name: string) => `${sub}::${name}`;

async function loadEstimates(sub: string): Promise<KnowledgeEstimate[]> {
  const raw = await readCollection<KnowledgeEstimate[]>(sub, "diagnostic-estimates.json", []);
  return Array.isArray(raw) ? raw : [];
}

async function saveEstimates(sub: string, list: KnowledgeEstimate[]): Promise<void> {
  await writeCollection(sub, "diagnostic-estimates.json", list);
}

async function loadExams(sub: string): Promise<ExamWindow[]> {
  const raw = await readCollection<ExamWindow[]>(sub, "exams.json", []);
  return Array.isArray(raw) ? raw : [];
}

export async function diagnosticRoutes(app: FastifyInstance): Promise<void> {
  // El subject vive en el AsyncLocalStorage que instala userStore, no
  // en req.user: es lo mismo que usan las demas rutas.
  const sub = (_req: FastifyRequest) => currentSubject();

  app.get("/api/v1/diagnostic/plan", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const [estimates, exams] = await Promise.all([loadEstimates(s), loadExams(s)]);
    const plan = buildPlan(estimates, exams, Date.now(), DEFAULT_DIAGNOSTIC_CONFIG);
    return plan;
  });

  app.post("/api/v1/diagnostic/session", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = sessionSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });

    const { concept, reason, daysToExam } = body.data;
    const estimates = await loadEstimates(s);
    const estimate =
      estimates.find((e) => e.concept === concept) ??
      ({ concept, p: 0.5, observations: 0, lastVerdict: null, lastSeenAt: 0, fsrsMean: 0 } as KnowledgeEstimate);

    const level = chooseProbeLevel(estimate, { reason, daysToExam }, DEFAULT_DIAGNOSTIC_CONFIG);

    // Material cercano del mismo tema para el pivote. El store ya
    // tiene las tarjetas; se leen aqui y se filtran por folder.
    const cards = await readCollection<{ cardId: string; front: string; back: string }[]>(s, "diag-same-topic.json", [])
      .catch(() => []);
    const sameTopic = Array.isArray(cards) ? cards : [];
    const controls = await readCollection<{ id: string; question: string; options: string[] }[]>(s, "diag-controls.json", [])
      .catch(() => []);

    const step = nextStep(concept, level as ProbeLevel, { sameTopicCards: sameTopic, controls });
    if (!step) {
      return reply.code(409).send({ error: "no_probe_available", concept });
    }

    const id = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: ProbeSession & { results: unknown[]; estimate: KnowledgeEstimate } = {
      id,
      concept,
      folderId: null,
      level: level as ProbeLevel,
      steps: [step],
      createdAt: Date.now(),
      reason,
      deadline: Date.now() + 15 * 60_000,
      results: [],
      estimate,
    };
    live.set(key(s, id), session);
    return { id, concept, step, reason, level };
  });

  app.post("/api/v1/diagnostic/answer/:id", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const id = String((req.params as { id: string }).id);
    const session = live.get(key(s, id));
    if (!session) return reply.code(404).send({ error: "session_not_found" });

    const body = answerSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });
    const a = body.data;

    session.results.push({ level: a.level, kind: a.kind, correct: a.correct, ms: a.ms });

    // Bajar un nivel. El fallo en L3 no baja: es el fondo.
    const nextLevel = (a.level + 1) as ProbeLevel;
    if (a.correct || nextLevel > 3) {
      const j = judge(session.results as never, {
        cardId: null,
        confidence: a.confidence,
        pivotChoice: a.pivotChoice,
        referenceBack: a.referenceBack,
      });

      const updated = updateEstimate(
        session.estimate,
        session.concept,
        session.results as never,
        j.verdict,
        session.estimate.fsrsMean,
      );
      const estimates = await loadEstimates(s);
      const at = estimates.findIndex((e) => e.concept === session.concept);
      if (at >= 0) estimates[at] = updated;
      else estimates.push(updated);
      await saveEstimates(s, estimates);

      const items = ((await readCollection<unknown[]>(s, "diag-report.json", [])) || []) as unknown[];
      items.push({
        concept: session.concept,
        verdict: j.verdict,
        narrative: narrate({ verdict: j.verdict, estimate: updated, fsrs: j.fsrs, requeue: j.requeue, next: null }),
        when:
          j.verdict === "known"
            ? "No hace falta volver."
            : `Vuelve en ${j.fsrs.delayDays === 1 ? "mañana" : `${j.fsrs.delayDays} días`}.`,
        whenAt: Date.now() + j.fsrs.delayDays * 86_400_000,
      });
      await writeCollection(s, "diag-report.json", items.slice(-20));

      live.delete(key(s, id));
      return { done: true, ...j, estimate: updated };
    }

    const cards = await readCollection<{ cardId: string; front: string; back: string }[]>(s, "diag-same-topic.json", [])
      .catch(() => []);
    const sameTopic = Array.isArray(cards) ? cards : [];
    const controls = await readCollection<{ id: string; question: string; options: string[] }[]>(s, "diag-controls.json", [])
      .catch(() => []);

    const step = nextStep(session.concept, nextLevel, {
      sameTopicCards: sameTopic,
      controls,
      lastWrong: a.answer,
    });
    if (!step) {
      // No hay con que seguir cavando: se cierra con lo que hay.
      const j = judge(session.results as never, { cardId: null });
      live.delete(key(s, id));
      return { done: true, ...j };
    }
    session.level = nextLevel;
    return { done: false, step };
  });

  app.get("/api/v1/diagnostic/report", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const items = (await readCollection<unknown[]>(s, "diag-report.json", [])) || [];
    const estimates = await loadEstimates(s);
    return { items, estimates, nextRunAt: buildPlan(estimates, await loadExams(s), Date.now()).nextRunAt };
  });
}

// routes/ink.ts — la tinta y su sincronización.
//
// v2.38.11
//
//   POST /api/v1/ink/push    mando lo que he dibujado
//   POST /api/v1/ink/pull    que hay que no tengo
//   GET  /api/v1/ink/:docId  el documento entero, para abrirlo

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { currentSubject } from "../services/userStore.js";
import { pushInk, pullInk, getInk } from "../services/inkSync.js";

const pointSchema = z.object({
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  p: z.number().min(-1).max(1),
  t: z.number().min(0).max(600_000),
});

const strokeSchema = z.object({
  id: z.string().min(1).max(80),
  by: z.string().max(80),
  seq: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  tool: z.enum(["pen", "marker", "highlighter", "eraser"]),
  color: z.string().max(32),
  width: z.number().min(0.0005).max(0.2),
  alpha: z.number().min(0).max(1),
  points: z.array(pointSchema).max(6000),
  page: z.number().int().min(0).max(2000),
  aspect: z.number().min(0.1).max(10),
  bbox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});

export async function inkRoutes(app: FastifyInstance): Promise<void> {
  const sub = (_req: FastifyRequest) => currentSubject();

  app.post("/api/v1/ink/push", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({
      docId: z.string().min(1).max(120),
      strokes: z.array(strokeSchema).max(2000),
      seq: z.number().int().nonnegative(),
      deviceId: z.string().min(1).max(80),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });
    return pushInk(s, body.data);
  });

  app.post("/api/v1/ink/pull", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    const body = z.object({ docId: z.string().min(1), since: z.number().int().nonnegative() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", detail: body.error.issues });
    return pullInk(s, body.data);
  });

  app.get<{ Params: { docId: string } }>("/api/v1/ink/:docId", async (req, reply) => {
    const s = sub(req);
    if (!s) return reply.code(401).send({ error: "unauthorized" });
    return getInk(s, req.params.docId);
  });
}

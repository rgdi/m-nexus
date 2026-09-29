// routes/resources.ts — v2.38.1 study material from a folder.
//
//   POST /api/v1/resources/generate
//     { kind, folderId?, topic?, limit?, useLlm? }
//
// Four kinds, all grounded in the folder-scoped index:
//
//   summary    — plan the sections first, then write each one against
//                that plan with a bounded recap of what came before
//   flashcards — a deck you can study right now
//   quiz       — multiple choice with distractors from the same notes
//   mindmap    — deterministic, no model, works offline
//
// Every output carries the chunk ids it used, so "made from your notes"
// is a claim you can check rather than a label on a button.

import type { FastifyInstance } from "fastify";
import { generateResource, RESOURCE_KINDS, type ResourceKind } from "../services/resourceGenerator.js";
import { E } from "../utils/errorCodes.js";

export function registerResourceRoutes(app: FastifyInstance): void {
  app.get("/api/v1/resources/kinds", async () => ({ kinds: RESOURCE_KINDS }));

  app.post<{
    Body: {
      kind?: ResourceKind;
      folderId?: string | null;
      topic?: string;
      limit?: number;
      useLlm?: boolean;
    };
  }>("/api/v1/resources/generate", async (req, reply) => {
    const b = req.body ?? {};
    const kind = b.kind as ResourceKind;
    if (!RESOURCE_KINDS.some((k) => k.kind === kind)) {
      throw E.val("EC-RES-001", `kind inválido: ${String(b.kind)}`, {
        context: { allowed: RESOURCE_KINDS.map((k) => k.kind) },
        statusCode: 400,
      });
    }
    const result = await generateResource({
      kind,
      folderId: b.folderId ?? null,
      topic: b.topic ?? "",
      ...(typeof b.limit === "number" ? { limit: Math.min(30, Math.max(3, b.limit)) } : {}),
      useLlm: b.useLlm === true,
    });
    // Nothing in scope is a client problem, not a server error, but the
    // empty body is the useful answer either way.
    if (result.sources.length === 0) reply.code(200);
    return result;
  });
}

// occlusion.ts — Image Occlusion HTTP routes (v2.8.0).
//
// POST   /api/v1/occlusion/card         → create card from image + masks
// GET    /api/v1/occlusion/card/:id     → fetch card + masks
// POST   /api/v1/occlusion/card/:id/mask → add mask to existing card
// DELETE /api/v1/occlusion/card/:id/mask/:maskId → remove mask
// GET    /api/v1/occlusion/cards        → list cards (optional ?topicId=)

import type { FastifyPluginAsync } from "fastify";
import {
  createOcclusionCard,
  getOcclusionCard,
  addOcclusionMask,
  removeOcclusionMask,
  listOcclusionCards,
} from "../services/imageOcclusionService.js";
import { E } from "../utils/errorCodes.js";

export const occlusionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/occlusion/card", async (req, reply) => {
    const body = (req.body as any) || {};
    if (!body.imageUrl && !body.imageBase64) {
      reply.code(400);
      throw E.val("EC-OC-001", "imageUrl or imageBase64 required");
    }
    if (!body.topicId) {
      reply.code(400);
      throw E.val("EC-OC-002", "topicId required");
    }
    const card = await createOcclusionCard({
      imageUrl: body.imageUrl,
      imageBase64: body.imageBase64,
      topicId: body.topicId,
      sourceNoteId: body.sourceNoteId,
      masks: body.masks || [],
    });
    return { ok: true, card };
  });

  app.get("/occlusion/cards", async (req) => {
    const topicId = (req.query as any)?.topicId;
    const cards = await listOcclusionCards(topicId);
    return { cards };
  });

  app.get<{ Params: { id: string } }>("/occlusion/card/:id", async (req, reply) => {
    const card = await getOcclusionCard(req.params.id);
    if (!card) {
      reply.code(404);
      throw E.val("EC-OC-003", "Card not found", { statusCode: 404 });
    }
    return { card };
  });

  app.post<{ Params: { id: string } }>("/occlusion/card/:id/mask", async (req, reply) => {
    const body = (req.body as any) || {};
    const updated = await addOcclusionMask(req.params.id, {
      x: body.x,
      y: body.y,
      width: body.width,
      height: body.height,
      label: body.label || "Region",
    });
    if (!updated) {
      reply.code(404);
      throw E.val("EC-OC-003", "Card not found", { statusCode: 404 });
    }
    return { ok: true, card: updated };
  });

  app.delete<{ Params: { id: string; maskId: string } }>("/occlusion/card/:id/mask/:maskId", async (req, reply) => {
    const ok = await removeOcclusionMask(req.params.id, Number(req.params.maskId));
    return { ok };
  });
};

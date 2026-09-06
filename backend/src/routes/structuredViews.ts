// Structured routes: views CRUD.

import type { FastifyInstance } from "fastify";
import type { ViewSchema } from "../services/structuredNotes.js";
import { vaultDatabases, vaultViews, getOrCreate } from "./structuredStore.js";
import { genId } from "../services/structuredNotes.js";

export async function registerViewRoutes(app: FastifyInstance): Promise<void> {

  app.get<{ Params: { id: string } }>("/api/v1/databases/:id/views", async (req, reply) => {
    for (const [, byDb] of vaultViews) {
      const dbViews = byDb.get(req.params.id);
      if (dbViews) {
        return reply.send({ views: Array.from(dbViews.values()) });
      }
    }
    return reply.send({ views: [] });
  });

  app.post<{ Params: { id: string }; Body: Partial<ViewSchema> }>(
    "/api/v1/databases/:id/views",
    async (req, reply) => {
      const body = req.body;
      if (!body?.name || !body?.type) {
        return reply.code(400).send({ code: "INVALID", message: "name and type required" });
      }
      const valid = ["table", "kanban", "calendar", "gallery", "list"];
      if (!valid.includes(body.type)) {
        return reply.code(400).send({ code: "INVALID", message: `type must be one of ${valid.join(", ")}` });
      }
      const view: ViewSchema = {
        id: genId(),
        databaseId: req.params.id,
        name: body.name,
        type: body.type,
        config: body.config ?? { type: body.type, hiddenColumns: [] } as ViewSchema["config"],
        createdAt: Date.now(),
      };
      // Find which vault owns this database
      for (const [vaultId, dbs] of vaultDatabases) {
        if (dbs.has(req.params.id)) {
          const byDb = getOrCreate(vaultViews, vaultId, () => new Map());
          const dbViews = getOrCreate(byDb, req.params.id, () => new Map());
          dbViews.set(view.id, view);
          break;
        }
      }
      return reply.send({ view });
    }
  );
}

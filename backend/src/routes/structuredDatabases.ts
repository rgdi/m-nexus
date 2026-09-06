// Structured routes: databases CRUD.

import type { FastifyInstance } from "fastify";
import type { DatabaseSchema } from "../services/structuredNotes.js";
import { genId } from "../services/structuredNotes.js";
import { vaultDatabases, vaultRows, vaultViews, getOrCreate } from "./structuredStore.js";
import { logger } from "../utils/log.js";

export async function registerDatabaseRoutes(app: FastifyInstance): Promise<void> {

  app.get("/api/v1/databases", async (req, reply) => {
    const vaultId = (req.query as { vaultId?: string }).vaultId ?? "default";
    const dbs = Array.from((vaultDatabases.get(vaultId) ?? new Map()).values());
    return reply.send({ databases: dbs, count: dbs.length });
  });

  app.post<{ Body: Partial<DatabaseSchema> & { vaultId: string } }>("/api/v1/databases", async (req, reply) => {
    const body = req.body;
    if (!body?.vaultId || !body?.name || !body?.folder || !body?.properties) {
      return reply.code(400).send({ code: "INVALID", message: "vaultId, name, folder, properties required" });
    }
    if (!Array.isArray(body.properties) || body.properties.length === 0) {
      return reply.code(400).send({ code: "INVALID", message: "properties must be a non-empty array" });
    }
    // Validar schema
    for (const p of body.properties) {
      if (!p.name || !p.type) {
        return reply.code(400).send({ code: "INVALID", message: "each property needs name and type" });
      }
    }
    const id = genId();
    const now = Date.now();
    const db: DatabaseSchema = {
      id,
      vaultId: body.vaultId,
      name: body.name,
      folder: body.folder,
      properties: body.properties,
      titleProperty: body.titleProperty ?? body.properties[0].name,
      createdAt: now,
      updatedAt: now,
    };
    const map = getOrCreate(vaultDatabases, body.vaultId, () => new Map());
    map.set(id, db);
    getOrCreate(vaultRows, body.vaultId, () => new Map());
    getOrCreate(vaultViews, body.vaultId, () => new Map());
    logger.info({ dbId: id, name: db.name, vault: body.vaultId }, "Database created");
    return reply.send({ database: db });
  });

  app.get<{ Params: { id: string } }>("/api/v1/databases/:id", async (req, reply) => {
    for (const dbs of vaultDatabases.values()) {
      const db = dbs.get(req.params.id);
      if (db) return reply.send({ database: db });
    }
    return reply.code(404).send({ code: "NOT_FOUND" });
  });

  app.patch<{ Params: { id: string }; Body: Partial<DatabaseSchema> }>(
    "/api/v1/databases/:id",
    async (req, reply) => {
      for (const dbs of vaultDatabases.values()) {
        const db = dbs.get(req.params.id);
        if (db) {
          if (req.body.name) db.name = req.body.name;
          if (req.body.folder) db.folder = req.body.folder;
          if (req.body.properties) db.properties = req.body.properties;
          if (req.body.titleProperty) db.titleProperty = req.body.titleProperty;
          db.updatedAt = Date.now();
          return reply.send({ database: db });
        }
      }
      return reply.code(404).send({ code: "NOT_FOUND" });
    }
  );

  app.delete<{ Params: { id: string } }>("/api/v1/databases/:id", async (req, reply) => {
    for (const [vaultId, dbs] of vaultDatabases) {
      if (dbs.has(req.params.id)) {
        dbs.delete(req.params.id);
        vaultRows.get(vaultId)?.delete(req.params.id);
        vaultViews.get(vaultId)?.delete(req.params.id);  // byDb (databaseId -> views)
        return reply.send({ ok: true });
      }
    }
    return reply.code(404).send({ code: "NOT_FOUND" });
  });
}

// Structured notes routes: Notion-style databases.
//
// v0.33: el plugin de Obsidian puede crear "databases" con propiedades
// tipadas, y el backend las sincroniza entre devices.
//
// Endpoints:
//   GET    /api/v1/databases                  → lista databases del vault
//   POST   /api/v1/databases                  → crea database
//   GET    /api/v1/databases/:id              → info
//   PATCH  /api/v1/databases/:id              → actualiza schema
//   DELETE /api/v1/databases/:id              → borra
//
//   GET    /api/v1/databases/:id/rows         → lista rows (con filtros/sort)
//   POST   /api/v1/databases/:id/rows         → crea row
//   PATCH  /api/v1/databases/:id/rows/:rowId  → update
//   DELETE /api/v1/databases/:id/rows/:rowId  → borra
//
//   GET    /api/v1/databases/:id/views        → lista vistas
//   POST   /api/v1/databases/:id/views        → crea vista

import { FastifyInstance } from "fastify";
import { ConflictResolver } from "../services/conflictResolver.js";
import {
  DatabaseSchema,
  NoteRow,
  ViewSchema,
  applyFilters,
  applySorts,
  evalFormula,
  genId,
  hashContent,
  validatePropertyValue,
  ValidationError,
  Filter,
  SortRule,
} from "../services/structuredNotes.js";
import { logger } from "../utils/log.js";

// In-memory store (en producción esto va a SQLite)
// Estructura: vaultId -> Map<databaseId, DatabaseSchema>
//            vaultId -> Map<databaseId, Map<rowId, NoteRow>>
//            vaultId -> Map<databaseId, Map<viewId, ViewSchema>>
const vaultDatabases = new Map<string, Map<string, DatabaseSchema>>();
// vaultRows: vaultId -> Map<databaseId -> Map<rowId, NoteRow>>
const vaultRows = new Map<string, Map<string, Map<string, NoteRow>>>();
// vaultViews: vaultId -> Map<databaseId -> Map<viewId, ViewSchema>>
const vaultViews = new Map<string, Map<string, Map<string, ViewSchema>>>();
const resolver = new ConflictResolver();

function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let v = map.get(key);
  if (!v) {
    v = factory();
    map.set(key, v);
  }
  return v;
}

export async function structuredRoutes(app: FastifyInstance): Promise<void> {
  // ─── Databases ──────────────────────────────────────────

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

  // ─── Rows ────────────────────────────────────────────────

  app.get<{
    Params: { id: string };
    Querystring: { filters?: string; sort?: string; limit?: number; offset?: number };
  }>("/api/v1/databases/:id/rows", async (req, reply) => {
    let db: DatabaseSchema | null = null;
    let rowsMap: Map<string, NoteRow> | null = null;
    for (const [vaultId, dbs] of vaultDatabases) {
      if (dbs.has(req.params.id)) {
        db = dbs.get(req.params.id)!;
        rowsMap = vaultRows.get(vaultId)?.get(req.params.id) ?? new Map();
        break;
      }
    }
    if (!db) return reply.code(404).send({ code: "NOT_FOUND" });
    let rows = Array.from(rowsMap!.values());
    try {
      const filters: Filter[] = req.query.filters ? JSON.parse(req.query.filters) : [];
      const sort: SortRule[] = req.query.sort ? JSON.parse(req.query.sort) : [];
      rows = applyFilters(rows, filters);
      rows = applySorts(rows, sort);
    } catch (e) {
      return reply.code(400).send({ code: "BAD_QUERY", message: (e as Error).message });
    }
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 100);
    const paged = rows.slice(offset, offset + limit);
    return reply.send({ rows: paged, total: rows.length, offset, limit });
  });

  app.post<{ Params: { id: string }; Body: Partial<NoteRow> & { path: string } }>(
    "/api/v1/databases/:id/rows",
    async (req, reply) => {
      let db: DatabaseSchema | null = null;
      let rowsMap: Map<string, NoteRow> | null = null;
      for (const [vaultId, dbs] of vaultDatabases) {
        if (dbs.has(req.params.id)) {
          db = dbs.get(req.params.id)!;
          const byDb = getOrCreate(vaultRows, vaultId, () => new Map());
          rowsMap = getOrCreate(byDb, req.params.id, () => new Map());
          break;
        }
      }
      if (!db) return reply.code(404).send({ code: "NOT_FOUND" });
      const body = req.body;
      if (!body?.path || !body?.properties) {
        return reply.code(400).send({ code: "INVALID", message: "path and properties required" });
      }
      // Validar cada propiedad contra el schema
      for (const p of db.properties) {
        if (p.type === "formula") continue; // skip formulas
        const v = body.properties[p.name];
        const res = validatePropertyValue(p, v);
        if (!res.ok) {
          return reply.code(400).send({ code: "VALIDATION_ERROR", field: p.name, message: res.error });
        }
      }
      const deviceId = (req as { auth?: { sub?: string } }).auth?.sub ?? "unknown";
      const now = Date.now();
      const id = genId();
      const row: NoteRow = {
        id,
        databaseId: db.id,
        path: body.path,
        properties: body.properties,
        createdAt: now,
        updatedAt: now,
        clock: resolver.incrementClock({}, deviceId),
        contentHash: hashContent(body.properties, ""),
      };
      rowsMap!.set(id, row);
      return reply.send({ row });
    }
  );

  // PATCH con conflict resolution
  app.patch<{
    Params: { id: string; rowId: string };
    Body: { properties: Record<string, unknown>; expectedClock?: Record<string, number>; body?: string };
  }>("/api/v1/databases/:id/rows/:rowId", async (req, reply) => {
    let db: DatabaseSchema | null = null;
    let rowsMap: Map<string, NoteRow> | null = null;
    for (const [vaultId, dbs] of vaultDatabases) {
      if (dbs.has(req.params.id)) {
        db = dbs.get(req.params.id)!;
        const byDb = vaultRows.get(vaultId);
        rowsMap = byDb?.get(req.params.id) ?? null;
        break;
      }
    }
    if (!db) return reply.code(404).send({ code: "NOT_FOUND" });
    const local = rowsMap!.get(req.params.rowId);
    if (!local) return reply.code(404).send({ code: "NOT_FOUND" });
    const deviceId = (req as { auth?: { sub?: string } }).auth?.sub ?? "unknown";
    const body = req.body;

    // Conflict detection
    if (body.expectedClock) {
      const cmp = resolver.compareClocks(body.expectedClock, local.clock);
      if (cmp < 0) {
        // Local clock es mayor: el cliente está desactualizado
        return reply.code(409).send({
          code: "CONFLICT",
          message: "Local version is newer than expected",
          currentClock: local.clock,
          currentProperties: local.properties,
        });
      }
    }

    // Validar properties nuevas
    for (const p of db.properties) {
      if (p.type === "formula") continue;
      const v = body.properties[p.name];
      if (v !== undefined) {
        const res = validatePropertyValue(p, v);
        if (!res.ok) {
          return reply.code(400).send({ code: "VALIDATION_ERROR", field: p.name, message: res.error });
        }
      }
    }

    // Merge: si vienen algunos campos, los demás se mantienen
    const merged = { ...local.properties, ...body.properties };
    const now = Date.now();
    const newClock = resolver.incrementClock(local.clock, deviceId);
    const updated: NoteRow = {
      ...local,
      properties: merged,
      updatedAt: now,
      clock: newClock,
      contentHash: hashContent(merged, body.body ?? ""),
    };
    rowsMap!.set(updated.id, updated);
    return reply.send({ row: updated });
  });

  app.delete<{ Params: { id: string; rowId: string } }>(
    "/api/v1/databases/:id/rows/:rowId",
    async (req, reply) => {
      for (const [, rowsMap] of vaultRows) {
        if (rowsMap.has(req.params.rowId)) {
          rowsMap.delete(req.params.rowId);
          return reply.send({ ok: true });
        }
      }
      return reply.code(404).send({ code: "NOT_FOUND" });
    }
  );

  // ─── Vistas ──────────────────────────────────────────────

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

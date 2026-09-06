// Structured routes: rows CRUD.

import type { FastifyInstance } from "fastify";
import type { NoteRow } from "../services/structuredNotes.js";
import { vaultDatabases, vaultRows } from "./structuredStore.js";

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


export async function registerRowRoutes(app: FastifyInstance): Promise<void> {
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


  app.get<{ Params: { id: string } }>("/api/v1/databases/:id/views", async (req, reply) => {
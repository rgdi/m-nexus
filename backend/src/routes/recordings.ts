// recordings.ts: REST CRUD para grabaciones de audio.
// v1.5.4 — audio recorder con auto-asignación de asignatura.

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { readCollection, writeCollection, currentSubject } from "../services/userStore.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface Recording {
  id: string;
  subject: string;
  subjectName: string;
  durationSec: number;
  transcript: string;
  createdAt: number;
  sizeBytes: number;
}


class RecordingsService {
  /** v2.38.2: per user — see SubjectsService. A recording is one of the
   *  most personal things the app holds. */
  private cache = new Map<string, Recording[]>();

  async all(): Promise<Recording[]> {
    const sub = currentSubject();
    const hit = this.cache.get(sub);
    if (hit) return hit;
    const list = await readCollection<Recording[]>(sub, "recordings.json", []);
    this.cache.set(sub, list);
    return list;
  }

  async create(input: Partial<Recording>): Promise<Recording> {
    const list = await this.all();
    const r: Recording = {
      id: `rec-${randomUUID()}`,
      subject: input.subject ?? "",
      subjectName: input.subjectName ?? "",
      durationSec: input.durationSec ?? 0,
      transcript: input.transcript ?? "",
      createdAt: input.createdAt ?? Date.now(),
      sizeBytes: input.sizeBytes ?? 0,
    };
    list.push(r);
    this.cache.set(currentSubject(), list);
    await this.save(list);
    return r;
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const next = list.filter((r) => r.id !== id);
    if (next.length === list.length) return false;
    this.cache.set(currentSubject(), next);
    await this.save(next);
    return true;
  }

  private async save(list?: Recording[]): Promise<void> {
    const sub = currentSubject();
    const value = list ?? this.cache.get(sub);
    if (!value) return;
    await writeCollection(sub, "recordings.json", value);
  }
}

const svc = new RecordingsService();

export async function recordingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/recordings", async () => {
    const list = await svc.all();
    return { recordings: list, total: list.length };
  });

  app.post<{ Body: Partial<Recording> }>("/recordings", async (req, reply) => {
    const r = await svc.create(req.body ?? {});
    reply.code(201);
    logOp("recordings", "created", true, { id: r.id, subject: r.subjectName, duration: r.durationSec });
    return r;
  });

  app.delete<{ Params: { id: string } }>("/recordings/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-REC-001", "Recording no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });

  // v1.5.4: filtrar por asignatura
  app.get<{ Querystring: { subject?: string } }>("/recordings/filter", async (req) => {
    const list = await svc.all();
    const { subject } = req.query;
    let filtered = list;
    if (subject) filtered = filtered.filter((r) => r.subject === subject);
    return { recordings: filtered, total: filtered.length };
  });
}

// subjects.ts: REST CRUD para asignaturas.
// v2.22.1 — dinámico y personalizable en todo momento.
// v2.22.1 — eliminada la seed de "Mr. Meier", "Fr. Stolz", "Dr. Seibert"… que
//           hacía que cada usuario nuevo viera el instituto ficticio de un
//           alumno alemán. Ahora subjects.json empieza vacío. El setup
//           wizard ofrece añadir, y la pantalla de Subjects permite CRUD
//           completo (add/edit/delete/reorder/color picker) en cualquier
//           momento, no solo en el onboarding.
//
// Modelo: cada subject tiene id, name, icon (1-2 chars), color (CSS var),
// grade (0-10), performance (% change), prof (teacher), next (próxima clase),
// order (position en la lista — menor = primero).

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";
import { logOp } from "../utils/log.js";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export interface Subject {
  id: string;
  name: string;
  icon: string;
  color: string;
  grade: number | null;
  performance: number;
  prof: string;
  next: string;
  order?: number;
  createdAt: number;
  updatedAt: number;
}

const DATA_FILE = join(process.cwd(), "data", "subjects.json");

export class SubjectsService {
  private cache: Subject[] | null = null;

  async all(): Promise<Subject[]> {
    if (this.cache) return this.cache;
    try {
      const buf = await fs.readFile(DATA_FILE, "utf-8");
      const parsed = JSON.parse(buf);
      this.cache = Array.isArray(parsed) ? parsed : [];
      return this.cache!;
    } catch {
      this.cache = [];
      await this.save();
      return this.cache;
    }
  }

  async get(id: string): Promise<Subject | undefined> {
    return (await this.all()).find((s) => s.id === id);
  }

  async create(input: Omit<Subject, "id" | "createdAt" | "updatedAt">): Promise<Subject> {
    const list = await this.all();
    const maxOrder = list.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
    const s: Subject = {
      ...input,
      id: `sub-${randomUUID()}`,
      order: input.order ?? maxOrder + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    list.push(s);
    await this.save();
    return s;
  }

  async update(id: string, patch: Partial<Subject>): Promise<Subject | null> {
    const list = await this.all();
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: Date.now() };
    await this.save();
    return list[i];
  }

  async remove(id: string): Promise<boolean> {
    const list = await this.all();
    const before = list.length;
    const next = list.filter((s) => s.id !== id);
    if (next.length === before) return false;
    this.cache = next;
    await this.save();
    return true;
  }

  /**
   * v2.22.1: bulk import (replaces entire list). Used by "Import" button
   * or by migration scripts. Returns the new list.
   */
  async bulkReplace(items: Array<Omit<Subject, "id" | "createdAt" | "updatedAt" | "order">>): Promise<Subject[]> {
    const now = Date.now();
    const next: Subject[] = items.map((it, idx) => ({
      ...it,
      id: `sub-${randomUUID()}`,
      order: idx,
      createdAt: now,
      updatedAt: now,
    }));
    this.cache = next;
    await this.save();
    return next;
  }

  /**
   * v2.22.1: reorder — accepts ordered id list, updates .order field.
   */
  async reorder(orderedIds: string[]): Promise<Subject[]> {
    const list = await this.all();
    const map = new Map(list.map((s) => [s.id, s]));
    const next: Subject[] = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const s = map.get(orderedIds[i]);
      if (!s) continue;
      next.push({ ...s, order: i, updatedAt: Date.now() });
    }
    // Add any subjects that weren't in the list (defensive).
    for (const s of list) {
      if (!orderedIds.includes(s.id)) next.push({ ...s, order: next.length, updatedAt: Date.now() });
    }
    this.cache = next;
    await this.save();
    return next;
  }

  /**
   * v2.22.1: delete ALL subjects for the current user. Used by "Reset"
   * button. Returns count deleted.
   */
  async removeAll(): Promise<number> {
    const list = await this.all();
    const n = list.length;
    this.cache = [];
    await this.save();
    return n;
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}

const svc = new SubjectsService();
export const subjectsServiceInstance = svc;

export async function subjectsRoutes(app: FastifyInstance): Promise<void> {
  // v2.22.1: NO auto-seed. subjects.json starts empty. The user adds what
  // they want via the setup wizard or the Subjects screen at any time.

  app.get("/subjects", async () => {
    const list = await svc.all();
    // Sort by .order (ascending) — undefined order goes last.
    const sorted = [...list].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
    return { subjects: sorted, total: sorted.length };
  });

  app.get<{ Params: { id: string } }>("/subjects/:id", async (req) => {
    const s = await svc.get(req.params.id);
    if (!s) throw E.val("EC-SUB-001", "Subject no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return s;
  });

  app.post<{ Body: Partial<Subject> }>("/subjects", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.name || !b.name.trim()) throw E.val("EC-SUB-002", "name requerido", { context: { body: b } });
    const s = await svc.create({
      name: b.name.trim(),
      icon: b.icon ?? (b.name.trim()[0] ?? "?").toUpperCase(),
      color: b.color ?? "var(--subj-blue)",
      grade: b.grade ?? null,
      performance: b.performance ?? 0,
      prof: b.prof ?? "",
      next: b.next ?? "",
    });
    reply.code(201);
    logOp("subjects", "created", true, { id: s.id, name: s.name });
    return s;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Subject> }>("/subjects/:id", async (req) => {
    const s = await svc.update(req.params.id, req.body ?? {});
    if (!s) throw E.val("EC-SUB-003", "Subject no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    logOp("subjects", "updated", true, { id: s.id });
    return s;
  });

  app.delete<{ Params: { id: string } }>("/subjects/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-SUB-004", "Subject no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    logOp("subjects", "deleted", true, { id: req.params.id });
    return { deleted: true };
  });

  // v2.22.1: reorder endpoint — PATCH /api/v1/subjects/reorder with
  // { order: ["sub-xxx", "sub-yyy", ...] }. Persists new .order on each subject.
  app.patch<{ Body: { order: string[] } }>("/subjects/reorder", async (req) => {
    const ids = (req.body ?? ({} as any)).order;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string")) {
      throw E.val("EC-SUB-005", "order must be string[]", { context: { body: req.body }, statusCode: 400 });
    }
    const list = await svc.reorder(ids);
    return { ok: true, subjects: list };
  });

  // v2.22.1: bulk replace — POST /api/v1/subjects/bulk with { items: [...] }.
  // Replaces the entire list. Used by "Reset / Import from another device".
  app.post<{ Body: { items: any[] } }>("/subjects/bulk", async (req) => {
    const items = (req.body ?? ({} as any)).items;
    if (!Array.isArray(items)) {
      throw E.val("EC-SUB-006", "items must be array", { context: { body: req.body }, statusCode: 400 });
    }
    const list = await svc.bulkReplace(items);
    logOp("subjects", "bulk_replace", true, { count: list.length });
    return { ok: true, subjects: list };
  });

  // v2.22.1: nuke all — DELETE /api/v1/subjects (no :id). Used by "Reset subjects"
  // button (e.g. when the user starts fresh with a new school year).
  app.delete("/subjects", async () => {
    const n = await svc.removeAll();
    logOp("subjects", "removed_all", true, { count: n });
    return { ok: true, removed: n };
  });
}

// v2.22.1: ensureSeeded REMOVED. New users see an empty list, add what
// they want via UI. The previous "12 fake subjects" was confusing UX
// (looked like data from another user).

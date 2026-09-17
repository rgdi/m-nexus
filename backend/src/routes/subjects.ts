// subjects.ts: REST CRUD para asignaturas.
// v1.1.0 — frontend Education Service
//
// Modelo: cada subject tiene id, name, icon (1-2 chars), color (CSS var),
// grade (0-10), performance (% change), prof (teacher), next (próxima clase).

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
      this.cache = JSON.parse(buf);
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
    const s: Subject = { ...input, id: `sub-${randomUUID()}`, createdAt: Date.now(), updatedAt: Date.now() };
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

  private async save(): Promise<void> {
    if (!this.cache) return;
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.cache, null, 2), "utf-8");
  }
}

const svc = new SubjectsService();
export const subjectsServiceInstance = svc;

export async function subjectsRoutes(app: FastifyInstance): Promise<void> {
  // v2.6.0: demo data is opt-in. Auto-seed removed to prevent pollution.
  // Load via POST /api/v1/admin/demo/load or "Cargar datos demo" button in UI.

  app.get("/subjects", async () => {
    const list = await svc.all();
    return { subjects: list, total: list.length };
  });

  app.get<{ Params: { id: string } }>("/subjects/:id", async (req) => {
    const s = await svc.get(req.params.id);
    if (!s) throw E.val("EC-SUB-001", "Subject no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return s;
  });

  app.post<{ Body: Partial<Subject> }>("/subjects", async (req, reply) => {
    const b = req.body ?? ({} as any);
    if (!b.name) throw E.val("EC-SUB-002", "name requerido", { context: { body: b } });
    const s = await svc.create({
      name: b.name,
      icon: b.icon ?? (b.name[0] ?? "?").toUpperCase(),
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
    return s;
  });

  app.delete<{ Params: { id: string } }>("/subjects/:id", async (req) => {
    const ok = await svc.remove(req.params.id);
    if (!ok) throw E.val("EC-SUB-004", "Subject no encontrado", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });
}

async function ensureSeeded(svc: SubjectsService) {
  const list = await svc.all();
  if (list.length > 0) return;
  const seed: Array<Omit<Subject, "id" | "createdAt" | "updatedAt">> = [
    { name: "Math", icon: "M", color: "var(--subj-red)", grade: 9.23, performance: 3, prof: "Mr. Meier", next: "Algebra" },
    { name: "Politics-economics", icon: "P", color: "var(--subj-yellow)", grade: 7.52, performance: 1, prof: "Fr. Stolz", next: "" },
    { name: "Deutsch", icon: "D", color: "var(--subj-blue)", grade: 7.52, performance: 3, prof: "Dr. Seibert", next: "" },
    { name: "Physics", icon: "Ψ", color: "var(--subj-purple)", grade: 6.98, performance: 1, prof: "Dr. Müller", next: "" },
    { name: "Chemistry", icon: "C", color: "var(--subj-green)", grade: 7.24, performance: 2, prof: "Dr. Müller", next: "" },
    { name: "French", icon: "F", color: "var(--subj-teal)", grade: 6.98, performance: 0, prof: "", next: "" },
    { name: "Biology", icon: "B", color: "var(--subj-green)", grade: 7.24, performance: 0, prof: "", next: "" },
    { name: "Computer Sci.", icon: "</>", color: "var(--subj-orange)", grade: 9.23, performance: 0, prof: "", next: "" },
    { name: "History", icon: "H", color: "var(--subj-yellow)", grade: 7.83, performance: 0, prof: "", next: "" },
    { name: "English", icon: "E", color: "var(--subj-blue)", grade: 8.41, performance: 0, prof: "", next: "" },
    { name: "Art", icon: "A", color: "var(--subj-pink)", grade: 8.22, performance: 0, prof: "", next: "" },
    { name: "Music", icon: "♪", color: "var(--subj-pink)", grade: 8.64, performance: 0, prof: "", next: "" },
  ];
  for (const s of seed) await svc.create(s);
}

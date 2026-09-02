// ExamManager: CRUD de exámenes + persistencia en data.json.
// v0.14: loadAll/saveAll, dirty tracking, validación.

import type { Exam } from "./types.js";

const STORAGE_KEY = "m-nexus-exams-v1";

export class ExamManager {
  private exams: Map<string, Exam> = new Map();
  private dirty = false;

  constructor(private storage: { read: (k: string) => string | null; write: (k: string, v: string) => void }) {
    this.load();
  }

  /** Carga todos los exámenes desde storage. */
  load(): void {
    const raw = this.storage.read(STORAGE_KEY);
    if (!raw) return;
    try {
      const list = JSON.parse(raw) as Exam[];
      this.exams.clear();
      for (const e of list) this.exams.set(e.id, e);
    } catch (err) {
      // Log silencioso y empezar limpio
      // eslint-disable-next-line no-console
      console.warn("ExamManager: no se pudo parsear storage", err);
    }
  }

  /** Persiste si hay cambios. Llamar después de mutations. */
  save(): void {
    if (!this.dirty) return;
    const list = Array.from(this.exams.values());
    this.storage.write(STORAGE_KEY, JSON.stringify(list));
    this.dirty = false;
  }

  private markDirty() {
    this.dirty = true;
  }

  // ─── CRUD ────────────────────────────────────────────────────────

  list(filter?: { status?: Exam["status"]; subject?: string }): Exam[] {
    const all = Array.from(this.exams.values());
    return all.filter((e) => {
      if (filter?.status && e.status !== filter.status) return false;
      if (filter?.subject && e.subject.toLowerCase() !== filter.subject.toLowerCase()) return false;
      return true;
    });
  }

  get(id: string): Exam | null {
    return this.exams.get(id) ?? null;
  }

  create(input: Omit<Exam, "id" | "createdAt" | "updatedAt" | "status"> & { status?: Exam["status"] }): Exam {
    const now = new Date().toISOString();
    const exam: Exam = {
      ...input,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      status: input.status ?? "active",
    };
    this.exams.set(exam.id, exam);
    this.markDirty();
    return exam;
  }

  update(id: string, patch: Partial<Exam>): Exam | null {
    const existing = this.exams.get(id);
    if (!existing) return null;
    const updated: Exam = {
      ...existing,
      ...patch,
      id: existing.id, // no se puede cambiar
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.exams.set(id, updated);
    this.markDirty();
    return updated;
  }

  delete(id: string): boolean {
    const ok = this.exams.delete(id);
    if (ok) this.markDirty();
    return ok;
  }

  setSchedule(id: string, schedule: Exam["schedule"]): Exam | null {
    return this.update(id, { schedule, scheduleGeneratedAt: new Date().toISOString() });
  }

  archive(id: string): Exam | null {
    return this.update(id, { status: "archived" });
  }

  complete(id: string): Exam | null {
    return this.update(id, { status: "completed" });
  }

  reactivate(id: string): Exam | null {
    return this.update(id, { status: "active" });
  }

  /** Exámenes activos ordenados por fecha. */
  activeByDate(): Exam[] {
    return this.list({ status: "active" }).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Busca un examen que cubra una nota específica. */
  findByNote(notePath: string): Exam[] {
    const out: Exam[] = [];
    for (const exam of this.exams.values()) {
      if (exam.status !== "active") continue;
      // Esta lógica se completa con el ScopeResolver; aquí solo devolvemos los
      // exámenes "potencialmente relevantes" para que el caller los evalúe.
      for (const scope of exam.scopes) {
        if (scope.type === "note" && scope.path === notePath) {
          out.push(exam);
          break;
        }
        if (scope.type === "folder" && notePath.startsWith(scope.path)) {
          out.push(exam);
          break;
        }
      }
    }
    return out;
  }

  /** Devuelve el examen más próximo (próximo en fecha). */
  nextExam(): Exam | null {
    const today = new Date().toISOString().slice(0, 10);
    const active = this.activeByDate().filter((e) => e.date >= today);
    return active[0] ?? null;
  }
}

function generateId(): string {
  // Crypto-quality UUID
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random
  return `exam-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

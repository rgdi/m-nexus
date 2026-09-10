// notesFlow.ts: rutas de notas en memoria para integration tests (v0.61.4)
//
// En produccion se usa el NotesService real con filesystem. Aqui usamos
// un store en memoria para validar el flow HTTP sin tocar el vault.

import { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { E } from "../utils/errorCodes.js";

interface Note { id: string; title: string; content: string; createdAt: number; updatedAt: number; }

class InMemoryNotesStore {
  private notes = new Map<string, Note>();
  list(): Note[] { return Array.from(this.notes.values()); }
  get(id: string): Note | undefined { return this.notes.get(id); }
  create(input: { title: string; content: string }): Note {
    const n: Note = { id: `note-${randomUUID()}`, title: input.title, content: input.content,
      createdAt: Date.now(), updatedAt: Date.now() };
    this.notes.set(n.id, n);
    return n;
  }
  update(id: string, patch: Partial<Note>): Note | null {
    const n = this.notes.get(id);
    if (!n) return null;
    Object.assign(n, patch, { updatedAt: Date.now() });
    return n;
  }
  remove(id: string): boolean {
    return this.notes.delete(id);
  }
}

const store = new InMemoryNotesStore();

export async function registerNotesRoutes(app: FastifyInstance): Promise<void> {
  app.get("/integration/notes", async () => ({ notes: store.list(), total: store.list().length }));
  app.get<{ Params: { id: string } }>("/integration/notes/:id", async (req) => {
    const n = store.get(req.params.id);
    if (!n) throw E.val("EC-NF-001", "Nota no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return n;
  });
  app.post<{ Body: { title: string; content: string } }>("/integration/notes", async (req, reply) => {
    const b = req.body ?? {} as any;
    if (!b.title) throw E.val("EC-NF-002", "title requerido", { context: { body: b } });
    const n = store.create({ title: b.title, content: b.content ?? "" });
    reply.code(201);
    return n;
  });
  app.patch<{ Params: { id: string }; Body: { title?: string; content?: string } }>("/integration/notes/:id", async (req) => {
    const n = store.update(req.params.id, req.body ?? {});
    if (!n) throw E.val("EC-NF-003", "Nota no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return n;
  });
  app.delete<{ Params: { id: string } }>("/integration/notes/:id", async (req) => {
    const ok = store.remove(req.params.id);
    if (!ok) throw E.val("EC-NF-004", "Nota no encontrada", { context: { id: req.params.id }, statusCode: 404 });
    return { deleted: true };
  });
}

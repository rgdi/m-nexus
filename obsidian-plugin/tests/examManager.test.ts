// Tests del ExamManager.

import { describe, it, expect, beforeEach } from "vitest";
import { ExamManager } from "../src/exams/examManager";
import type { Exam } from "../src/exams/types";

function memStorage() {
  const map = new Map<string, string>();
  return {
    read: (k: string) => map.get(k) ?? null,
    write: (k: string, v: string) => { map.set(k, v); },
  };
}

function makeExam(over: Partial<Exam> = {}): Exam {
  const today = new Date();
  const inTenDays = new Date(today);
  inTenDays.setDate(inTenDays.getDate() + 10);
  return {
    id: "test-id",
    title: "Test",
    subject: "Test Subject",
    date: inTenDays.toISOString().slice(0, 10),
    examType: "parcial",
    scopes: [],
    status: "active",
    priority: "medium",
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
    ...over,
  };
}

describe("ExamManager", () => {
  let storage: ReturnType<typeof memStorage>;
  let mgr: ExamManager;

  beforeEach(() => {
    storage = memStorage();
    mgr = new ExamManager(storage);
  });

  it("create genera un examen con id y timestamps", () => {
    const e = mgr.create({
      title: "Parcial",
      subject: "Bioquímica",
      date: "2026-12-01",
      examType: "parcial",
      scopes: [],
      priority: "high",
    });
    expect(e.id).toBeTruthy();
    expect(e.createdAt).toBeTruthy();
    expect(e.status).toBe("active");
  });

  it("get devuelve el examen correcto", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    expect(mgr.get(e.id)?.title).toBe("X");
    expect(mgr.get("no-existe")).toBeNull();
  });

  it("update modifica campos y actualiza updatedAt", async () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    const before = e.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    const u = mgr.update(e.id, { title: "Y" });
    expect(u?.title).toBe("Y");
    expect(u?.updatedAt).not.toBe(before);
  });

  it("update no permite cambiar id ni createdAt", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    const u = mgr.update(e.id, { id: "hacked", createdAt: "0" });
    expect(u?.id).toBe(e.id);
    expect(u?.createdAt).toBe(e.createdAt);
  });

  it("delete elimina el examen", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    expect(mgr.delete(e.id)).toBe(true);
    expect(mgr.get(e.id)).toBeNull();
    expect(mgr.delete("no-existe")).toBe(false);
  });

  it("list filtra por status", () => {
    mgr.create({ title: "A", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    const b = mgr.create({ title: "B", subject: "S", date: "2026-12-02", examType: "parcial", scopes: [], priority: "low" });
    mgr.archive(b.id);
    expect(mgr.list({ status: "active" })).toHaveLength(1);
    expect(mgr.list({ status: "archived" })).toHaveLength(1);
  });

  it("list filtra por subject", () => {
    mgr.create({ title: "A", subject: "Bioquímica", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    mgr.create({ title: "B", subject: "Anatomía", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    expect(mgr.list({ subject: "bioquímica" })).toHaveLength(1);
  });

  it("save persiste y load restaura", () => {
    const e = mgr.create({ title: "Persiste", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    mgr.save();
    const newMgr = new ExamManager(storage);
    expect(newMgr.get(e.id)?.title).toBe("Persiste");
  });

  it("load maneja JSON corrupto sin crashear", () => {
    storage.write("m-nexus-exams-v1", "no es json");
    const m = new ExamManager(storage);
    expect(m.list()).toEqual([]);
  });

  it("activeByDate ordena por fecha ascendente", () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() + 5);
    const d2 = new Date(today); d2.setDate(d2.getDate() + 1);
    mgr.create({ title: "Despues", subject: "S", date: d1.toISOString().slice(0, 10), examType: "parcial", scopes: [], priority: "low" });
    mgr.create({ title: "Antes", subject: "S", date: d2.toISOString().slice(0, 10), examType: "parcial", scopes: [], priority: "low" });
    const list = mgr.activeByDate();
    expect(list[0].title).toBe("Antes");
    expect(list[1].title).toBe("Despues");
  });

  it("nextExam devuelve el más próximo en el futuro", () => {
    const today = new Date().toISOString().slice(0, 10);
    const past = new Date(); past.setDate(past.getDate() - 5);
    const future = new Date(); future.setDate(future.getDate() + 7);
    mgr.create({ title: "Pasado", subject: "S", date: past.toISOString().slice(0, 10), examType: "parcial", scopes: [], priority: "low" });
    mgr.create({ title: "Futuro", subject: "S", date: future.toISOString().slice(0, 10), examType: "parcial", scopes: [], priority: "low" });
    expect(mgr.nextExam()?.title).toBe("Futuro");
  });

  it("setSchedule guarda el plan calculado", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    mgr.setSchedule(e.id, { daysAvailable: 5, totalCards: 10, sessionsPerDay: 1, days: [], alreadyMature: 0, overdue: 0, estimatedCoverage: 1, warnings: [] });
    expect(mgr.get(e.id)?.schedule?.totalCards).toBe(10);
    expect(mgr.get(e.id)?.scheduleGeneratedAt).toBeTruthy();
  });

  it("findByNote devuelve exámenes que contienen la nota", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [{ type: "note", path: "Bio/A.md" }], priority: "low" });
    const f = mgr.create({ title: "Y", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [{ type: "folder", path: "Otro" }], priority: "low" });
    expect(mgr.findByNote("Bio/A.md").map((x) => x.id)).toEqual([e.id]);
    expect(mgr.findByNote("Bio/A.md").map((x) => x.id)).not.toContain(f.id);
  });

  it("archive cambia status a archived", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    mgr.archive(e.id);
    expect(mgr.get(e.id)?.status).toBe("archived");
  });

  it("complete cambia status a completed", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    mgr.complete(e.id);
    expect(mgr.get(e.id)?.status).toBe("completed");
  });

  it("reactivate cambia status a active", () => {
    const e = mgr.create({ title: "X", subject: "S", date: "2026-12-01", examType: "parcial", scopes: [], priority: "low" });
    mgr.archive(e.id);
    mgr.reactivate(e.id);
    expect(mgr.get(e.id)?.status).toBe("active");
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { LocalBackup, BackupEntry } from "../src/backup/localBackup";
import { makeMockApp, MockApp } from "./mockObsidian";
import { noopLogger } from "./helpers";

describe("LocalBackup", () => {
  let app: MockApp;
  let backup: LocalBackup;

  beforeEach(() => {
    app = makeMockApp({
      "nota1.md": "---\nsubject: Test\n---\n# Hola",
      "nota2.md": "Contenido segunda nota",
    });
    backup = new LocalBackup(app as any, noopLogger);
  });

  it("create() genera un snapshot con archivos del vault", async () => {
    const e = await backup.create({ kind: "manual" });
    expect(e.kind).toBe("manual");
    expect(e.fileCount).toBe(2);
    expect(e.size).toBeGreaterThan(0);
  });

  it("list() muestra los backups creados", async () => {
    await backup.create({ kind: "manual" });
    await backup.create({ kind: "auto" });
    const list = await backup.list();
    expect(list.length).toBe(2);
  });

  it("detect kind desde filename", async () => {
    const e1 = await backup.create({ kind: "auto" });
    const e2 = await backup.create({ kind: "emergency" });
    const list = await backup.list();
    const ids = list.map((b) => b.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
  });

  it("dry-run restore no modifica nada", async () => {
    const e = await backup.create({ kind: "manual" });
    const r = await backup.restore(e.id, { dryRun: true });
    expect(r.restored).toBe(2);
    expect(r.errors.length).toBe(0);
  });

  it("restore real recrea archivos borrados", async () => {
    const e = await backup.create({ kind: "manual" });
    // Borrar una nota
    await app.adapter.remove("nota1.md");
    expect(await app.adapter.exists("nota1.md")).toBe(false);
    await backup.restore(e.id);
    expect(await app.adapter.exists("nota1.md")).toBe(true);
  });

  it("prune no elimina los más recientes", async () => {
    for (let i = 0; i < 5; i++) await backup.create({ kind: "manual" });
    const before = (await backup.list()).length;
    const removed = await backup.prune();
    const after = (await backup.list()).length;
    // Los manuales no se podan (siempre protegidos)
    expect(removed).toBe(0);
    expect(after).toBe(before);
  });

  it("roundtrip: ZIP binario conserva contenido", async () => {
    const e = await backup.create({ kind: "manual" });
    // v0.28: formato binario ZIP. Magic bytes PK\x03\x04.
    const buf = await app.adapter.readBinary(e.path);
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    // Restaurar dry-run cuenta los archivos (excluye META.json)
    const r = await backup.restore(e.id, { dryRun: true });
    expect(r.restored).toBe(2);
  });

  it("v0.28: readEntries() decodifica el ZIP", async () => {
    const e = await backup.create({ kind: "manual" });
    const entries = await backup.readEntries(e.id);
    // 2 notas + 1 META.json
    expect(entries.length).toBe(3);
    const meta = entries.find((x) => x.path === "META.json");
    expect(meta).toBeTruthy();
    if (meta) {
      const metaData = JSON.parse(new TextDecoder().decode(meta.data));
      expect(metaData.id).toBe(e.id);
      expect(metaData.kind).toBe("manual");
    }
  });

  it("v0.28: readBytes() devuelve los bytes del ZIP", async () => {
    const e = await backup.create({ kind: "manual" });
    const bytes = await backup.readBytes(e.id);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes.byteLength).toBeGreaterThan(50);
  });
});

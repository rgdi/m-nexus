// autoBackup.test.ts: tests de auto-backup (v0.60 P2.3)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAutoBackupService } from "../src/services/autoBackupService.js";

let vaultDir: string;
let outDir: string;

describe("AutoBackupService (P2.3)", () => {
  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vault-"));
    outDir = await mkdtemp(join(tmpdir(), "bkout-"));
    await writeFile(join(vaultDir, "a.md"), "alpha");
    await writeFile(join(vaultDir, "b.md"), "beta");
    await mkdir(join(vaultDir, "sub"), { recursive: true });
    await writeFile(join(vaultDir, "sub", "c.md"), "gamma");
    const svc = getAutoBackupService();
    (svc as any).__reset();
    svc.configure({
      enabled: false, intervalMinutes: 30, maxBackups: 5,
      vaultPath: vaultDir, outputDir: outDir,
    });
  });
  afterAll(async () => {
    if (vaultDir) await rm(vaultDir, { recursive: true, force: true });
    if (outDir) await rm(outDir, { recursive: true, force: true });
  });

  it("configure + getConfig", () => {
    const svc = getAutoBackupService();
    const cfg = svc.getConfig();
    expect(cfg.maxBackups).toBe(5);
  });
  it("tick crea un .tar.gz", async () => {
    const svc = getAutoBackupService();
    const e = await svc.tick();
    expect(e).not.toBeNull();
    expect(e?.filename).toMatch(/\.tar\.gz$/);
    expect(e?.fileCount).toBe(3);
  });
  it("list devuelve backups", async () => {
    const svc = getAutoBackupService();
    await svc.tick();
    const list = svc.list();
    expect(list.length).toBe(1);
  });
  it("respeta maxBackups (rotacion)", async () => {
    const svc = getAutoBackupService();
    svc.configure({ maxBackups: 2 });
    for (let i = 0; i < 4; i++) await svc.tick();
    expect(svc.list().length).toBe(2);
  });
  it("excluye patterns", async () => {
    const svc = getAutoBackupService();
    svc.configure({ excludePatterns: [".git", "node_modules", "skip.md"] });
    await writeFile(join(vaultDir, "skip.md"), "skip me");
    const e = await svc.tick();
    expect(e?.fileCount).toBe(3);
  });
});

describe("AutoBackup HTTP routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    const { autoBackupRoutes } = await import("../src/routes/autoBackup.js");
    await app.register(autoBackupRoutes, { prefix: "/api/v1" });
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  it("GET config", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/backup/auto/config" });
    expect(r.statusCode).toBe(200);
    expect(r.json().intervalMinutes).toBeDefined();
  });
  it("POST config invalida -> 400", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/backup/auto/config",
      payload: { intervalMinutes: 0 },
    });
    expect(r.statusCode).toBe(400);
  });
  it("POST config valida", async () => {
    const r = await app.inject({
      method: "POST", url: "/api/v1/backup/auto/config",
      payload: { intervalMinutes: 60, maxBackups: 20 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().maxBackups).toBe(20);
  });
  it("GET list", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/backup/auto/list" });
    expect(r.statusCode).toBe(200);
    expect(r.json().backups).toBeDefined();
  });
  it("POST restore de id inexistente -> 404", async () => {
    const r = await app.inject({ method: "POST", url: "/api/v1/backup/auto/restore/bk-no-existe" });
    expect(r.statusCode).toBe(404);
  });
});

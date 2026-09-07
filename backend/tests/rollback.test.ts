import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { rollbackRoutes } from "../src/routes/rollback.js";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Rollback", () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rollback-test-"));
    mkdirSync(join(tmpDir, "data"), { recursive: true });
    mkdirSync(join(tmpDir, "backups"), { recursive: true });
    process.env.MNEXUS_BACKUP_DIR = join(tmpDir, "backups");
    process.env.MNEXUS_DATA_DIR = join(tmpDir, "data");
    process.env.MNEXUS_REGISTRY_PATH = join(tmpDir, "backups", "backups.json");
    // put a sentinel file
    writeFileSync(join(tmpDir, "data", "sentinel.txt"), "v1");
    app = Fastify();
    await app.register(rollbackRoutes, { prefix: "/api/v1/rollback" });
  });

  it("GET /strategy returns info", async () => {
    const r = await app.inject({ method: "GET", url: "/api/v1/rollback/strategy" });
    expect(r.statusCode).toBe(200);
    expect(r.json().maxBackups).toBe(5);
  });

  it("creates and lists backups", async () => {
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/rollback/create",
      payload: { version: "0.32.0", trigger: "manual", description: "test" },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().backup.version).toBe("0.32.0");
    const r2 = await app.inject({ method: "GET", url: "/api/v1/rollback/list" });
    expect(r2.json().count).toBe(1);
  });

  it("restores from backup overwrites current data", async () => {
    // Create a backup
    const createR = await app.inject({
      method: "POST",
      url: "/api/v1/rollback/create",
      payload: { version: "v1" },
    });
    const id = createR.json().backup.id;
    // Change the data
    writeFileSync(join(tmpDir, "data", "sentinel.txt"), "v2-modified");
    // Restore
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/rollback/restore",
      payload: { id, confirm: true },
    });
    expect(r.statusCode).toBe(200);
    // Now data should be v1 again
    expect(readFileSync(join(tmpDir, "data", "sentinel.txt"), "utf-8")).toBe("v1");
  });

  it("restore requires explicit confirm", async () => {
    const createR = await app.inject({
      method: "POST",
      url: "/api/v1/rollback/create",
      payload: { version: "v1" },
    });
    const id = createR.json().backup.id;
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/rollback/restore",
      payload: { id }, // confirm:false
    });
    expect(r.statusCode).toBe(400);
    // v0.45: code is now EC-BK-014 instead of legacy "CONFIRM_REQUIRED"
    expect(r.json().code).toBe("EC-BK-014");
  });

  it("restore of non-existent id returns 404", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/rollback/restore",
      payload: { id: "nonexistent", confirm: true },
    });
    expect(r.statusCode).toBe(404);
  });

  it("max backups honored (oldest pruned)", async () => {
    // Create 7 backups (max is 5)
    for (let i = 0; i < 7; i++) {
      await app.inject({
        method: "POST",
        url: "/api/v1/rollback/create",
        payload: { version: `v${i}` },
      });
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
    }
    const list = await app.inject({ method: "GET", url: "/api/v1/rollback/list" });
    expect(list.json().count).toBe(5);
  });
});

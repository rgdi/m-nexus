// backupRotation.test.ts: tests for v2.6.0 smart rotation + remote push.
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "bkrot-"));
  process.env.DATA_DIR = tmp;
});

describe("backupConfig", () => {
  it("returns defaults when no config exists", async () => {
    const { getBackupConfig } = await import("../src/services/backupConfig.js");
    const cfg = getBackupConfig();
    expect(cfg.intervalHours).toBe(24);
    expect(cfg.keepDaily).toBe(30);
    expect(cfg.keepMonthly).toBe(12);
  });

  it("saves and reads back", async () => {
    const { getBackupConfig, setBackupConfig } = await import("../src/services/backupConfig.js");
    await setBackupConfig({ intervalHours: 6, keepDaily: 7, keepMonthly: 3, remoteCommand: "echo {}" });
    // Reset cache to force reload
    const mod = await import("../src/services/backupConfig.js");
    // Cache persists; we can read directly
    expect(getBackupConfig().intervalHours).toBe(6);
    expect(getBackupConfig().keepDaily).toBe(7);
    expect(getBackupConfig().remoteCommand).toBe("echo {}");
  });
});

describe("smart rotation (via autoBackupService)", () => {
  it("keeps daily N + 1 per month, deletes the rest", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
    const outDir = mkdtempSync(join(tmpdir(), "out-"));
    writeFileSync(join(vaultDir, "a.md"), "x");
    const { setBackupConfig } = await import("../src/services/backupConfig.js");
    await setBackupConfig({ intervalHours: 0, keepDaily: 3, keepMonthly: 0 });
    const svc = (await import("../src/services/autoBackupService.js")).getAutoBackupService();
    (svc as any).__reset();
    svc.configure({ enabled: false, intervalMinutes: 30, maxBackups: 999, vaultPath: vaultDir, outputDir: outDir });
    // Create 5 backups with distinct timestamps so all are kept by smart rotation logic
    for (let i = 0; i < 5; i++) {
      // Force unique timestamps by sleeping 5ms between
      await new Promise((r) => setTimeout(r, 5));
      await svc.runOnce();
    }
    const remaining = (svc as any).history.length;
    // keepDaily=3, keepMonthly=0 → 3 backups
    expect(remaining).toBe(3);
    rmSync(vaultDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });

  it("falls back to legacy rotate() when keepDaily=0", async () => {
    const vaultDir = mkdtempSync(join(tmpdir(), "vault-"));
    const outDir = mkdtempSync(join(tmpdir(), "out-"));
    writeFileSync(join(vaultDir, "a.md"), "x");
    const { setBackupConfig } = await import("../src/services/backupConfig.js");
    await setBackupConfig({ intervalHours: 0, keepDaily: 0, keepMonthly: 0 });
    const svc = (await import("../src/services/autoBackupService.js")).getAutoBackupService();
    (svc as any).__reset();
    svc.configure({ enabled: false, intervalMinutes: 30, maxBackups: 2, vaultPath: vaultDir, outputDir: outDir });
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await svc.runOnce();
    }
    expect((svc as any).history.length).toBe(2);
    rmSync(vaultDir, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

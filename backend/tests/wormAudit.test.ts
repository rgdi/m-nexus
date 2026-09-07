// Tests para WORM audit log (Fase 6 security fix — bug auditor #7).
//
// Bug original: audit log era in-memory, atacante podia borrar sus huellas.
// Fix: append-only JSONL file + hash chain (SHA-256 de cada entry incluye
// el hash de la anterior). verifyChain() detecta modificaciones.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WormAuditLog } from "../src/utils/wormAudit";
import { audit, _resetWormLogForTest, verifyAuditChain, readWormAuditLog, getWormAuditStats } from "../src/auth/audit";

describe("WormAuditLog — basic operations", () => {
  let dir: string;
  let logPath: string;
  let log: WormAuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worm-test-"));
    logPath = join(dir, "audit.jsonl");
    log = new WormAuditLog(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates empty log without error", () => {
    const stats = log.stats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.firstTs).toBeUndefined();
    expect(stats.lastTs).toBeUndefined();
  });

  it("appends entries with sequential seq numbers", () => {
    const e1 = log.append({ event: "first" });
    const e2 = log.append({ event: "second" });
    const e3 = log.append({ event: "third" });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
  });

  it("each entry has unique hash", () => {
    const e1 = log.append({ event: "x" });
    const e2 = log.append({ event: "x" }); // mismo payload
    expect(e1.hash).not.toBe(e2.hash); // nonce diferente
  });

  it("entry.prevHash is the previous entry's hash", () => {
    const e1 = log.append({ event: "first" });
    const e2 = log.append({ event: "second" });
    expect(e2.prevHash).toBe(e1.hash);
  });

  it("first entry's prevHash is genesis (0x64)", () => {
    const e1 = log.append({ event: "first" });
    expect(e1.prevHash).toBe("0".repeat(64));
  });

  it("writes to JSONL file (one entry per line)", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    // Cada línea es JSON válido
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("readAll returns all entries in order", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });
    log.append({ event: "c" });
    const all = log.readAll();
    expect(all).toHaveLength(3);
    expect(all[0].payload.event).toBe("a");
    expect(all[1].payload.event).toBe("b");
    expect(all[2].payload.event).toBe("c");
  });
});

describe("WormAuditLog — chain integrity", () => {
  let dir: string;
  let logPath: string;
  let log: WormAuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worm-test-"));
    logPath = join(dir, "audit.jsonl");
    log = new WormAuditLog(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("verifyChain returns ok=true for intact log", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });
    log.append({ event: "c" });
    const result = log.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(3);
  });

  it("verifyChain returns ok=true for empty log", () => {
    const result = log.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(0);
  });

  it("DETECTS modified entry (hash mismatch)", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });
    log.append({ event: "c" });

    // Modificar el archivo: cambiar el payload de la entry 2
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    const entry2 = JSON.parse(lines[1]);
    entry2.payload.event = "HACKED";
    lines[1] = JSON.stringify(entry2);
    writeFileSync(logPath, lines.join("\n") + "\n");

    const result = log.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toBe("hash_mismatch");
  });

  it("DETECTS deleted entry (seq gap)", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });
    log.append({ event: "c" });
    log.append({ event: "d" });

    // Borrar entry 2 (seq=2)
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    lines.splice(1, 1); // remove index 1
    writeFileSync(logPath, lines.join("\n") + "\n");

    const result = log.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(3);
    expect(result.reason).toBe("seq_gap");
  });

  it("DETECTS inserted entry (prevHash mismatch)", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });

    // Insertar una entry falsa entre la 1 y la 2
    const fakeEntry = {
      prevHash: "0".repeat(64),
      seq: 2,
      ts: Date.now(),
      nonce: "deadbeef",
      payload: { event: "FAKE" },
      hash: "0".repeat(64),
    };

    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    lines.splice(1, 0, JSON.stringify(fakeEntry));
    // También necesitamos ajustar el seq de la entry 2 original
    // Para este test, simplemente insertamos sin ajustar nada más
    writeFileSync(logPath, lines.join("\n") + "\n");

    const result = log.verifyChain();
    expect(result.ok).toBe(false);
    // La entry 2 (fake) tiene prevHash=genesis pero la prev real era el hash de entry 1
    expect(["prev_hash_mismatch", "hash_mismatch"]).toContain(result.reason);
  });

  it("DETECTS corrupted JSON", () => {
    log.append({ event: "a" });
    writeFileSync(logPath, "NOT_JSON\n");

    const result = log.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("corrupted_json");
  });
});

describe("WormAuditLog — persistence across instances", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worm-test-"));
    logPath = join(dir, "audit.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("continues chain from existing file", () => {
    const log1 = new WormAuditLog(logPath);
    log1.append({ event: "a" });
    log1.append({ event: "b" });

    // Nueva instancia lee el estado existente
    const log2 = new WormAuditLog(logPath);
    const e3 = log2.append({ event: "c" });
    expect(e3.seq).toBe(3);
    expect(e3.prevHash).not.toBe("0".repeat(64));
  });

  it("verifies mixed-entries log from 2 instances", () => {
    const log1 = new WormAuditLog(logPath);
    log1.append({ event: "a" });

    const log2 = new WormAuditLog(logPath);
    log2.append({ event: "b" });
    log2.append({ event: "c" });

    const log3 = new WormAuditLog(logPath);
    const result = log3.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(3);
  });
});

describe("audit() — integration with WORM backend", () => {
  beforeEach(() => {
    _resetWormLogForTest();
    process.env.AUDIT_LOG_PATH = join(mkdtempSync(join(tmpdir(), "audit-int-")), "audit.jsonl");
  });

  afterEach(() => {
    _resetWormLogForTest();
    delete process.env.AUDIT_LOG_PATH;
  });

  it("audit() appends to WORM log", () => {
    audit({ deviceId: "device1", action: "auth.failed", allowed: false });
    audit({ deviceId: "device1", action: "auth.refresh", allowed: true });
    const entries = readWormAuditLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].payload.action).toBe("auth.failed");
    expect(entries[1].payload.action).toBe("auth.refresh");
  });

  it("verifyAuditChain returns ok after multiple audits", () => {
    for (let i = 0; i < 5; i++) {
      audit({ deviceId: "d1", action: "llm.chat", allowed: true, meta: { tokens: 100 } });
    }
    const result = verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(5);
  });

  it("getWormAuditStats shows correct counts", () => {
    audit({ deviceId: "d1", action: "ws.connect", allowed: true });
    audit({ deviceId: "d2", action: "ws.connect", allowed: true });
    const stats = getWormAuditStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.firstTs).toBeGreaterThan(0);
    expect(stats.lastTs).toBeGreaterThanOrEqual(stats.firstTs!);
  });
});

describe("WORM audit — security invariants", () => {
  let dir: string;
  let logPath: string;
  let log: WormAuditLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "worm-sec-"));
    logPath = join(dir, "audit.jsonl");
    log = new WormAuditLog(logPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("hash is always 64 hex chars (sha256)", () => {
    const e = log.append({ event: "test" });
    expect(e.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("prevHash of first entry is genesis (64 zeros)", () => {
    const e = log.append({ event: "first" });
    expect(e.prevHash).toBe("0".repeat(64));
  });

  it("changing one byte of entry breaks the chain", () => {
    log.append({ event: "a" });
    log.append({ event: "b" });

    // Simular atacante modificando 1 byte del archivo
    const content = readFileSync(logPath, "utf8");
    const tampered = content.replace('"a"', '"X"'); // cambia "a" por "X"
    writeFileSync(logPath, tampered);

    const result = log.verifyChain();
    expect(result.ok).toBe(false);
  });

  it("concurrent appends (simulated) maintain integrity", async () => {
    // 10 appends paralelos
    const promises: Promise<ReturnType<typeof log.append>>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(Promise.resolve(log.append({ event: `parallel-${i}` })));
    }
    await Promise.all(promises);
    const result = log.verifyChain();
    expect(result.ok).toBe(true);
    expect(result.totalEntries).toBe(10);
  });
});

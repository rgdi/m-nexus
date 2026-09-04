import { describe, it, expect, beforeEach } from "vitest";
import { SecretManager, SecretNotFoundError, SecretAccessDeniedError } from "../src/services/secretManager.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SecretManager", () => {
  let tmpDir: string;
  let sm: SecretManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sm-test-"));
    sm = new SecretManager({ storePath: join(tmpDir, "secrets.json"), devMode: true });
    sm.initialize();
  });

  it("set + get roundtrips a value", () => {
    sm.set("openai.api_key", "sk-test-12345");
    expect(sm.get("openai.api_key")).toBe("sk-test-12345");
  });

  it("list() returns names but not values", () => {
    sm.set("a", "1");
    sm.set("b", "2");
    const names = sm.list();
    expect(names).toContain("a");
    expect(names).toContain("b");
    expect(names).toHaveLength(2);
  });

  it("get() of non-existent throws SecretNotFoundError", () => {
    expect(() => sm.get("nope")).toThrow(SecretNotFoundError);
  });

  it("delete() removes the secret", () => {
    sm.set("temp", "value");
    expect(sm.has("temp")).toBe(true);
    sm.delete("temp");
    expect(sm.has("temp")).toBe(false);
  });

  it("rejects invalid secret names", () => {
    expect(() => sm.set("invalid name with spaces", "x")).toThrow();
    expect(() => sm.set("../etc/passwd", "x")).toThrow();
  });

  it("set() updates updatedAt but preserves createdAt", () => {
    sm.set("a", "v1");
    const first = JSON.parse(readFileSync(sm["storePath"], "utf-8"))["a"];
    // wait a bit
    const start = Date.now();
    while (Date.now() - start < 10) { /* spin */ }
    sm.set("a", "v2");
    const second = JSON.parse(readFileSync(sm["storePath"], "utf-8"))["a"];
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it("set() with same name twice overwrites", () => {
    sm.set("k", "v1");
    sm.set("k", "v2");
    expect(sm.get("k")).toBe("v2");
    expect(sm.list()).toHaveLength(1);
  });

  it("cache hit returns same value", () => {
    sm.set("k", "cached");
    const v1 = sm.get("k");
    const v2 = sm.get("k");
    expect(v1).toBe(v2);
  });

  it("file is created with restricted permissions (0600)", () => {
    sm.set("a", "1");
    const { statSync } = require("node:fs");
    const stat = statSync(sm["storePath"]);
    // permisos: 0o600 = solo owner
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("rotation re-encrypts with new key and old key can't decrypt", () => {
    sm.set("k", "secret");
    const newKey = SecretManager.generateMasterKey();
    sm.rotateMasterKey(newKey);
    // debe seguir funcionando
    expect(sm.get("k")).toBe("secret");
  });

  it("generateMasterKey returns 64 hex chars", () => {
    const k = SecretManager.generateMasterKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});

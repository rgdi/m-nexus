import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAdminUser,
  verifyPassword,
  getAdminUser,
  hasAdminUser,
  recordLogin,
  recordFailedLogin,
  isLocked,
  lockoutSecondsRemaining,
  validateCredentials,
} from "../src/services/users.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "users-test-"));
  process.env.DATA_DIR = tmp;
});

describe("users service", () => {
  it("returns null when no user exists", async () => {
    expect(await getAdminUser()).toBeNull();
    expect(await hasAdminUser()).toBe(false);
  });

  it("creates admin user with hashed password", async () => {
    const u = await createAdminUser("admin", "SuperSecret123!");
    expect(u.username).toBe("admin");
    expect(u.passwordHash).not.toContain("SuperSecret123!");
    expect(u.passwordHash.startsWith("$2")).toBe(true);
    expect(u.failedAttempts).toBe(0);
    expect(u.lockedUntil).toBeNull();
    expect(await hasAdminUser()).toBe(true);
  });

  it("verifyPassword returns user on correct password", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    const u = await verifyPassword("admin", "SuperSecret123!");
    expect(u).not.toBeNull();
    expect(u?.username).toBe("admin");
  });

  it("verifyPassword returns null on wrong password", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    expect(await verifyPassword("admin", "wrong-password")).toBeNull();
  });

  it("verifyPassword is case-insensitive on username", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    expect(await verifyPassword("ADMIN", "SuperSecret123!")).not.toBeNull();
    expect(await verifyPassword("Admin", "SuperSecret123!")).not.toBeNull();
  });

  it("rejects duplicate username", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    await expect(createAdminUser("admin", "OtherPass12345!")).rejects.toThrow(/already exists/);
  });

  it("rejects password shorter than 12 chars", async () => {
    await expect(createAdminUser("admin", "short")).rejects.toThrow(/at least 12/);
  });

  it("rejects invalid username characters", async () => {
    await expect(createAdminUser("Admin User", "SuperSecret123!")).rejects.toThrow(/lowercase/);
    await expect(createAdminUser("ab", "SuperSecret123!")).rejects.toThrow(/3-32/);
  });

  it("validateCredentials throws on missing fields", () => {
    expect(() => validateCredentials("", "pass12345678")).toThrow(/required/);
    expect(() => validateCredentials("admin", "")).toThrow(/required/);
  });

  it("recordLogin clears failedAttempts and sets lastLoginAt", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    await recordFailedLogin("admin");
    await recordFailedLogin("admin");
    await recordLogin("admin");
    const u = await getAdminUser();
    expect(u?.failedAttempts).toBe(0);
    expect(u?.lastLoginAt).not.toBeNull();
    expect(u?.lockedUntil).toBeNull();
  });

  it("locks account after 10 failed attempts", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    for (let i = 0; i < 9; i++) {
      const r = await recordFailedLogin("admin");
      expect(r.lockedUntil).toBeNull();
    }
    const r = await recordFailedLogin("admin");
    expect(r.lockedUntil).not.toBeNull();
    expect(r.lockedUntil!).toBeGreaterThan(Date.now());
    const u = await getAdminUser();
    expect(isLocked(u!)).toBe(true);
    expect(lockoutSecondsRemaining(u!)).toBeGreaterThan(0);
    expect(lockoutSecondsRemaining(u!)).toBeLessThanOrEqual(3600);
  });

  it("recordLogin clears lockout", async () => {
    await createAdminUser("admin", "SuperSecret123!");
    for (let i = 0; i < 10; i++) await recordFailedLogin("admin");
    await recordLogin("admin");
    const u = await getAdminUser();
    expect(isLocked(u!)).toBe(false);
  });
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

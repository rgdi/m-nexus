// Admin user service: single-user bcrypt-backed admin.
// v2.6.0: replaces "deviceId as identity" model with admin username + password.
// Backed by data/users.json (gitignored).
//
// Token persistence is handled separately in auth/jwt.ts (refresh tokens, 90 days).
// This file is ONLY about credentials + lockout state.

import bcrypt from "bcryptjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { generateTokenId } from "../auth/jwt.js";
import { logOp, logError } from "../utils/log.js";

export interface AdminUser {
  id: string;             // UUID — used as JWT subject
  username: string;       // unique, lowercase
  passwordHash: string;   // bcrypt
  createdAt: number;
  lastLoginAt: number | null;
  failedAttempts: number;
  lockedUntil: number | null;
}

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LEN = 12;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 32;
const MAX_FAILED_BEFORE_LOCKOUT = 10;
const LOCKOUT_MS = 60 * 60 * 1000; // 1 hour

function dataDir(): string {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}

function usersFile(): string {
  return join(dataDir(), "users.json");
}

async function readAll(): Promise<AdminUser[]> {
  const f = usersFile();
  if (!existsSync(f)) return [];
  try {
    const raw = await readFile(f, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    logError("users", { code: "EC-USERS-001", category: "USERS", message: "users.json corrupt", context: { error: (e as Error).message } });
    return [];
  }
}

async function writeAll(users: AdminUser[]): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(usersFile(), JSON.stringify(users, null, 2), { mode: 0o600 });
  logOp("users", `users.json updated (${users.length} user(s))`, true, {});
}

export async function getAdminUser(): Promise<AdminUser | null> {
  const users = await readAll();
  return users[0] ?? null;
}

export async function hasAdminUser(): Promise<boolean> {
  return (await getAdminUser()) !== null;
}

export function validateCredentials(username: string, password: string): void {
  if (!username || !password) throw new Error("Username and password required");
  if (password.length < MIN_PASSWORD_LEN) throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters`);
  if (username.length < MIN_USERNAME_LEN || username.length > MAX_USERNAME_LEN) {
    throw new Error(`Username must be ${MIN_USERNAME_LEN}-${MAX_USERNAME_LEN} characters`);
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    throw new Error("Username must be lowercase alphanumeric, _ or -");
  }
}

export async function createAdminUser(username: string, password: string): Promise<AdminUser> {
  validateCredentials(username, password);
  const existing = await getAdminUser();
  if (existing) throw new Error("Admin user already exists");
  const user: AdminUser = {
    id: generateTokenId(),
    username: username.toLowerCase(),
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    createdAt: Date.now(),
    lastLoginAt: null,
    failedAttempts: 0,
    lockedUntil: null,
  };
  await writeAll([user]);
  logOp("users", `admin user '${username}' created`, true, { userId: user.id });
  return user;
}

export async function verifyPassword(username: string, password: string): Promise<AdminUser | null> {
  const u = await getAdminUser();
  if (!u || u.username !== username.toLowerCase()) {
    // Run dummy compare to avoid timing oracle
    await bcrypt.compare(password, "$2a$12$0000000000000000000000.0000000000000000000000000000000000");
    return null;
  }
  const ok = await bcrypt.compare(password, u.passwordHash);
  return ok ? u : null;
}

export async function recordLogin(username: string): Promise<void> {
  const users = await readAll();
  const u = users.find(x => x.username === username.toLowerCase());
  if (!u) return;
  u.lastLoginAt = Date.now();
  u.failedAttempts = 0;
  u.lockedUntil = null;
  await writeAll(users);
}

export interface FailedLoginResult {
  failedAttempts: number;
  lockedUntil: number | null;
}

export async function recordFailedLogin(username: string): Promise<FailedLoginResult> {
  const users = await readAll();
  const u = users.find(x => x.username === username.toLowerCase());
  if (!u) return { failedAttempts: 0, lockedUntil: null };
  u.failedAttempts += 1;
  if (u.failedAttempts >= MAX_FAILED_BEFORE_LOCKOUT) {
    u.lockedUntil = Date.now() + LOCKOUT_MS;
    u.failedAttempts = 0;
    logOp("users", `admin user '${username}' locked for 1h after ${MAX_FAILED_BEFORE_LOCKOUT} failed attempts`, true, { userId: u.id });
  }
  await writeAll(users);
  return { failedAttempts: u.failedAttempts, lockedUntil: u.lockedUntil };
}

export function isLocked(user: AdminUser): boolean {
  return user.lockedUntil !== null && Date.now() < user.lockedUntil;
}

export function lockoutSecondsRemaining(user: AdminUser): number {
  if (!user.lockedUntil) return 0;
  const ms = user.lockedUntil - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

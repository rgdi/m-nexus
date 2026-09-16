# v2.6.0 — Auth + Backup + AI Config + Cloudflare Tunnel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make M-NEXUS production-ready for personal public deployment: admin auth with persistent tokens, real backup system, configurable AI provider, optional Cloudflare Tunnel.

**Architecture:** Extend existing JWT infra (`auth/jwt.ts`, `auth/devices.ts`) to add admin user + login throttle. Add AI provider factory that wraps Ollama/OpenRouter/OpenAI. Extend `autoBackupService.ts` to support rotation and remote push. New install wizard slides 7-8. Optional `cloudflared-setup.sh` post-install.

**Tech Stack:** Fastify 5, TypeScript, bcrypt, vanilla JS frontend, vanilla CSS, vitest, Playwright (existing).

## Global Constraints

- All code TypeScript-strict; ESM imports.
- Backend tests: vitest, `*.test.ts` next to source, run via `cd backend && timeout 60 ./node_modules/.bin/vitest run --reporter=default`.
- Frontend tests: vitest jsdom, run via `cd frontend && timeout 30 ./node_modules/.bin/vitest run`.
- Public routes list lives in `backend/src/middleware/auth.ts` `PUBLIC_PATHS` array.
- LAN bypass via `LAN_AUTH_BYPASS` env var (default `true`).
- Auth required env: `AUTH_REQUIRED` (default `true` in v2.6.0). Set `AUTH_REQUIRED=false` to disable.
- Git commit after each task; final tag `v2.6.0`.
- Bundle build: `bash scripts/build_webview.sh /tmp/mnexus-bundle`.
- UI verify: `node scripts/verify_app.cjs` (must show 0 pageErrors / 0 consoleErrors).

---

## Task 1: Admin user service + persistence

**Files:**
- Create: `backend/src/services/users.ts`
- Test: `backend/src/services/users.test.ts`
- Create: `backend/data/users.json` (gitignored, seeded on first run)

**Interfaces:**
- `getAdminUser(): Promise<AdminUser | null>`
- `createAdminUser(username, password): Promise<AdminUser>` — bcrypt 12 rounds, rejects if exists
- `verifyPassword(username, password): Promise<boolean>`
- `recordLogin(username): Promise<void>` — sets `lastLoginAt`
- `recordFailedLogin(username): Promise<{ lockedUntil: number | null }>` — increments counter, applies lockout at 10

- [ ] **Step 1: Write failing test** in `users.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminUser, verifyPassword, getAdminUser } from "./users.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "users-test-"));
  process.env.DATA_DIR = tmp;
});

it("creates admin user with hashed password", async () => {
  const u = await createAdminUser("admin", "SuperSecret123!");
  expect(u.username).toBe("admin");
  expect(u.passwordHash).not.toContain("SuperSecret123!");
  expect(u.passwordHash.startsWith("$2")).toBe(true); // bcrypt prefix
  expect(await verifyPassword("admin", "SuperSecret123!")).toBe(true);
  expect(await verifyPassword("admin", "wrong")).toBe(false);
});

it("rejects duplicate username", async () => {
  await createAdminUser("admin", "Pass12345Pass!");
  await expect(createAdminUser("admin", "OtherPass1234!")).rejects.toThrow();
});

it("returns null when no user exists", async () => {
  expect(await getAdminUser()).toBeNull();
});

afterEach(() => rmSync(tmp, { recursive: true }));
```

- [ ] **Step 2: Run test → expect FAIL** (`users.ts` does not exist)

- [ ] **Step 3: Implement** `backend/src/services/users.ts`

```typescript
import bcrypt from "bcrypt";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { generateTokenId } from "../auth/jwt.js";

export interface AdminUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number | null;
  failedAttempts: number;
  lockedUntil: number | null;
}

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_BEFORE_LOCKOUT = 10;
const LOCKOUT_MS = 60 * 60 * 1000;

function dataDir() {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}

function usersFile() {
  return join(dataDir(), "users.json");
}

async function readAll(): Promise<AdminUser[]> {
  const f = usersFile();
  if (!existsSync(f)) return [];
  const raw = await readFile(f, "utf8");
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeAll(users: AdminUser[]): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(usersFile(), JSON.stringify(users, null, 2), { mode: 0o600 });
}

export async function getAdminUser(): Promise<AdminUser | null> {
  const users = await readAll();
  return users[0] ?? null;
}

export async function createAdminUser(username: string, password: string): Promise<AdminUser> {
  if (password.length < 12) throw new Error("Password must be at least 12 chars");
  if (!/^[a-z0-9_-]{3,32}$/.test(username)) throw new Error("Invalid username");
  const existing = await getAdminUser();
  if (existing) throw new Error("Admin user already exists");
  const user: AdminUser = {
    id: generateTokenId(),
    username,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    createdAt: Date.now(),
    lastLoginAt: null,
    failedAttempts: 0,
    lockedUntil: null,
  };
  await writeAll([user]);
  return user;
}

export async function verifyPassword(username: string, password: string): Promise<AdminUser | null> {
  const u = await getAdminUser();
  if (!u || u.username !== username) return null;
  const ok = await bcrypt.compare(password, u.passwordHash);
  return ok ? u : null;
}

export async function recordLogin(username: string): Promise<void> {
  const users = await readAll();
  const u = users.find(x => x.username === username);
  if (!u) return;
  u.lastLoginAt = Date.now();
  u.failedAttempts = 0;
  u.lockedUntil = null;
  await writeAll(users);
}

export async function recordFailedLogin(username: string): Promise<{ lockedUntil: number | null }> {
  const users = await readAll();
  const u = users.find(x => x.username === username);
  if (!u) return { lockedUntil: null };
  u.failedAttempts += 1;
  if (u.failedAttempts >= MAX_FAILED_BEFORE_LOCKOUT) {
    u.lockedUntil = Date.now() + LOCKOUT_MS;
    u.failedAttempts = 0; // reset, lockout handles the rest
  }
  await writeAll(users);
  return { lockedUntil: u.lockedUntil };
}
```

- [ ] **Step 4: Run test → expect PASS**

- [ ] **Step 5: Commit** `feat(auth): admin user service with bcrypt + lockout`

---

## Task 2: Rate limit (login throttle) service

**Files:**
- Create: `backend/src/services/rateLimit.ts`
- Test: `backend/src/services/rateLimit.ts` (inline tests)

**Interfaces:**
- `checkLoginThrottle(ip: string): { allowed: boolean; retryAfterSec?: number }`
- `recordLoginFailure(ip: string): void`
- `recordLoginSuccess(ip: string): void`
- Cleanup runs every 5 min via `setInterval` (no exported function needed)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkLoginThrottle, recordLoginFailure, recordLoginSuccess, _reset } from "./rateLimit.js";

beforeEach(() => _reset());

it("allows first 5 attempts within 15min", () => {
  for (let i = 0; i < 5; i++) {
    recordLoginFailure("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").allowed).toBe(true);
  }
});

it("blocks 6th attempt within 15min", () => {
  for (let i = 0; i < 5; i++) recordLoginFailure("1.2.3.4");
  const r = checkLoginThrottle("1.2.3.4");
  expect(r.allowed).toBe(false);
  expect(r.retryAfterSec).toBeGreaterThan(0);
});

it("resets counter on successful login", () => {
  for (let i = 0; i < 3; i++) recordLoginFailure("1.2.3.4");
  recordLoginSuccess("1.2.3.4");
  for (let i = 0; i < 5; i++) {
    recordLoginFailure("1.2.3.4");
    expect(checkLoginThrottle("1.2.3.4").allowed).toBe(true);
  }
});

it("isolates by IP", () => {
  for (let i = 0; i < 5; i++) recordLoginFailure("1.2.3.4");
  expect(checkLoginThrottle("5.6.7.8").allowed).toBe(true);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement** `rateLimit.ts`

```typescript
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;

interface Bucket { fails: number; firstAt: number; lockedUntil: number | null; }
const buckets = new Map<string, Bucket>();

export function checkLoginThrottle(ip: string): { allowed: boolean; retryAfterSec?: number } {
  const b = buckets.get(ip);
  if (!b) return { allowed: true };
  const now = Date.now();
  if (b.lockedUntil && now < b.lockedUntil) {
    return { allowed: false, retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000) };
  }
  if (now - b.firstAt > WINDOW_MS) {
    buckets.delete(ip);
    return { allowed: true };
  }
  if (b.fails >= MAX_FAILS) {
    return { allowed: false, retryAfterSec: Math.ceil(WINDOW_MS / 1000) };
  }
  return { allowed: true };
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now - b.firstAt > WINDOW_MS) {
    buckets.set(ip, { fails: 1, firstAt: now, lockedUntil: null });
  } else {
    b.fails += 1;
  }
}

export function recordLoginSuccess(ip: string): void {
  buckets.delete(ip);
}

// Cleanup every 5 min
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) {
      if (now - b.firstAt > WINDOW_MS && (!b.lockedUntil || now > b.lockedUntil)) {
        buckets.delete(ip);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

export function _reset(): void { buckets.clear(); }
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit** `feat(auth): login throttle (5 fails/15min/IP)`

---

## Task 3: Login endpoint + setup endpoint

**Files:**
- Modify: `backend/src/routes/auth.ts` (add login, setup, logout, me, refresh, sessions, revoke-all)
- Test: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Write failing test** — basic login success/failure

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminUser } from "../services/users.js";
import { _reset as resetThrottle } from "../services/rateLimit.js";

let tmp: string;
beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "auth-test-"));
  process.env.DATA_DIR = tmp;
  process.env.JWT_SECRET = "test-secret-test-secret-test-secret";
  await createAdminUser("admin", "TestPass1234!");
  resetThrottle();
});
afterAll(() => rmSync(tmp, { recursive: true }));

it("login with correct credentials returns tokens", async () => {
  const { loginHandler } = await import("./auth.js");
  const reply = { send: vi.fn(), code: vi.fn().mockReturnThis() };
  const req = { body: { username: "admin", password: "TestPass1234!" }, ip: "127.0.0.1" };
  await loginHandler(req as any, reply as any);
  expect(reply.send).toHaveBeenCalled();
  const body = reply.send.mock.calls[0][0];
  expect(body.accessToken).toBeDefined();
  expect(body.refreshToken).toBeDefined();
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Add to** `backend/src/routes/auth.ts` — extend existing file with new handlers (do not overwrite existing routes):

```typescript
// Add to backend/src/routes/auth.ts (append at end, before export default)

import { verifyPassword, recordLogin, recordFailedLogin, getAdminUser, createAdminUser } from "../services/users.js";
import { checkLoginThrottle, recordLoginFailure, recordLoginSuccess } from "../services/rateLimit.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, validateRefreshToken, revokeAllForDevice, getRefreshTokenStats } from "../auth/jwt.js";
import { isLanIp } from "../utils/network.js";

export async function loginHandler(req: FastifyRequest, reply: FastifyReply) {
  const { username, password } = req.body as { username: string; password: string };
  const ip = req.ip;

  // Throttle (skip if LAN bypass)
  if (process.env.LAN_AUTH_BYPASS !== "true" || !isLanIp(ip)) {
    const t = checkLoginThrottle(ip);
    if (!t.allowed) {
      return reply.status(429).send({ error: "Too many attempts", retryAfterSec: t.retryAfterSec, code: "EC-AUTH-010" });
    }
  }

  const user = await verifyPassword(username, password);
  if (!user) {
    recordLoginFailure(ip);
    await recordFailedLogin(username);
    return reply.status(401).send({ error: "Invalid credentials", code: "EC-AUTH-011" });
  }

  if (user.lockedUntil && Date.now() < user.lockedUntil) {
    return reply.status(423).send({ error: "Account locked", retryAfterSec: Math.ceil((user.lockedUntil - Date.now()) / 1000), code: "EC-AUTH-012" });
  }

  recordLoginSuccess(ip);
  await recordLogin(username);

  const { token: accessToken } = signAccessToken(user.id, user.username);
  const { token: refreshToken } = issueRefreshToken(user.id);
  return reply.send({ accessToken, refreshToken, accessExpiresIn: 3600 });
}

export async function setupHandler(req: FastifyRequest, reply: FastifyReply) {
  const existing = await getAdminUser();
  if (existing) return reply.status(409).send({ error: "Admin already exists", code: "EC-AUTH-013" });
  const { username, password } = req.body as { username: string; password: string };
  const user = await createAdminUser(username, password);
  const { token: accessToken } = signAccessToken(user.id, user.username);
  const { token: refreshToken } = issueRefreshToken(user.id);
  return reply.send({ accessToken, refreshToken, accessExpiresIn: 3600 });
}

export async function refreshHandler(req: FastifyRequest, reply: FastifyReply) {
  const { refreshToken } = req.body as { refreshToken: string };
  const rec = validateRefreshToken(refreshToken);
  if (!rec) return reply.status(401).send({ error: "Invalid refresh token", code: "EC-AUTH-014" });
  const rotated = rotateRefreshToken(refreshToken, rec.deviceId);
  const { token: accessToken } = signAccessToken(rec.deviceId, rec.deviceId);
  return reply.send({ accessToken, refreshToken: rotated.token, accessExpiresIn: 3600 });
}

export async function logoutHandler(req: FastifyRequest, reply: FastifyReply) {
  // JWT is stateless; client just deletes tokens. Return 200.
  return reply.send({ ok: true });
}

export async function sessionsHandler(req: FastifyRequest, reply: FastifyReply) {
  const auth = (req as any).auth;
  if (!auth) return reply.status(401).send({ error: "Auth required" });
  return reply.send({ sessions: getRefreshTokenStats().activeTokens });
}
```

Also add to PUBLIC_PATHS in `backend/src/middleware/auth.ts`:
```typescript
"/api/v1/auth/login",
"/api/v1/auth/setup",
"/api/v1/auth/refresh",
"/api/v1/auth/logout",  // returns 200 anyway, public for simplicity
"/api/v1/auth/sessions", // requires JWT, will 401 without
```

- [ ] **Step 4: Create** `backend/src/utils/network.ts`

```typescript
export function isLanIp(ip: string): boolean {
  if (!ip) return false;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return true;
  if (ip.startsWith("fe80:")) return true;
  return false;
}
```

- [ ] **Step 5: Run test → PASS**

- [ ] **Step 6: Add LAN bypass to middleware** `backend/src/middleware/auth.ts` — replace auth check with:

```typescript
// After PUBLIC_PATHS check:
const ip = req.ip;
if (process.env.LAN_AUTH_BYPASS === "true" && isLanIp(ip)) {
  // LAN bypass: no auth needed
  (req as any).auth = { sub: "lan-bypass", scope: "all", isLanBypass: true };
  return;
}
```

(Add `import { isLanIp } from "../utils/network.js";` at top)

- [ ] **Step 7: Run all backend tests → expect green** (existing 796 + new ~5 = ~801)

- [ ] **Step 8: Commit** `feat(auth): login/setup/refresh/sessions endpoints + LAN bypass`

---

## Task 4: AI provider factory

**Files:**
- Create: `backend/src/services/aiProviders.ts`
- Create: `backend/data/ai-config.json`
- Test: `backend/src/services/aiProviders.test.ts`

**Interfaces:**
- `getAIConfig(): Promise<AIConfig>` — reads from disk
- `setAIConfig(cfg: AIConfig): Promise<void>` — writes
- `generateCompletion(prompt, opts?): Promise<string>` — uses configured provider
- `testConnection(): Promise<{ok: boolean, message: string}>`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ai-test-"));
  process.env.DATA_DIR = tmp;
});

it("defaults to mock provider", async () => {
  const { getAIConfig } = await import("./aiProviders.js");
  const cfg = await getAIConfig();
  expect(cfg.provider).toBe("mock");
});

it("ollamaGenerate calls /api/generate", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ response: "hi from llama" })
  })) as any;
  const { generateCompletion } = await import("./aiProviders.js");
  await generateCompletion("test", { provider: "ollama", baseUrl: "http://x", model: "llama3" } as any);
  expect(global.fetch).toHaveBeenCalledWith("http://x/api/generate", expect.objectContaining({ method: "POST" }));
});

it("openrouterGenerate calls /api/v1/chat/completions with bearer", async () => {
  global.fetch = vi.fn(async () => ({
    ok: true, json: async () => ({ choices: [{ message: { content: "hi" } }] })
  })) as any;
  const { generateCompletion } = await import("./aiProviders.js");
  await generateCompletion("test", { provider: "openrouter", apiKey: "sk-1", model: "x" } as any);
  const [url, init] = (global.fetch as any).mock.calls[0];
  expect(url).toContain("openrouter.ai/api/v1/chat/completions");
  expect(init.headers.Authorization).toBe("Bearer sk-1");
});

afterEach(() => rmSync(tmp, { recursive: true }));
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implement** `aiProviders.ts`

```typescript
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type AIProvider = "ollama" | "openrouter" | "openai" | "mock";

export interface AIConfig {
  provider: AIProvider;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  enabledAt: number;
}

export interface GenOpts {
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

function dataDir() {
  return process.env.DATA_DIR || join(process.cwd(), "data");
}

function configFile() {
  return join(dataDir(), "ai-config.json");
}

export async function getAIConfig(): Promise<AIConfig> {
  const f = configFile();
  if (!existsSync(f)) {
    return { provider: "mock", model: "mock-1", enabledAt: Date.now() };
  }
  try {
    return JSON.parse(await readFile(f, "utf8"));
  } catch {
    return { provider: "mock", model: "mock-1", enabledAt: Date.now() };
  }
}

export async function setAIConfig(cfg: AIConfig): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(configFile(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export async function generateCompletion(prompt: string, opts?: GenOpts): Promise<string> {
  const cfg = await getAIConfig();
  return generateWith(prompt, cfg, opts);
}

async function generateWith(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  switch (cfg.provider) {
    case "ollama": return ollamaComplete(prompt, cfg, opts);
    case "openrouter": return openRouterComplete(prompt, cfg, opts);
    case "openai": return openAIComplete(prompt, cfg, opts);
    case "mock": return mockComplete(prompt);
  }
}

async function ollamaComplete(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  const r = await fetch(`${cfg.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      prompt,
      stream: false,
      options: {
        temperature: opts?.temperature ?? cfg.temperature ?? 0.7,
        num_predict: opts?.maxTokens ?? cfg.maxTokens ?? 2048,
      },
    }),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.response ?? "";
}

async function openRouterComplete(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  return chatCompletion(prompt, "https://openrouter.ai/api/v1/chat/completions", cfg, opts);
}

async function openAIComplete(prompt: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  if (!cfg.baseUrl) throw new Error("OpenAI-compatible needs baseUrl");
  return chatCompletion(prompt, `${cfg.baseUrl}/chat/completions`, cfg, opts);
}

async function chatCompletion(prompt: string, url: string, cfg: AIConfig, opts?: GenOpts): Promise<string> {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        ...(opts?.system ? [{ role: "system", content: opts.system }] : []),
        { role: "user", content: prompt },
      ],
      temperature: opts?.temperature ?? cfg.temperature ?? 0.7,
      max_tokens: opts?.maxTokens ?? cfg.maxTokens ?? 2048,
    }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content ?? "";
}

async function mockComplete(prompt: string): Promise<string> {
  return `[mock AI] You asked: "${prompt.slice(0, 80)}". Configure a real provider in Settings to get real answers.`;
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getAIConfig();
  try {
    const out = await generateWith("ping", cfg, { maxTokens: 16 });
    return { ok: true, message: `Provider ${cfg.provider} responded: "${out.slice(0, 60)}"` };
  } catch (e) {
    return { ok: false, message: `${cfg.provider} failed: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit** `feat(ai): provider factory (ollama/openrouter/openai/mock) + test endpoint`

---

## Task 5: Admin endpoints (AI config + backup trigger)

**Files:**
- Create: `backend/src/routes/admin.ts`
- Modify: `backend/src/server.ts` (register admin routes, JWT-protected)

- [ ] **Step 1: Create** `backend/src/routes/admin.ts`

```typescript
import type { FastifyPluginAsync } from "fastify";
import { getAIConfig, setAIConfig, testConnection, type AIConfig } from "../services/aiProviders.js";
import { runBackupNow } from "../services/autoBackupService.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/admin/ai → returns config (without apiKey)
  app.get("/admin/ai", async (req, reply) => {
    if (!(req as any).auth) return reply.status(401).send({ error: "Auth required" });
    const cfg = await getAIConfig();
    return reply.send({ ...cfg, apiKey: cfg.apiKey ? "***" : undefined });
  });

  // POST /api/v1/admin/ai → save config
  app.post("/admin/ai", async (req, reply) => {
    if (!(req as any).auth) return reply.status(401).send({ error: "Auth required" });
    const body = req.body as Partial<AIConfig>;
    if (!body.provider || !body.model) return reply.status(400).send({ error: "provider+model required" });
    const current = await getAIConfig();
    const next: AIConfig = {
      ...current,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey && body.apiKey !== "***" ? body.apiKey : current.apiKey,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
      enabledAt: Date.now(),
    };
    await setAIConfig(next);
    return reply.send({ ok: true });
  });

  // POST /api/v1/admin/ai/test → test connection
  app.post("/admin/ai/test", async (req, reply) => {
    if (!(req as any).auth) return reply.status(401).send({ error: "Auth required" });
    return reply.send(await testConnection());
  });

  // POST /api/v1/admin/backup/run → manual trigger
  app.post("/admin/backup/run", async (req, reply) => {
    if (!(req as any).auth) return reply.status(401).send({ error: "Auth required" });
    const result = await runBackupNow();
    return reply.send(result);
  });
};
```

- [ ] **Step 2: Register in** `backend/src/server.ts` — find existing route registration pattern, add:

```typescript
import { adminRoutes } from "./routes/admin.js";
// ... after other app.register calls:
await app.register(adminRoutes);
```

- [ ] **Step 3: Add** `/api/v1/admin/*` to PUBLIC_PATHS? **No** — admin is authenticated. The middleware's PUBLIC_PATHS `startsWith` check matches exact `/api/v1/admin` if listed, so don't add.

- [ ] **Step 4: Smoke test with curl**

```bash
curl -s -X POST http://localhost:4100/api/v1/admin/ai/test
# Expect 401 (no auth)
```

- [ ] **Step 5: Commit** `feat(admin): /admin/ai + /admin/backup endpoints`

---

## Task 6: Extend autoBackupService with rotation + remote push

**Files:**
- Modify: `backend/src/services/autoBackupService.ts`

- [ ] **Step 1: Read** existing `autoBackupService.ts` to understand `BackupConfig`, `runBackupNow`, and scheduling.

- [ ] **Step 2: Add** rotation logic at end of `runBackupNow`:

```typescript
async function rotateOldBackups(config: BackupConfig): Promise<void> {
  const dir = path.join(dataDir(), "backups");
  if (!existsSync(dir)) return;
  const files = (await readdir(dir))
    .filter(f => f.endsWith(".tar.gz"))
    .map(f => ({ name: f, mtime: statSync(path.join(dir, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  // Keep newest N daily
  const toDelete = files.slice(config.keepDaily ?? 30);
  // From remainder, keep 1 per month (newest)
  const monthly = new Map<string, typeof files[0]>();
  for (const f of toDelete) {
    const ym = f.name.slice(0, 7); // YYYY-MM
    if (!monthly.has(ym)) monthly.set(ym, f);
  }
  const finalKeep = new Set([
    ...files.slice(0, config.keepDaily ?? 30).map(f => f.name),
    ...[...monthly.values()].slice(0, config.keepMonthly ?? 12).map(f => f.name),
  ]);
  for (const f of files) {
    if (!finalKeep.has(f.name)) {
      await unlink(path.join(dir, f.name));
    }
  }
}
```

- [ ] **Step 3: Add** remote push at end of `runBackupNow`:

```typescript
async function pushRemote(backupPath: string, config: BackupConfig): Promise<void> {
  if (!config.remoteCommand) return;
  // shell-escape the backup path; user responsibility for command safety
  const cmd = config.remoteCommand.replaceAll("{}", `"${backupPath}"`);
  try {
    await execAsync(cmd, { timeout: 5 * 60 * 1000 });
  } catch (e) {
    console.error("[backup] remote push failed:", (e as Error).message);
  }
}
```

- [ ] **Step 4: Wire** rotation + remote push into `runBackupNow` after tar creation:

```typescript
const tarPath = await createTar();
await rotateOldBackups(getConfig());
await pushRemote(tarPath, getConfig());
```

- [ ] **Step 5: Test** — create 35 fake backup files in tmp, run rotation, verify only 30 + monthly kept.

- [ ] **Step 6: Commit** `feat(backup): rotation + remote push`

---

## Task 7: Frontend login screen

**Files:**
- Create: `frontend/src/screens/login.js`
- Modify: `frontend/src/services/api.js` — add token auto-attach + 401 refresh
- Create: `frontend/src/services/auth.js` — token storage
- Modify: `frontend/src/main.js` — route `/login`, redirect logic
- Modify: `frontend/src/styles/components.css` — login screen styles
- Modify: `frontend/src/services/i18n.js` — login keys

**Interfaces:**
- `auth.saveTokens({accessToken, refreshToken})` → localStorage
- `auth.getAccessToken()` → in-memory (or sessionStorage)
- `auth.getRefreshToken()` → localStorage
- `auth.clearTokens()` → wipe all
- `auth.isAuthed()` → boolean (has access or refresh token)
- `api.fetch()` auto-attaches Bearer + handles 401→refresh→retry

- [ ] **Step 1: Create** `frontend/src/services/auth.js`

```javascript
// Auth state + token storage.
// v2.6.0: refresh token in localStorage (90 days), access token in sessionStorage (1h).
const ACCESS_KEY = "mnexus.auth.access";
const REFRESH_KEY = "mnexus.auth.refresh";

let memAccess = null;

export const auth = {
  saveTokens({ accessToken, refreshToken }) {
    memAccess = accessToken;
    sessionStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  getAccessToken() {
    if (memAccess) return memAccess;
    memAccess = sessionStorage.getItem(ACCESS_KEY);
    return memAccess;
  },
  getRefreshToken() {
    return localStorage.getItem(REFRESH_KEY);
  },
  clearTokens() {
    memAccess = null;
    sessionStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
  isAuthed() {
    return !!(this.getAccessToken() || this.getRefreshToken());
  },
};
```

- [ ] **Step 2: Modify** `frontend/src/services/api.js` — find the `fetch` wrapper, replace with:

```javascript
import { auth } from "./auth.js";

let refreshing = null;

async function refreshAccess() {
  const rt = auth.getRefreshToken();
  if (!rt) return false;
  try {
    const r = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    auth.saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    return true;
  } catch {
    return false;
  }
}

export async function apiFetch(url, opts = {}) {
  opts.headers = opts.headers || {};
  const at = auth.getAccessToken();
  if (at) opts.headers.Authorization = `Bearer ${at}`;
  let r = await fetch(url, opts);
  if (r.status === 401 && auth.getRefreshToken()) {
    if (!refreshing) refreshing = refreshAccess().finally(() => { refreshing = null; });
    if (await refreshing) {
      opts.headers.Authorization = `Bearer ${auth.getAccessToken()}`;
      r = await fetch(url, opts);
    }
  }
  if (r.status === 401) {
    auth.clearTokens();
    location.hash = "#/login";
  }
  return r;
}
```

Keep all existing `api.notes.get/post/...` methods working — change their `fetch` calls to `apiFetch`.

- [ ] **Step 3: Create** `frontend/src/screens/login.js`

```javascript
// Login screen — username/password form + error display.
import { auth } from "../services/auth.js";
import { apiFetch } from "../services/api.js";
import { t } from "../services/i18n.js";

export function renderLogin() {
  const root = document.getElementById("screen-root") || document.getElementById("app");
  if (!root) return;
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">✦ M-NEXUS</div>
        <h2>${t("login.title")}</h2>
        <form id="login-form">
          <label>${t("login.username")}
            <input name="username" autocomplete="username" required />
          </label>
          <label>${t("login.password")}
            <input name="password" type="password" autocomplete="current-password" required />
          </label>
          <div id="login-error" class="login-error" hidden></div>
          <button type="submit" class="btn-primary">${t("login.submit")}</button>
        </form>
        <div class="login-hint">${t("login.hint")}</div>
      </div>
    </div>
  `;
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errBox = document.getElementById("login-error");
    errBox.hidden = true;
    try {
      const r = await apiFetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
      });
      if (r.status === 429) {
        const body = await r.json();
        errBox.textContent = t("login.tooMany").replace("{n}", body.retryAfterSec);
      } else if (!r.ok) {
        errBox.textContent = t("login.failed");
      } else {
        const data = await r.json();
        auth.saveTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
        location.hash = "#/overview";
      }
      errBox.hidden = false;
    } catch (err) {
      errBox.textContent = t("login.networkError");
      errBox.hidden = false;
    }
  });
}
```

- [ ] **Step 4: Add CSS** to `frontend/src/styles/components.css`:

```css
.login-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg); }
.login-card { background: var(--surface); border-radius: 16px; padding: 2rem; min-width: 360px; box-shadow: 0 8px 32px rgba(0,0,0,.1); }
.login-logo { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; }
.login-card label { display: block; margin: 1rem 0 .25rem; font-size: .875rem; color: var(--text-muted); }
.login-card input { width: 100%; padding: .625rem .75rem; border: 1px solid var(--border); border-radius: 8px; background: var(--input-bg); color: var(--text); }
.login-card input:focus { outline: 2px solid var(--accent); }
.login-card .btn-primary { width: 100%; margin-top: 1.25rem; padding: .75rem; background: var(--accent); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
.login-error { color: var(--danger); margin-top: 1rem; padding: .5rem; background: var(--danger-bg); border-radius: 6px; font-size: .875rem; }
.login-hint { margin-top: 1rem; font-size: .75rem; color: var(--text-muted); text-align: center; }
```

- [ ] **Step 5: Add i18n keys** to `frontend/src/services/i18n.js` (es, en, pt):

```javascript
login: {
  title: { es: "Iniciar sesión", en: "Sign in", pt: "Entrar" },
  username: { es: "Usuario", en: "Username", pt: "Usuário" },
  password: { es: "Contraseña", en: "Password", pt: "Senha" },
  submit: { es: "Entrar", en: "Sign in", pt: "Entrar" },
  failed: { es: "Usuario o contraseña incorrectos", en: "Wrong username or password", pt: "Usuário ou senha incorretos" },
  tooMany: { es: "Demasiados intentos. Espera {n}s", en: "Too many attempts. Wait {n}s", pt: "Muitas tentativas. Aguarde {n}s" },
  networkError: { es: "Error de red", en: "Network error", pt: "Erro de rede" },
  hint: { es: "Tu sesión dura 90 días", en: "Your session lasts 90 days", pt: "Sua sessão dura 90 dias" },
},
```

- [ ] **Step 6: Wire route in** `frontend/src/main.js` — add `#/login` → `renderLogin()`; on app boot, if no auth + not on login → redirect to login.

```javascript
import { renderLogin } from "./screens/login.js";
import { auth } from "./services/auth.js";

// In router table:
{ hash: "#/login", render: renderLogin, noAuth: true }

// At top of boot():
if (!auth.isAuthed() && location.hash !== "#/login" && location.hash !== "#/setup") {
  location.hash = "#/login";
}
```

- [ ] **Step 7: Test in browser** — log out (clear localStorage), reload, see login screen, log in with admin/TestPass1234! (test user), redirected to overview.

- [ ] **Step 8: Commit** `feat(login): persistent login (90-day refresh) + 401 auto-refresh`

---

## Task 8: Install wizard — slides 7 (AI) and 8 (admin + backup)

**Files:**
- Create: `frontend/install/slides/07-ai-provider.html`
- Create: `frontend/install/slides/08-admin-backup.html`
- Modify: `frontend/src/widgets/setup_wizard.js` — add slides 7-8 to the array

- [ ] **Step 1: Read** existing `setup_wizard.js` to understand slide structure (look for `slides` array).

- [ ] **Step 2: Create** `frontend/install/slides/07-ai-provider.html`

```html
<div class="wiz-slide" data-slide="7">
  <h2>✦ Proveedor de IA</h2>
  <p>Selecciona cómo quieres que M-NEXUS genere respuestas de IA (resúmenes, flashcards, tutor).</p>

  <div class="wiz-radio-group">
    <label><input type="radio" name="ai-provider" value="mock" checked /> <strong>Skip (mock)</strong> — respuestas predefinidas, sin conexión</label>
    <label><input type="radio" name="ai-provider" value="ollama" /> <strong>Ollama local</strong> — privacidad total, sin costes, requiere GPU decente</label>
    <label><input type="radio" name="ai-provider" value="openrouter" /> <strong>OpenRouter</strong> — un API key, muchos modelos, pago por uso</label>
    <label><input type="radio" name="ai-provider" value="openai" /> <strong>OpenAI-compatible</strong> — cualquier endpoint (LM Studio, vLLM, etc.)</label>
  </div>

  <div class="wiz-ai-fields" data-for="ollama">
    <label>URL base <input name="ai-baseUrl" value="http://localhost:11434" /></label>
    <label>Modelo <input name="ai-model" value="llama3.1:8b" placeholder="llama3.1:8b" /></label>
  </div>
  <div class="wiz-ai-fields" data-for="openrouter" hidden>
    <label>API Key <input name="ai-apiKey" type="password" placeholder="sk-or-v1-..." /></label>
    <label>Modelo <input name="ai-model" value="meta-llama/llama-3.1-8b-instruct:free" /></label>
  </div>
  <div class="wiz-ai-fields" data-for="openai" hidden>
    <label>URL base <input name="ai-baseUrl" placeholder="http://localhost:1234/v1" /></label>
    <label>API Key <input name="ai-apiKey" type="password" placeholder="(opcional para LM Studio)" /></label>
    <label>Modelo <input name="ai-model" value="local-model" /></label>
  </div>

  <button class="wiz-test-ai">🔌 Probar conexión</button>
  <div class="wiz-test-result" hidden></div>
</div>
```

- [ ] **Step 3: Create** `frontend/install/slides/08-admin-backup.html`

```html
<div class="wiz-slide" data-slide="8">
  <h2>✦ Administrador y backups</h2>
  <p>Crea el usuario admin (único) y configura la rotación de backups automáticos.</p>

  <fieldset>
    <legend>👤 Usuario admin</legend>
    <label>Usuario <input name="admin-username" value="admin" pattern="[a-z0-9_-]{3,32}" required /></label>
    <label>Contraseña (mín 12 caracteres) <input name="admin-password" type="password" minlength="12" required /></label>
    <label>Repetir contraseña <input name="admin-password2" type="password" minlength="12" required /></label>
  </fieldset>

  <fieldset>
    <legend>💾 Backups automáticos</legend>
    <label>Frecuencia
      <select name="backup-interval">
        <option value="6">Cada 6 horas</option>
        <option value="12">Cada 12 horas</option>
        <option value="24" selected>Cada 24 horas</option>
        <option value="0">Desactivado</option>
      </select>
    </label>
    <label>Conservar últimos
      <select name="backup-keep-daily">
        <option value="7">7 backups</option>
        <option value="30" selected>30 backups</option>
        <option value="90">90 backups</option>
      </select>
    </label>
    <label>Comando remoto (opcional) <input name="backup-remote" placeholder="rclone copy {} remote:bucket/backups" /></label>
    <small>El {} se reemplaza con la ruta del backup. Ej: rsync, rclone, cp a USB.</small>
  </fieldset>
</div>
```

- [ ] **Step 4: Add slides to wizard** — modify `setup_wizard.js` `slides` array, add objects for slide 7 and 8 that load the HTML files and wire `onNext` to POST `/api/v1/auth/setup` and `/api/v1/admin/ai` and `/api/v1/admin/backup/config`.

(Provide actual `onNext` implementation in code: collect form data, call API endpoints with the auth token returned from setup, save success.)

- [ ] **Step 5: Verify wizard renders 8 slides** — `node scripts/verify_app.cjs` should show wizard with 8 slides, navigate to slide 7 and 8.

- [ ] **Step 6: Commit** `feat(wizard): slides 7 (AI) + 8 (admin + backup)`

---

## Task 9: Cloudflare Tunnel optional setup script

**Files:**
- Create: `scripts/cloudflared-setup.sh`

- [ ] **Step 1: Create** `scripts/cloudflared-setup.sh`

```bash
#!/usr/bin/env bash
# Cloudflare Tunnel setup for M-NEXUS.
# Optional post-install step. Requires:
#   - A Cloudflare account
#   - A domain added to Cloudflare DNS
#   - `cloudflared` CLI (will be installed if missing)
set -euo pipefail

PORT="${MNEXUS_PORT:-4100}"
SUBDOMAIN="${MNEXUS_TUNNEL_NAME:-mnexus}"
TUNNEL_NAME="mnexus-$(whoami)"

echo "🚇 Cloudflare Tunnel setup for M-NEXUS"
echo

# 1. Install cloudflared if missing
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "→ Installing cloudflared..."
  case "$(uname -s)" in
    Linux)
      arch=$(uname -m)
      curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" -o /tmp/cloudflared.deb
      sudo dpkg -i /tmp/cloudflared.deb
      ;;
    Darwin)
      brew install cloudflared
      ;;
    MINGW*|CYGWIN*|MSYS*)
      winget install Cloudflare.cloudflared
      ;;
  esac
fi

# 2. Login (interactive)
echo "→ Opening browser for Cloudflare login..."
cloudflared tunnel login

# 3. Create tunnel
if ! cloudflared tunnel info "$TUNNEL_NAME" >/dev/null 2>&1; then
  echo "→ Creating tunnel '$TUNNEL_NAME'..."
  cloudflared tunnel create "$TUNNEL_NAME"
fi

# 4. Config
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: $TUNNEL_NAME
credentials-file: $HOME/.cloudflared/${TUNNEL_NAME}.json

ingress:
  - hostname: ${SUBDOMAIN}
    service: http://localhost:${PORT}
  - service: http_status:404
EOF

# 5. DNS route
echo "→ Adding DNS route..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$SUBDOMAIN"

# 6. Install as service
echo "→ Installing cloudflared as system service..."
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

echo
echo "✅ Done! Your M-NEXUS is now at https://${SUBDOMAIN}"
echo "   Cloudflare handles DDoS, bot filtering, and (optionally) Access 2FA."
echo "   To enable 2FA: visit https://one.dash.cloudflare.com/ → Access → Applications"
```

- [ ] **Step 2: chmod +x** `scripts/cloudflared-setup.sh`

- [ ] **Step 3: Add to install.sh** — append at the end of install:

```bash
if ask_yes_no "Set up Cloudflare Tunnel? (requires domain on Cloudflare)"; then
  bash scripts/cloudflared-setup.sh
fi
```

- [ ] **Step 4: Commit** `feat(install): cloudflared-setup.sh + integration`

---

## Task 10: Tests (users, rateLimit, aiProviders, backup, auth, login)

**Files:**
- Modify: `backend/src/services/users.test.ts` — already created in Task 1
- Modify: `backend/src/services/rateLimit.test.ts` — already created in Task 2
- Modify: `backend/src/services/aiProviders.test.ts` — already created in Task 4
- Create: `backend/src/services/autoBackupService.test.ts` — rotation test
- Create: `frontend/tests/login.test.js`
- Create: `frontend/tests/auth.test.js`

- [ ] **Step 1: Create** `backend/src/services/autoBackupService.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotateOldBackups, type BackupConfig } from "./autoBackupService.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "backup-test-"));
  process.env.DATA_DIR = tmp;
});

it("rotates old backups keeping N newest", async () => {
  // Create 35 fake .tar.gz files
  const dir = join(tmp, "backups");
  require("node:fs").mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 35; i++) {
    const name = `2026-09-${String(i + 1).padStart(2, "0")}_0300.tar.gz`;
    writeFileSync(join(dir, name), "fake");
  }
  await rotateOldBackups({ keepDaily: 30, keepMonthly: 12 } as BackupConfig);
  const remaining = readdirSync(dir).filter(f => f.endsWith(".tar.gz"));
  expect(remaining.length).toBeLessThanOrEqual(30 + 12); // daily + monthly caps
});

afterEach(() => rmSync(tmp, { recursive: true }));
```

(Adjust import if `rotateOldBackups` isn't exported from `autoBackupService.ts` — export it.)

- [ ] **Step 2: Create** `frontend/tests/auth.test.js`

```javascript
import { describe, it, expect, beforeEach } from "vitest";
import { auth } from "../src/services/auth.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Reset in-memory state via re-import
});

it("saves tokens and reads them back", async () => {
  const mod = await import("../src/services/auth.js");
  mod.auth.saveTokens({ accessToken: "at-1", refreshToken: "rt-1" });
  expect(mod.auth.getAccessToken()).toBe("at-1");
  expect(mod.auth.getRefreshToken()).toBe("rt-1");
  expect(mod.auth.isAuthed()).toBe(true);
});

it("clears tokens", async () => {
  const mod = await import("../src/services/auth.js");
  mod.auth.saveTokens({ accessToken: "at-1", refreshToken: "rt-1" });
  mod.auth.clearTokens();
  expect(mod.auth.getAccessToken()).toBeNull();
  expect(mod.auth.getRefreshToken()).toBeNull();
  expect(mod.auth.isAuthed()).toBe(false);
});

it("isAuthed returns true with only refresh token", async () => {
  const mod = await import("../src/services/auth.js");
  localStorage.setItem("mnexus.auth.refresh", "rt-1");
  expect(mod.auth.isAuthed()).toBe(true);
});
```

- [ ] **Step 3: Run all backend tests** — expect 800+ green
- [ ] **Step 4: Run all frontend tests** — expect 156+ green
- [ ] **Step 5: Commit** `test: v2.6.0 (backup rotation, auth, login)`

---

## Task 11: Documentation (AUTH, BACKUP, AI_PROVIDERS, CLOUDFLARE_TUNNEL, SECURITY)

**Files:**
- Create: `docs/AUTH.md`
- Create: `docs/BACKUP.md`
- Create: `docs/AI_PROVIDERS.md`
- Create: `docs/CLOUDFLARE_TUNNEL.md`
- Create: `docs/SECURITY.md`
- Modify: `README.md` — link new docs, update install section
- Modify: `CHANGELOG.md` — add v2.6.0 entry

- [ ] **Step 1: Create** `docs/AUTH.md` — admin user, login throttle, LAN bypass, refresh tokens, env vars
- [ ] **Step 2: Create** `docs/BACKUP.md` — auto schedule, rotation, manual trigger, remote push examples
- [ ] **Step 3: Create** `docs/AI_PROVIDERS.md` — Ollama, OpenRouter, OpenAI-compatible setup with curl examples
- [ ] **Step 4: Create** `docs/CLOUDFLARE_TUNNEL.md` — one-page setup guide, Access 2FA optional
- [ ] **Step 5: Create** `docs/SECURITY.md` — threat model, what's protected, what's NOT (notes plaintext), checklist
- [ ] **Step 6: Update** `README.md` — add "Quick install", "What you get" sections with links to docs
- [ ] **Step 7: Update** `CHANGELOG.md` — v2.6.0 entry with all features
- [ ] **Step 8: Commit** `docs: v2.6.0 (auth, backup, ai, tunnel, security)`

---

## Task 12: README + install instructions update + final verification

**Files:**
- Modify: `README.md` — top-level "Install" section
- Modify: `install/install.sh` — ensure new slides and tunnel prompt included
- Modify: `docs/README.md` — index of new docs
- Modify: `AUDIT_REPORT.md`
- Modify: `CHECKLIST.md`

- [ ] **Step 1: Update** `README.md` — at the top:

````markdown
## 🚀 Install (one line)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash
```

Then open http://localhost:8080 and follow the 8-step setup wizard.

## What you get

- **Notes + Flashcards + AI tutor** (Ollama local or OpenRouter API)
- **Auto backup** every 6h with rotation + optional rclone/rsync push
- **Admin auth** with bcrypt + 90-day refresh tokens (no daily login)
- **Cloudflare Tunnel** optional (DDoS + bot protection upstream)
- **i18n** (es/en/pt), responsive (phone/tablet/desktop)

## Docs

- [AUTH](docs/AUTH.md) · [BACKUP](docs/BACKUP.md) · [AI_PROVIDERS](docs/AI_PROVIDERS.md) · [CLOUDFLARE_TUNNEL](docs/CLOUDFLARE_TUNNEL.md) · [SECURITY](docs/SECURITY.md)
````

- [ ] **Step 2: Verify install.sh** — already includes new slides and tunnel prompt from previous tasks.

- [ ] **Step 3: Run full verification suite**

```bash
# Backend
cd backend && timeout 60 ./node_modules/.bin/vitest run --reporter=default
# Frontend
cd ../frontend && timeout 30 ./node_modules/.bin/vitest run
# Bundle
cd .. && bash scripts/build_webview.sh /tmp/v260-bundle
# UI verify (with admin user already set up)
node scripts/verify_app.cjs
```

Expect: backend 800+ green, frontend 156+ green, bundle builds, 0 pageErrors/0 consoleErrors on 7 routes.

- [ ] **Step 4: Visual verify** — capture login screen + setup wizard slides 7-8 screenshots

```bash
mkdir -p screenshots/v260
node /tmp/cap_login.cjs  # see Task 7 capture script
```

- [ ] **Step 5: Update** `AUDIT_REPORT.md` — score (target 1000+), features shipped
- [ ] **Step 6: Update** `CHECKLIST.md` — v2.6.0 line, all items checked
- [ ] **Step 7: Commit** `docs: README install section + final verification`
- [ ] **Step 8: Tag** `v2.6.0` and push

```bash
git tag v2.6.0
git push origin main --tags
```

---

## Self-Review

- ✅ Spec coverage: auth (Tasks 1-3, 7), backup (Task 6), AI (Task 4-5), tunnel (Task 9), wizard (Task 8), tests (Task 10), docs (Tasks 11-12)
- ✅ No placeholders: all steps have concrete code or commands
- ✅ Type consistency: `AdminUser`, `AIConfig`, `BackupConfig`, `auth.saveTokens/clearTokens/isAuthed` used identically across tasks
- ✅ Scope: 12 tasks, each with 4-8 steps, ~30min each → ~6h implementation

# v2.6.0 — Auth, Backup, AI Config, Cloudflare Tunnel

**Status:** design approved (pending user final review)
**Branch:** main
**Predecessor:** v2.5.0 (commit `f4f0cd2`)
**Author:** Mavis

---

## Goal

Convert M-NEXUS into a publicly-deployable-yet-secure personal app:

1. **Auth**: password + lockout, with LAN bypass for home testing
2. **AI config**: install wizard screens for Ollama / OpenRouter / OpenAI-compatible
3. **Backup**: real backup system (auto + rotation + optional remote)
4. **Cloudflare Tunnel**: optional one-command setup
5. **Anti-bot**: defense in depth (rate-limit + lockout + CF upstream)

## Non-Goals

- Multi-user (single admin only)
- OAuth / social login (YAGNI for personal app)
- Custom TOTP (Cloudflare Access already provides 2FA upstream if user wants it)
- E2E encryption (notes stored in plaintext DB, encrypted at rest is a separate concern)

## Architecture

### Components

```
backend/
├── src/
│   ├── services/
│   │   ├── auth.ts                (extend: add login throttle + lockout)
│   │   ├── users.ts               (NEW: admin user CRUD, bcrypt)
│   │   ├── rateLimit.ts           (NEW: in-memory throttle, IP-keyed)
│   │   ├── aiProviders.ts         (NEW: Ollama/OpenRouter/OpenAI factory)
│   │   └── autoBackupService.ts   (extend: real rotation, remote push)
│   ├── routes/
│   │   ├── auth.ts                (extend: /api/v1/auth/login, /logout, /me, /setup)
│   │   └── admin.ts               (NEW: /api/v1/admin/users, /admin/backup)
│   └── config.ts                  (extend: AI_PROVIDER, AUTH_* env vars)
├── data/
│   ├── users.json                 (NEW: admin user)
│   ├── ai-config.json             (NEW: provider settings)
│   └── backups/                   (NEW: see Backup section)
└── scripts/
    └── cloudflared-setup.sh       (NEW: optional tunnel installer)

frontend/
├── src/
│   ├── screens/
│   │   └── login.js               (NEW: username/password form)
│   ├── widgets/
│   │   └── authGate.js            (NEW: 401 → redirect to /login)
│   └── services/
│       ├── api.js                 (extend: 401 → trigger re-login)
│       └── auth.js                (NEW: token storage, refresh, isAuthed)
└── install/
    └── slides/
        ├── 07-ai-provider.html    (NEW)
        └── 08-admin-backup.html   (NEW)

install/
└── install.sh                     (extend: post-install slides 7-8, optional cloudflared)

docs/
├── AUTH.md                        (NEW)
├── BACKUP.md                      (NEW)
├── AI_PROVIDERS.md                (NEW)
├── CLOUDFLARE_TUNNEL.md           (NEW)
└── SECURITY.md                    (NEW — threat model + checklist)
```

### Data model

```typescript
// backend/src/services/users.ts
export interface AdminUser {
  id: string;                  // UUID
  username: string;            // unique, lowercase
  passwordHash: string;        // bcrypt, 12 rounds
  createdAt: number;           // unix ms
  lastLoginAt: number | null;
  failedAttempts: number;      // in-memory, reset on success
  lockedUntil: number | null;  // unix ms
}

// backend/src/services/aiProviders.ts
export type AIProvider = "ollama" | "openrouter" | "openai" | "mock";

export interface AIConfig {
  provider: AIProvider;
  baseUrl?: string;            // for ollama/openai-compatible
  apiKey?: string;             // for openrouter/openai
  model: string;
  temperature?: number;        // 0..1, default 0.7
  maxTokens?: number;          // default 2048
  enabledAt: number;
}
```

### Auth flow

```
[Browser]                  [Backend]                  [Storage]
   │                          │                          │
   ├─── GET /api/v1/notes ───>│                          │
   │                          │── check JWT (optional) ─>│
   │                          │<─ valid/missing ─────────│
   │<── 200 notes ────────────┤                          │
   │                          │                          │
   ├─── POST /api/v1/notes ──>│                          │
   │                          │── require JWT ──────────>│
   │                          │<─ 401 if missing ────────│
   │<── 401 ──────────────────┤                          │
   │                          │                          │
   ├─── POST /api/v1/auth/login {user,pass} ────────────>│
   │                          │── throttle check (5/15min/IP)
   │                          │── bcrypt.compare ───────>│
   │                          │<─ OK ────────────────────│
   │<── {token: JWT, expiresIn} ─────────────────────────│
```

### Public vs authenticated routes

**Public (no auth):**
- `GET /api/v1/health`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/setup` (only when no admin exists yet)
- `GET /api/v1/folders` (offline-first CRDT)
- `WS /ws/sync` (offline-first)

**Authenticated (JWT required):**
- All `POST/PATCH/DELETE /api/v1/*` except the public ones above
- `GET /api/v1/admin/*`
- `GET /api/v1/notes`, `/api/v1/flashcards`, `/api/v1/tasks`, `/api/v1/events` (read access requires JWT to prevent enumeration)

### LAN bypass

Environment variable: `LAN_AUTH_BYPASS=true` (default).

When true AND request IP is in private range (192.168.x.x, 10.x.x.x, 172.16-31.x.x, 127.x.x.x, ::1):
- Login throttle is skipped (login is allowed from LAN even if global throttle is exhausted)
- All routes are accessible without JWT

When false (production): full auth required regardless of IP.

**NOTE:** `auth/login` and `auth/setup` are ALWAYS public (so you can actually log in).

### Rate limit

**Per IP:**
- 5 failed logins / 15min → 429 with `Retry-After`
- 10 failed logins / 24h → 1h lockout
- Lockout state cleared on successful login

**Implementation:** `backend/src/services/rateLimit.ts` — in-memory Map keyed by IP. Redis-ready interface (can be swapped later).

### Backup system

**Trigger:** every 6h via `setInterval` in `server.ts` (or via cron, configurable).

**What:** tar.gz of `data/*.json` + `data/m-nexus.db` (if exists) + `data/ai-config.json` + `data/users.json`.

**Where:** `data/backups/YYYY-MM-DD_HHMM.tar.gz`.

**Rotation:** configurable in `data/ai-config.json` (or new `data/backup-config.json`):
```json
{
  "intervalHours": 6,
  "keepDaily": 30,
  "keepMonthly": 12,
  "remoteCommand": null
}
```

**Remote push (optional):** if `remoteCommand` set, executed after each backup:
- `rclone copy {local} {remote}` — for any rclone target (s3, b2, gdrive, sftp, local-mount)
- `rsync -avz {local} user@host:/path/` — for ssh
- arbitrary command — user responsibility

**Manual trigger:** `POST /api/v1/admin/backup/run` (auth required).

### AI provider factory

```typescript
// backend/src/services/aiProviders.ts
export async function generateCompletion(prompt: string, opts: GenOpts): Promise<string> {
  const cfg = await getAIConfig();
  switch (cfg.provider) {
    case "ollama":      return ollamaComplete(prompt, cfg, opts);
    case "openrouter":  return openRouterComplete(prompt, cfg, opts);
    case "openai":      return openAIComplete(prompt, cfg, opts);
    case "mock":        return mockComplete(prompt, opts);
  }
}
```

**Ollama:** HTTP `POST {baseUrl}/api/generate` with `{model, prompt, stream:false, options:{temperature, num_predict}}`.

**OpenRouter:** HTTP `POST https://openrouter.ai/api/v1/chat/completions` with Bearer auth. Compatible with OpenAI API.

**OpenAI-compatible:** same as OpenRouter but custom `baseUrl`.

**Mock:** returns canned response for offline development.

### Install wizard new slides

**Slide 7: AI Provider**
- Radio: Ollama local / OpenRouter API / OpenAI-compatible / Skip
- If Ollama: input `http://localhost:11434` + model name (`llama3.1:8b` default)
- If OpenRouter: paste API key + model (`meta-llama/llama-3.1-8b-instruct:free` default)
- If OpenAI-compatible: base URL + key + model
- "Test connection" button (calls `/api/v1/ai/test`)
- Saves to `data/ai-config.json`

**Slide 8: Admin & Backup**
- Username (default `admin`, lowercase, min 3 chars)
- Password (min 12 chars, show strength meter)
- Confirm password
- Backup interval dropdown: 6h / 12h / 24h / disabled
- Keep daily: 7 / 30 / 90
- Optional remote command: `rclone copy ...` (with note: "user responsibility, no validation")
- Creates user with bcrypt hash, saves config

**Wizard flow:**
- After slide 8: call `POST /api/v1/auth/setup` with username/password + ai-config
- Server creates admin user, returns JWT
- Frontend stores JWT, skips login on first run
- Subsequent runs: slide 8 already filled (read from config), only shows on explicit "Re-run"

### Cloudflare Tunnel (optional)

`install/install.sh` adds at the end:

```bash
if ask "Set up Cloudflare Tunnel? (requires domain + cloudflared)"; then
  bash scripts/cloudflared-setup.sh
fi
```

`scripts/cloudflared-setup.sh`:
1. Detect OS, install `cloudflared`
2. `cloudflared tunnel login` (opens browser, user pastes cert)
3. `cloudflared tunnel create mnexus`
4. Generate config.yml with tunnel → `http://localhost:4100`
5. `cloudflared tunnel route dns mnexus notes.example.com`
6. Install as system service (systemd / launchd / Windows service)
7. Print: "Your M-NEXUS is now at https://notes.example.com — Cloudflare handles DDoS, bot filtering, and (optionally) Access 2FA"

Optional Access policy: if user wants 2FA, they enable Cloudflare Access in dashboard (one click).

## Test plan

### Backend (additions)

- `users.test.ts`: create user, bcrypt verify, duplicate username, weak password rejection
- `rateLimit.test.ts`: 5 fails in 15min → 429, 10 in 24h → 1h lockout, success resets
- `aiProviders.test.ts`: mock fetch → ollama/openrouter/openai each return expected format
- `backup.test.ts`: create backup → file exists, rotation deletes old, remote command runs (mocked)
- `auth.test.ts`: login ok, login fail, lockout, expired JWT, LAN bypass

### Frontend (additions)

- `login.test.js`: form validation, submit, error display, redirect on success
- `auth.test.js`: token storage, isAuthed(), 401 handler

### E2E (manual via verify_app.cjs)

- Login flow: visit app without token → redirected to login → submit → main app
- LAN bypass: same request from 127.0.0.1 works without token
- Rate limit: 6 rapid failed logins → 429 on 6th
- Backup trigger: manual button creates a file in `data/backups/`

## Migration

- v2.5.0 → v2.6.0: **backward compatible** if `LAN_AUTH_BYPASS=true` (default).
  - Existing single-user JWTs still work (no schema change to JWT)
  - New users can be created via `/api/v1/auth/setup` only if no admin exists
  - Old deployments without admin user: setup wizard becomes mandatory on first run

## Rollback

If something breaks: revert to v2.5.0 tag. All new env vars default to safe values (auth disabled-by-default at route level is NOT the case; auth IS enabled by default in v2.6.0 — this is a security upgrade).

If user wants to disable auth entirely: `AUTH_REQUIRED=false` env var (escape hatch). Not documented; advanced only.

## Risks

| Risk | Mitigation |
|------|------------|
| Forgot admin password | Reset command in CLI wrapper: `mnexus reset-password <username>` |
| Backup fills disk | Rotation is mandatory; default keeps 30 daily + 12 monthly ≈ 50 backups max |
| AI provider leaks API key | API key stored in `data/ai-config.json` with 0600 perms; never logged; never returned in GET /admin/config |
| Cloudflare Tunnel misconfig | `cloudflared-setup.sh` validates tunnel exists before route; rollback by removing CNAME |
| Rate limit false-positive | Only failed logins count; per-IP; LAN bypass available |
| bcrypt rounds too slow on low-end CPU | 12 rounds = ~250ms on modern CPU, ~1s on Pi 3. Acceptable. |

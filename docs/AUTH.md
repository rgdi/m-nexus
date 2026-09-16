# Authentication (v2.6.0)

M-NEXUS uses a single-admin auth model designed for personal use over public networks.

## Concepts

| Term | Definition |
|---|---|
| **Admin user** | Single user that owns the instance. Created on first run via setup wizard. |
| **Access token** | JWT, 1h TTL, used for API authentication. Stored in `sessionStorage`. |
| **Refresh token** | 48-char random token, 90-day TTL. Stored in `localStorage`. Rotated on each use. |
| **LAN bypass** | If request comes from private IP (192.168.x, 10.x, 172.16-31.x, 127.x) AND `LAN_AUTH_BYPASS=true`, auth is skipped. |

## Flow

```
[Browser]                                 [Server]
   │                                          │
   ├─ login (username + password) ────────────>│
   │                                          │── bcrypt + throttle check
   │                                          │<─ 200 {accessToken, refreshToken}
   │<─ save to sessionStorage + localStorage ─┤
   │                                          │
   ├─ GET /api/v1/notes ──────────────────────>│
   │  Bearer: <accessToken>                   │
   │                                          │── JWT verify
   │<─ 200 notes ─────────────────────────────┤
   │                                          │
   │   ... 1 hour later, access token expires│
   │                                          │
   ├─ GET /api/v1/notes ──────────────────────>│
   │                                          │── JWT verify fails
   │<─ 401 ───────────────────────────────────┤
   │                                          │
   ├─ POST /api/v1/auth/refresh ──────────────>│
   │  {refreshToken}                          │── validate (not revoked, not expired)
   │                                          │── rotate (old → revoked, new issued)
   │<─ 200 {newAccessToken, newRefreshToken} ─┤
   │                                          │
   ├─ GET /api/v1/notes ──────────────────────>│
   │  Bearer: <newAccessToken>                │
   │<─ 200 notes ─────────────────────────────┤
```

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/login` | public | Username + password → tokens |
| POST | `/api/v1/auth/setup` | public (once) | Create admin (only when no admin exists) |
| POST | `/api/v1/auth/refresh` | public | Rotate refresh token, get new access token |
| POST | `/api/v1/auth/logout` | public | Stateless — client clears tokens |
| GET  | `/api/v1/auth/me` | JWT | Current user info |
| GET  | `/api/v1/auth/status` | public | `{needsSetup, lanBypass, authRequired, activeRefreshTokens}` |

## Security

| Defense | Mechanism |
|---|---|
| **Password** | bcrypt, 12 rounds (~250ms on modern CPU) |
| **Brute force** | 5 failed logins / 15min / IP → 429 with `Retry-After` |
| **Account lockout** | 10 failed logins / user → 1h lockout (HTTP 423) |
| **Token theft** | Refresh tokens rotate on each use; old token revoked server-side |
| **MITM** | HTTPS via Cloudflare Tunnel (recommended) |
| **XSS** | No third-party JS; CSP-friendly |
| **Replay** | Refresh token rotated + revoked; access tokens short-lived |

## Reset password

If you forgot your admin password:

```bash
# Edit data/users.json and set a new bcrypt hash (or delete file to re-run setup)
rm data/users.json
# Restart backend, open browser → wizard will show /auth/setup again
```

Or use the CLI wrapper (v2.1.5+):
```bash
mnexus reset-password admin
```

## LAN bypass (testing)

Default: `LAN_AUTH_BYPASS=true` (enabled). Requests from:
- `127.x.x.x`
- `10.x.x.x`
- `192.168.x.x`
- `172.16-31.x.x`
- `fe80::/10` (IPv6 link-local)

…will skip login throttle and JWT requirement. Useful for testing on home network.

**To disable** (recommended for production):
```bash
export LAN_AUTH_BYPASS=false
```

## Cloudflare Access (recommended for production)

Add a second layer of 2FA at the Cloudflare proxy level (free):

1. https://one.dash.cloudflare.com/
2. **Access** → **Applications** → **Add application** → **Self-hosted**
3. Application domain: `notes.example.com`
4. Policy: **Allow** with **Email** or **One-Time PIN** requirement
5. Save

Now anyone reaching your domain hits Cloudflare's email-OTP gate before reaching M-NEXUS auth.

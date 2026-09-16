# Security Model (v2.6.0)

Threat model, defenses, and checklist for deploying M-NEXUS publicly.

## Threat model

### What M-NEXUS protects against

| Threat | Defense |
|---|---|
| Brute force login | 5 fails/15min/IP throttle + 10 fails/24h account lockout |
| Stolen JWT | Access tokens expire in 1h; refresh tokens rotate on use |
| Stolen refresh token | 90-day TTL + rotation; old token revoked server-side |
| DDoS | Cloudflare Tunnel (recommended) or upstream reverse proxy |
| Bot enumeration | Same login throttle; Cloudflare Bot Fight Mode |
| MITM | HTTPS via Cloudflare Tunnel (TLS terminated at edge) |
| XSS | No third-party JS scripts; vanilla JS + CSP-friendly |
| CSRF | All mutating endpoints require JWT (no cookies = no CSRF) |
| Privilege escalation | Single-user model; admin scope required for admin routes |

### What M-NEXUS does NOT protect against

| Threat | Mitigation needed externally |
|---|---|
| Physical access to server | Disk encryption (LUKS / FileVault) |
| Compromised admin password | Strong password + Cloudflare Access 2FA |
| Compromised Cloudflare account | Enable 2FA on Cloudflare dashboard |
| Notes plaintext at rest | Encrypt `data/` directory at filesystem level |
| Compromised OS | Keep OS updated; run as non-root user |
| Insider (you, accidentally) | Regular backups (already done) |

## Pre-deploy checklist

### Required

- [ ] Changed default JWT secret (`JWT_SECRET` env var, min 32 chars)
- [ ] Changed default admin password (12+ chars)
- [ ] Configured HTTPS (Cloudflare Tunnel or reverse proxy with Let's Encrypt)
- [ ] Backend bound to localhost or LAN only (never `0.0.0.0` exposed)

### Recommended

- [ ] Cloudflare Tunnel configured (free DDoS + bot filtering)
- [ ] Cloudflare Access enabled (2FA at edge)
- [ ] `LAN_AUTH_BYPASS=false` if exposed publicly
- [ ] Auto-updates enabled for OS
- [ ] Firewall configured (only 22 SSH + Cloudflare tunnel open)
- [ ] Backups configured (Cloudflare R2, S3, B2, or external drive)
- [ ] Alert on failed logins (Cloudflare dashboard → Analytics → Security)

### Optional (defense in depth)

- [ ] Disk encryption (LUKS / FileVault / BitLocker)
- [ ] Reverse proxy (Caddy / nginx) with rate limiting
- [ ] Fail2ban monitoring auth.log
- [ ] SSH key-only login (no password auth)
- [ ] Separate user account for M-NEXUS process
- [ ] Audit log monitoring (`data/logs/`)
- [ ] DNS CAA records restricting to Cloudflare

## Post-deploy verification

```bash
# 1. Health check
curl -sI https://notes.example.com/api/v1/health

# 2. Auth endpoints public (login required first)
curl -s https://notes.example.com/api/v1/auth/status

# 3. Notes require auth (should 401 without token)
curl -sI https://notes.example.com/api/v1/notes

# 4. Login throttling works (run 6 times, last should 429)
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST -H "Content-Type: application/json" \
    -d '{"username":"nope","password":"nope"}' \
    https://notes.example.com/api/v1/auth/login
done
# Expected: 401 401 401 401 401 429

# 5. TLS grade (run from outside)
# https://www.ssllabs.com/ssltest/analyze.html?d=notes.example.com
```

## Security headers

M-NEXUS backend sends (via existing CSP middleware):

```
Content-Security-Policy: default-src 'self'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

Verify with:
```bash
curl -sI https://notes.example.com/api/v1/health | grep -i "strict-transport\|content-security"
```

## Reporting vulnerabilities

Found a security issue? Email security@example.com (or open a private issue).

Don't disclose publicly until fixed.

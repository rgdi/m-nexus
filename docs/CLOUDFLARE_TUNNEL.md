# Cloudflare Tunnel (v2.6.0)

Expose M-NEXUS to the internet safely via Cloudflare Tunnel. **Free DDoS + bot protection** + optional 2FA.

## Why Cloudflare Tunnel?

| Without tunnel | With Cloudflare Tunnel |
|---|---|
| Origin IP exposed to attackers | Origin IP hidden (only Cloudflare sees it) |
| You handle DDoS protection | Cloudflare handles it (free, unlimited) |
| You handle TLS cert | Cloudflare provides + auto-renews |
| You handle bot filtering | Cloudflare Bot Fight Mode included |
| Port 4100 open on router | No port forwarding needed |

## Prerequisites

1. **Domain** (e.g. `example.com`) — can be registered via Cloudflare Registrar
2. **Domain added to Cloudflare DNS** — free tier works
3. **cloudflared CLI** — installed by setup script automatically

## One-command setup

If you installed M-NEXUS via `install/install.sh`, the installer asks at the end:

```
Set up Cloudflare Tunnel? (requires domain on Cloudflare, gives free DDoS protection) [y/N]:
```

Answer `y` and follow the interactive prompts.

## Manual setup

```bash
bash scripts/cloudflared-setup.sh
```

Or step by step:

```bash
# 1. Install cloudflared
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb
sudo dpkg -i /tmp/cf.deb

# 2. Login (opens browser)
cloudflared tunnel login

# 3. Create tunnel
cloudflared tunnel create mnexus

# 4. Configure (~/.cloudflared/config.yml)
cat > ~/.cloudflared/config.yml <<EOF
tunnel: mnexus
credentials-file: /home/YOU/.cloudflared/<UUID>.json
ingress:
  - hostname: notes.example.com
    service: http://localhost:4100
  - service: http_status:404
EOF

# 5. Route DNS
cloudflared tunnel route dns mnexus notes.example.com

# 6. Install as service
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared
```

That's it. Visit `https://notes.example.com`.

## Cloudflare Access (optional 2FA)

Cloudflare Access adds a second layer of authentication **before** traffic even reaches M-NEXUS.

### Setup

1. Visit https://one.dash.cloudflare.com/
2. Click **Access** → **Applications**
3. **Add an application** → **Self-hosted**
4. Application configuration:
   - Name: `M-NEXUS`
   - Domain: `notes.example.com`
   - Session duration: 24 hours
5. Identity providers: Email + (optionally) One-Time PIN
6. **Add a policy**:
   - Policy name: `Allow admins`
   - Action: **Allow**
   - Include:
     - **Emails**: `your-email@example.com`
     - Or **Email ending in**: `@example.com` (your domain)
7. Save

### What happens now

Anyone visiting `notes.example.com`:
1. Hits Cloudflare edge
2. Cloudflare Access checks policy → if email matches → sends one-time PIN
3. After PIN entry, request forwarded to your tunnel → M-NEXUS backend
4. M-NEXUS still requires admin login (defense in depth)

### Free tier limits

Cloudflare Access free tier:
- 50 users
- Unlimited applications
- Unlimited policies

Perfect for personal use.

## Removing the tunnel

```bash
# Stop service
sudo systemctl stop cloudflared
sudo systemctl disable cloudflared

# Delete tunnel
cloudflared tunnel delete mnexus

# Remove DNS record (in Cloudflare dashboard)
# Type: CNAME, Name: notes, Target: <UUID>.cfargotunnel.com
```

## Troubleshooting

### "Tunnel not found"

Run `cloudflared tunnel info mnexus`. If it says tunnel doesn't exist, re-create:
```bash
cloudflared tunnel create mnexus
```

### "origin certificate error"

Cloudflare Tunnel uses the cert.pem file. If it's missing:
```bash
cloudflared tunnel login
```

### "DNS record not found"

After `cloudflared tunnel route dns`, propagation can take up to 5 minutes. Check with:
```bash
dig notes.example.com CNAME
```

### Service won't start

```bash
sudo journalctl -u cloudflared -n 50
```

Common causes:
- Wrong credentials-file path in config.yml
- Port 4100 not running
- Cloudflare account locked

### Migrating between servers

1. On old server: `cloudflared tunnel info mnexus` → note the UUID
2. Copy `~/.cloudflared/<UUID>.json` to new server
3. Copy `~/.cloudflared/config.yml` to new server
4. Install service on new server
5. Tunnel continues working — no DNS changes needed

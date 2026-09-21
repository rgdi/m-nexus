# M-NEXUS — Education OS for any career

> **v2.23.3** — Single-command installer · SHA-256 verified · systemd / Docker Compose /
> auto-upgrade · multi-server with auto-discovery · Accessible from day one.

M-NEXUS is a self-hosted education tracker. It is **not** limited to medical school:
templates ship for engineering, law, business, nursing, veterinary and any custom
career you define. Add subjects on the fly, sync via WebSocket across your devices,
run from a Raspberry Pi or scale across Kubernetes — same code, no rebuild.

---

## 📚 Documentation

| Doc | What it covers |
|---|---|
| [docs/SCALING.md](docs/SCALING.md) | **Read this first if you want to scale beyond one node.** Cluster setup, peer discovery, leader election, sticky routes, k8s manifests. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | High-level diagram, frontend / backend / storage separation, route catalogue. |
| [docs/API.md](docs/API.md) | Every REST endpoint + WebSocket message type. |
| [docs/AUTH.md](docs/AUTH.md) | JWT, devices, refresh tokens, LAN bypass, audit log. |
| [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) | Ollama, OpenRouter, OpenAI, mock providers. |
| [docs/SECURITY.md](docs/SECURITY.md) | Hardening, JWT secret strength, rate limits, public paths. |
| [docs/BACKUP.md](docs/BACKUP.md) | Auto-backup every N hours, restore from JSON, encrypted backups. |
| [docs/CLOUDFLARE_TUNNEL.md](docs/CLOUDFLARE_TUNNEL.md) | Expose your self-hosted instance without port forwarding. |
| [docs/ERROR_CODES.md](docs/ERROR_CODES.md) | Catalogue of `EC-XXX-NNN` codes the API returns. |
| [docs/LOGGING.md](docs/LOGGING.md) | Structured logs, log levels, audit, redaction. |

---

## ⚡ Install with one command

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install.sh | bash
```

That one line covers 4 modes — pick yours by passing the mode name as the first arg:

| Mode | What you get | When |
|---|---|---|
| `app` *(default)* | `mnexus-v2.23.x-debug.apk` ready for `adb install` | testing on a real device |
| `server` | backend running on `:4100`, optional webview + systemd + auto-upgrade | your dev machine / VPS |
| `deploy` | static bundle in `/var/www/html` (or `python3 -m http.server`) | shared hosting |
| `docker` | `docker compose build && up -d` with nginx + backend + webview | VPS / cloud |

```bash
# the "single command with sensible defaults"
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install.sh | bash

# back-end in your VPS, as a managed systemd unit
curl -fsSL .../install.sh | bash -s -- server --systemd

# back-end + frontend + systemd unit + cron auto-upgrade at 04:00
curl -fsSL .../install.sh | bash -s -- server --full --systemd --auto-upgrade

# docker compose with both nginx + backend
curl -fsSL .../install.sh | bash -s -- docker

# static bundle deploy to /var/www/html
curl -fsSL .../install.sh | bash -s -- deploy

# pin a specific version
curl -fsSL .../install.sh | bash -s -- --version v2.22.0

# custom path/domain
curl -fsSL .../install.sh | bash -s -- server --dir /opt/mnexus --domain mysite.com
```

The installer:
- resolves the **latest** release via the GitHub API
- auto-detects your OS (Ubuntu / Debian / Arch / RHEL / macOS)
- downloads `SHA256SUMS.txt` and **verifies every ZIP** against it before extracting
- installs `node_modules` if needed (or uses `npm install --no-audit --no-fund` fallback)
- registers a `mnexus.service` systemd unit when `--systemd` is passed (or auto-detected)
- offers a cron auto-upgrade job when `--auto-upgrade` is passed
- is fully **idempotent** — re-running is safe; it upgrades in place

See [`install.sh`](install.sh) for the full implementation (≈ 600 lines of bash,
zero external tooling required beyond `curl`, `tar`, `sha256sum`).

---

## 🎯 Who is it for

Originally a medical-school subject tracker, since v2.23.3 M-NEXUS ships:

- **Generic subject templates**: ESO, Bachiller (Científico / Humanidades), Medicina,
  Enfermería, Ingeniería, Derecho, ADE / Empresa, Veterinaria, **y tu propio
  conjunto personalizado** — el sistema no te obliga a elegir nada de la lista.
- **Customisable subjects**: empty by default. You add subjects in the setup wizard
  or at any time in the Subjects screen (drag-drop, color picker, bulk import).
- **Locale-aware**: full Spanish-from-Spain translation; English / Catalan / French
  planned. No hard-coded English/medicos strings.

If something feels too medical-school specific, open an issue or send a PR —
the templates live in `frontend/src/screens/subjects.js` (`TEMPLATES` array) and
the wizard in `frontend/src/widgets/setup_wizard.js`.

---

## 🛠 Features (current release)

### Subjects
- Empty by default — no fake seeds
- Drag & drop reordering with visual drop indicator (mobile long-press supported)
- Multi-device sync: add a subject on phone, appears on laptop within ~1 s
- 8 career templates, 60+ subjects ready to add in one click
- Color picker (WCAG-AA compliant), bulk import, JSON export

### Notes & notebooks
- Markdown `[[wikilinks]]`, `{{c1::cloze cards}}`, `@book/ref[12]` indexing
- FSRS-4 spaced-repetition flashcards generated from notes
- Sync across devices via WebSocket with field-level conflict resolution
- Conflict-merge UI: when you edit the same note on two devices, see the fields
  in conflict and pick which value wins per-field

### AI tutor
- Pluggable provider: Ollama (local, recommended), OpenRouter, OpenAI, mock for tests
- Generated MCQ decks, gap-fill exercises, question answering
- Streaming responses, cost-optimised embeddings cache

### Calendar / Tasks
- Weekly calendar with drag-to-create events
- Tasks with priorities, recurring patterns
- OCR ingest: take a photo of a textbook page, it becomes searchable text

### Android (Capacitor wrapper)
- Notification Listener Service (requires explicit permission grant)
- Foreground "data sync" service with PARTIAL_WAKE_LOCK (≤10 min watchdog)
- Battery-optimisation intent helpers
- Offline queue with IndexedDB persistence + auto-drain on reconnect
- Sync metrics endpoint for the dashboard

### Accessibility (WCAG 2.2 AA)
- 3 px focus-visible outline + 3 px offset
- 44 px touch-targets (Material minimum) on `pointer: coarse`
- Safe-area aware (notch / camera cutout / curved edges detection)
- Hamburger FAB bottom-left (no longer collides with camera)
- `--fg-on-subj-X` per-color tokens (white-on-yellow is invisible; we invert)
- Audio descriptions in the conflict-merge panel

### Hardening
- SHA-256 verified installs (no MITM possible at install time)
- `--user` flag for systemd unit (no `root` if you can avoid it)
- `NoNewPrivileges`, `ProtectSystem=full`, `PrivateTmp` in the systemd unit
- JWT_SECRET required in production (fails fast on weak values)
- LAN bypass only if `LAN_AUTH_BYPASS=true`

---

## 💾 Quick start (developer)

```bash
# Backend
cd backend
npm ci
npm run dev          # http://localhost:4100
npm test             # 977 tests (vitest)

# Frontend (vanilla JS, no build step)
cd frontend
python3 -m http.server 8080
# Open http://localhost:8080

# Webview bundle (single-file, ~1.4 MB)
bash scripts/build_webview.sh /tmp/mnexus-bundle
```

On first open, the **setup wizard** walks you through 8 slides:

1. Welcome (value prop, locale-aware)
2. Pick a vault (default / school / personal / work)
3. Add your first subject (one click, optional)
4. Notebook tips (`{{c1::}}`, `[[]]`, `@book/ref`)
5. Flashcards with FSRS (4 study modes)
6. AI provider (Ollama local / OpenRouter / OpenAI / mock)
7. Admin account + auto-backup config
8. Done — empty state on the Subjects screen

Re-run the wizard any time from **Settings → Setup wizard**.

---

## 🧪 Testing

```bash
cd backend && npm test              # 977 vitest suites
cd frontend && npm test             # 422 vitest suites
npm run typecheck                   # 0 TypeScript errors (strict)
```

E2E (optional, real Chromium):
```bash
node tests/scripts/e2e/run.mjs       # full smoke + screenshots
```

---

## 🚀 Deploy

### One bare metal box (default)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install.sh \
  | bash -s -- server --full --systemd
# get coffee · 2-3 minutes later, https://your-host:8080 is up
```

### VPS with nginx in front

```bash
curl -fsSL .../install.sh | bash -s -- server --full --systemd
sudo tee /etc/nginx/sites-available/mnexus <<EOF
server {
  listen 443 ssl http2;
  server_name mnexus.your-domain.com;
  ssl_certificate /etc/letsencrypt/live/.../fullchain.pem;
  location / { proxy_pass http://127.0.0.1:8080; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection "upgrade"; }
}
EOF
```

### Scale out across N servers

See [docs/SCALING.md](docs/SCALING.md). One Redis, N nodes, automatic peer
discovery, leader-elected jobs, sticky WS routes.

---

## 🤝 Contributing

PRs welcome. We follow:

- TypeScript strict, no `any` unless commented
- Backend: Fastify + ts-standard, 100 ms SLA per endpoint
- Frontend: vanilla JS (no React, no Vue), JSDoc for types
- Tests: vitest, ≥80 % coverage target
- Commit messages: `v2.x.y: short, low-case`

See [CONTRIBUTING.md](CONTRIBUTING.md) (TODO — tracked in v2.24.0).

---

## 📜 License

MIT — see [LICENSE](LICENSE). Long-term support: stable.

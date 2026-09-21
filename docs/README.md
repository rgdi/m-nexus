# M-NEXUS Documentation

This folder contains the deeper docs that don't fit in the top-level README.

## Operator docs

| File | For |
|---|---|
| [SCALING.md](SCALING.md) | **Multi-server topologies, peer discovery, leader election, k8s manifests.** Read this first if you intend to run more than one node. |
| [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md) | Expose a self-hosted instance to the public Internet without port forwarding. |
| [BACKUP.md](BACKUP.md) | Auto-backup every N hours; restore from JSON; encrypted backups. |
| [SECURITY.md](SECURITY.md) | Hardening checklist, JWT secret strength, rate limits, public paths. |

## Developer docs

| File | For |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | High-level diagram, frontend / backend / storage separation. |
| [API.md](API.md) | Every REST endpoint + WebSocket message type. |
| [ERROR_CODES.md](ERROR_CODES.md) | Catalogue of `EC-XXX-NNN` codes. |
| [AUTH.md](AUTH.md) | JWT, devices, refresh tokens, LAN bypass, audit. |
| [AI_PROVIDERS.md](AI_PROVIDERS.md) | Ollama, OpenRouter, OpenAI, mock. |
| [LOGGING.md](LOGGING.md) | Structured logs, audit, redaction. |
| [BACKEND_ONLY_FEATURES.md](BACKEND_ONLY_FEATURES.md) | Feats only triggered from the backend (scheduled jobs, listeners). |

## Reading order for new contributors

1. [ARCHITECTURE.md](ARCHITECTURE.md) — overall picture
2. [API.md](API.md) — surface area you'll extend
3. [AUTH.md](AUTH.md) — security model
4. [SCALING.md](SCALING.md) — if your change touches cluster behaviour
5. [ERROR_CODES.md](ERROR_CODES.md) — for error message UX

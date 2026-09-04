# M-NEXUS — Sistema de estudio médico con control humano

[![Release](https://img.shields.io/github/v/release/rgdi/m-nexus)](https://github.com/rgdi/m-nexus/releases/latest)
[![License](https://img.shields.io/github/license/rgdi/m-nexus)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1484%20passing-brightgreen)]()
[![Topic](https://img.shields.io/badge/topics-15-blue)]()

> **v0.33.0** · Notion-style databases, Secret Manager, Conflict Resolution, Chunked Upload, Rollback, Web Clipper

**M-NEXUS** = plugin de Obsidian + backend Node.js + companion app Android
para estudio médico con IA en el loop (FSRS spaced repetition, voice notes,
Notion-style databases con typed properties, conflict resolution por vector
clocks, chunked upload resumable, secret manager AES-256-GCM, y rollback
automático antes de updates).

Diseñado para ser **humano en el loop**: la IA propone, tú decides.

---

## 🎯 ¿Qué hace M-NEXUS?

### v0.33.0 — Notion-style
- **🗂️ Notion-style databases** — Typed properties (text/number/select/multi/date/url/email/relation/formula), vistas (Table, Kanban, Calendar, Gallery, List)
- **🔐 Secret Manager** — AES-256-GCM, API keys cifradas (OpenAI, etc.), nunca en plaintext .env
- **🔄 Conflict Resolution** — LWW por FIELD con vector clocks; merges sin pisar cambios de otros devices
- **📦 Chunked Upload** — 1 MB chunks, resumable, SHA-256 verify, ideal para grabaciones largas
- **⏪ Rollback** — Backup antes de update, restore con un click, registry de versiones
- **📎 Web Clipper** — Extensión Chrome para guardar papers de PubMed/NEJM/Lancet como notas
- **⚡ FSRS async workers** — Cola no-bloqueante, reintentos con backoff, status polling
- **🛡️ Auto-update Android 14/15/16** — Foreground service para install, rollback si falla

### v0.32.0 — Voice notes
- **🎙️ Voice notes de clases** — `speech_to_text` 7.x, foreground service, MANAGE_EXTERNAL_STORAGE
- **🆘 Help page** — Diagnóstico copiable, troubleshooting, FAQ

### v0.31.0 — Device identity
- **🔐 Device identity** — UUID v4 + ANDROID_ID persistente
- **🧙 Setup wizard** — Solo primer launch
- **📅 Google Calendar** — Vía ContentResolver (sin Google Sign-In)
- **🖼️ Logo** — M + heartbeat blue gradient

### Siempre
- **🧠 FSRS spaced repetition** — Algoritmo moderno (mejor que SM-2/Anki)
- **🤖 Proposals de IA** — Flashcards, resúmenes, preguntas (LLM local o remoto)
- **💾 Backup ultrarrápido** — ZIP binario con SQLite index
- **🔌 Offline-first** — Cola de cambios, sync cuando hay red
- **🚀 Auto-update** — Los 3 componentes se actualizan solos

---

## 🚀 Quick start (60 segundos)

### Opción A — Instalador automático (recomendado)

```bash
curl -fsSL https://raw.githubusercontent.com/rgdi/m-nexus/main/install/install.sh | bash -s -- --component=all --tag=stable
```

Para solo backend: `--component=backend`. Solo plugin: `--component=plugin`. Solo companion: `--component=companion`.

### Opción B — Manual

| Componente | Pasos |
|---|---|
| **Plugin Obsidian** | Settings → Community plugins → Browse → "M-NEXUS" → Install → Enable |
| **Backend** | `cd backend && npm install && npm run build && npm start` |
| **Companion Android** | Descarga APK desde [Releases](https://github.com/rgdi/m-nexus/releases/latest) |

Más detalles: [INSTALL.md](INSTALL.md)

---

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Obsidian plugin │ ←→ │  Backend Node   │ ←→ │ Companion app   │
│ (v0.33)         │    │  (v0.33)        │    │ Android (v0.33) │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        ↓                      ↓                       ↓
   Vault notes            SQLite + DB             Recordings,
   + frontmatter         Secret manager           Calendar,
   + Notion DBs          FSRS async               Plugin install
```

3 componentes independientes que se comunican por HTTP/JSON.
Cualquiera puede estar offline; el plugin queuea cambios.

---

## 🆕 v0.33.0 highlights

### Notion-style databases
Cada vault puede tener N "databases" (carpetas con schema tipado):

```yaml
---
title: Caso clínico #23
type: case
status: reviewed          # select: draft|reviewed|mastered
tags: [cardio, arritmias] # multi
severity: 7               # number
reviewed_at: 2026-09-04   # date
fhir_id: https://fhir.example/Patient/123  # url
---
```

Vistas: **Table**, **Kanban** (group by status), **Calendar** (group by date),
**Gallery** (con cover image). Fórmulas: `today()`, `now()`, `upper()`, `lower()`,
`length()`, `concat()`, `abs()`, `round()`, `if()`, `prop(name)`.

### Secret Manager
```bash
# Guardar (cifrado AES-256-GCM)
curl -X POST http://localhost:8787/api/v1/secrets/openai_api_key \
  -H "Content-Type: application/json" \
  -d '{"value":"sk-..."}'

# Listar nombres (nunca los valores)
curl http://localhost:8787/api/v1/secrets
```

### Conflict Resolution
Vector clocks per-field. Si device A modifica el `status` y device B
modifica el `reviewed_at`, AMBOS se preservan. Solo se detecta conflicto
si dos devices modifican el MISMO field concurrentemente.

### Chunked Upload
```dart
final uploader = ChunkedUpload(client: client, baseUrlGetter: () => url);
final result = await uploader.upload(
  file: recordingFile,
  deviceId: 'd1',
  targetSubdir: 'recordings/2026-09',
  onProgress: (sent, total) => print('$sent/$total'),
);
```
Resumable: si la red se cae, el siguiente intento continúa donde quedó.

### Web Clipper
Extensión Chrome que extrae metadata (título, autor, fecha, cover)
y crea una nota con frontmatter enriquecido. Detecta dominios médicos
(PubMed, OpenAlex, NEJM, Lancet, BMJ, JAMA, Cochrane) y los marca.

---

## 📦 Releases

| Versión | Fecha | Highlights |
|---|---|---|
| **v0.33.0** | 2026-09-04 | Notion-style, Secret Manager, Conflict Resolution, Chunked Upload, Rollback, Web Clipper, FSRS async |
| v0.32.0 | 2026-09-04 | Voice notes (speech_to_text 7.x), help page, foreground service |
| v0.31.0 | 2026-09-03 | Device identity, setup wizard, Google Calendar |
| v0.30.0 | 2026-09-03 | Auto-update (3 componentes), QR install |
| v0.29.7 | 2026-09-03 | Primer APK firmado |
| v0.28.0 | 2026-09-02 | Plugin v0.28 base + FSRS v5 |

---

## 🛠️ Development

```bash
# Plugin
cd obsidian-plugin && npm install && npm test

# Backend
cd backend && npm install && npm test

# Companion
cd companion-app && flutter pub get && flutter test
```

### Stack
- **Plugin**: TypeScript, Obsidian API, esbuild, vitest (1162 tests)
- **Backend**: Node 22, Fastify 5, TypeScript, better-sqlite3, vitest (245 tests)
- **Companion**: Flutter 3.24, Dart 3.5, Android 14+, vitest-equivalent (40 tests)
- **Total**: **1484 tests** ✓

---

## 🤝 Contributing

1. Fork
2. Branch (`git checkout -b feature/loquesea`)
3. Commit (`git commit -m 'feat: añade X'`)
4. Push
5. PR

Convenciones:
- Conventional commits
- Tests con `fault-injection` (deben fallar bajo condiciones controladas)
- Sin secrets en el repo
- Sin código muerto

---

## 📄 License

MIT

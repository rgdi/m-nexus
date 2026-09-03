# M-NEXUS — Sistema de estudio médico con control humano

[![Release](https://img.shields.io/github/v/release/rgdi/m-nexus)](https://github.com/rgdi/m-nexus/releases/latest)
[![License](https://img.shields.io/github/license/rgdi/m-nexus)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-1125%20passing-brightgreen)]()
[![Topic](https://img.shields.io/badge/topics-15-blue)]()

> **v0.31.0** · Auto-update system + device identity + Google Calendar + setup wizard

**M-NEXUS** = plugin de Obsidian + backend Node.js + companion app Android
para estudio médico con IA en el loop (FSRS spaced repetition, voice notes,
proposals de IA, backup ultrarrápido, offline-first).

Diseñado para ser **humano en el loop**: la IA propone, tú decides.

---

## 🎯 ¿Qué hace M-NEXUS?

- **🎙️ Voice notes de clases** — Graba la clase desde el móvil, se transcribe automáticamente, y se vincula al evento del Calendar
- **🧠 FSRS spaced repetition** — Algoritmo de repetición espaciada moderno (mejor que SM-2/Anki)
- **🤖 Proposals de IA** — Flashcards, resúmenes y preguntas generadas desde tus notas (LLM local o remoto)
- **📅 Integración Calendar** — Detecta eventos de clase y sugiere nombres/contextos
- **💾 Backup ultrarrápido** — ZIP binario con SQLite index, drag-and-drop
- **🔄 Offline-first** — Cola de cambios en el plugin, sincroniza cuando hay red
- **🚀 Auto-update** — Los 3 componentes (plugin, backend, companion) se actualizan solos
- **🔐 Device identity** — El companion se "reconoce" entre actualizaciones (mismo device_id, misma config)
- **🎨 Design system** — UI consistente con CSS variables y componentes reutilizables

---

## 🚀 Quick start (60 segundos)

### 1. Instala el plugin en Obsidian

| Método | Pasos |
|---|---|
| **Community Plugins** (recomendado) | Settings → Community plugins → Browse → "M-NEXUS" → Install → Enable |
| **BRAT** (beta) | Install BRAT, luego `brat install m-nexus` |
| **Manual** | Descarga y extrae en `{vault}/.obsidian/plugins/m-nexus/` |

### 2. (Opcional) Instala el backend

Para voz → texto, OCR, LLM proposals, etc.:

```bash
# Universal installer
curl -fsSL https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-install.sh -o install.sh
bash install.sh
# Sigue el wizard (puerto, IP, modelo LLM, etc.)
```

El backend es **opcional**: el plugin funciona solo (FSRS, voice notes local, flashcards), pero sin transcripción automática de audio.

### 3. (Opcional) Instala la companion app Android

Descarga el APK: [⬇ m-nexus-companion.apk](https://github.com/rgdi/m-nexus/releases/latest/download/m-nexus-companion.apk)

La companion app es:
- 🎙️ **Grabadora de clases** (vinculada a Calendar)
- 🛠️ **Setup wizard** del plugin en tu vault
- 🔧 **Configurador del backend** (URL/IP editable)
- 🔄 **Auto-update** del propio APK

---

## 📦 Componentes

| Componente | Stack | Tamaño | Auto-update |
|---|---|---|---|
| 🧩 **Plugin Obsidian** | TypeScript + esbuild | ~160 KB | Sí (Notice + link) |
| ⚙️ **Backend** | Node.js 22 + Fastify + SQLite | ~70 KB | `mnexus update-apply` |
| 📱 **Companion App** | Flutter 3.24 + Kotlin | ~50 MB | Diálogo nativo Android |

---

## 🛠️ Desarrollo

### Requisitos

- Node.js 22+
- pnpm o npm
- Flutter 3.24+ (solo para companion)
- JDK 17+ (solo para Android)

### Setup local

```bash
git clone https://github.com/rgdi/m-nexus.git
cd m-nexus
npm install --workspaces  # si tienes workspaces, si no, instalar cada uno

# Plugin
cd obsidian-plugin && npm install && npm test
# → 1125 tests

# Backend
cd ../backend && npm install && npm test
# → 23 update tests + resto

# Companion (requiere Flutter)
cd ../companion-app && flutter pub get && flutter test
# → 8 update tests + resto
```

### Estructura del monorepo

```
m-nexus/
├── obsidian-plugin/         # Plugin de Obsidian
│   ├── src/                 # TypeScript
│   ├── tests/               # vitest (1125 tests)
│   ├── manifest.json
│   └── versions.json
├── backend/                 # Backend Node.js
│   ├── src/
│   │   ├── routes/          # Fastify routes
│   │   ├── services/        # Whisper, LLM, OCR
│   │   ├── utils/
│   │   │   └── updateChecker.ts
│   │   └── cli.ts           # mnexus update-apply
│   └── tests/               # vitest
├── companion-app/           # App Android (Flutter)
│   ├── lib/
│   │   ├── services/        # device_id, calendar, updater
│   │   ├── ui/              # home, settings, setup_wizard
│   │   └── main.dart
│   ├── android/             # Kotlin platform channels
│   └── test/
├── docs/                    # Guías (BACKUP, AUTO_UPDATE, BUILD_APK)
├── install/                 # install.sh universal
└── .github/workflows/       # CI/CD (ci.yml, release.yml)
```

---

## 📚 Documentación

- [docs/AUTO_UPDATE.md](docs/AUTO_UPDATE.md) — Cómo funciona el auto-update
- [docs/BACKUP_*.md](docs/) — Sistema de backups ultrarrápidos
- [CHANGELOG.md](CHANGELOG.md) — Historial de versiones
- [Releases](https://github.com/rgdi/m-nexus/releases) — Binarios descargables

---

## 🤝 Contribuir

1. Fork
2. Branch (`git checkout -b feature/amazing`)
3. Tests (`npm test` en cada componente)
4. PR

---

## 📄 Licencia

MIT — ver [LICENSE](LICENSE)

---

## ❤️ Hecho con cariño para estudiantes de medicina

Rodrigo · 2026 · Hecho en Berlin, comiendo döner

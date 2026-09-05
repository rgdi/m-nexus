# M-NEXUS Obsidian Plugin

Plugin para Obsidian (TypeScript + esbuild) que da:
- 🎙️ Voice notes sincronizadas
- 🧠 FSRS spaced repetition
- 🤖 Proposals de IA (flashcards, resúmenes, preguntas)
- 📅 Integración con Calendar
- 🗂️ Notion-style databases (typed properties, views)
- 📎 Web Clipper (vía extensión Chrome)
- 💾 Backup ultrarrápido (ZIP + SQLite index)
- 🔌 Offline-first (queue + sync)
- 🚀 Auto-update

## v0.35.0

## Quick start (dev)

```bash
# Requisitos: Node.js >= 22
cd obsidian-plugin
npm install

# Build
npm run build  # genera main.js

# Watch mode (rebuilds on save)
npm run dev

# Tests (1162 tests)
npm test

# TypeScript check
npx tsc --noEmit
```

## Estructura

```
obsidian-plugin/
├── src/
│   ├── main.ts              # Entry point (MNexusPlugin class)
│   ├── settings.ts          # Settings tab
│   ├── constants.ts         # Constantes (tipos de vault, comandos, etc)
│   ├── types.ts             # TypeScript types
│   ├── subsystems.ts        # Lazy loaders de subsistemas
│   ├── updateChecker.ts     # Chequea updates
│   ├── plugin-api.ts        # API pública del plugin
│   ├── activity/            # Activity log (qué hiciste)
│   ├── ai/                  # AI subsystems (proposals, study orchestrator, vault eval)
│   ├── analytics/           # Analytics dashboard
│   ├── annotations/         # Anotaciones en PDFs
│   ├── audio/               # Audio (transcriber, registry, router)
│   ├── backup/              # Backup ultrarrápido
│   ├── calendar/            # Calendar (Google Calendar / ICS)
│   ├── clinical/            # Modales clínicos
│   ├── commands/            # Comandos de Obsidian
│   ├── coverage/            # Coverage auditor
│   ├── drawing/             # Drawing tools
│   ├── exams/               # Exam scheduler, FSRS integration, boost
│   ├── flashcards/          # Flashcard parser
│   ├── fsrs/                # FSRS v5 (scheduler, evaluation boost, load balancer)
│   ├── handwritten/         # OCR de notas escritas
│   ├── htr/                 # Handwritten text recognition
│   ├── legacy/              # Compatibilidad con versiones viejas
│   ├── levels/              # Sistema de niveles
│   ├── llm/                 # LLM managers (Ollama, OpenRouter, etc)
│   ├── metadata/            # Frontmatter manager
│   ├── pdf/                 # PDF management
│   ├── photos/              # Photo occlusions
│   ├── rag/                 # RAG (embeddings, indexer, retriever, chat)
│   ├── schedule/            # Schedule subsystem
│   ├── server/              # HTTP client
│   ├── services/            # aiClient (HTTP client centralizado)
│   ├── structured/          # Notion-style databases (v0.33+)
│   │   ├── schema.ts
│   │   ├── validate.ts
│   │   ├── databases.ts
│   │   ├── tableView.ts
│   │   ├── kanbanView.ts
│   │   └── calendarView.ts
│   ├── study/               # Study orchestrator
│   ├── sync/                # Sync queue (offline-first)
│   ├── ui/                  # Todas las páginas modales y vistas
│   ├── utils/               # Helpers
│   └── web-clipper/         # Chrome extension (v0.33+)
│       ├── manifest.json
│       ├── popup.html
│       ├── popup.js
│       └── content.js
├── tests/                   # 1162 tests (vitest + jsdom)
└── main.js                  # Build output (committeado para release)
```

## Subsistemas

El plugin tiene 18+ subsistemas que se cargan **lazy** (solo cuando se necesitan):

| Subsistema | Carga con | Descripción |
|---|---|---|
| `whisperInstaller` | comando "Voice note" | Instala whisper.cpp |
| `flashcardGenerator` | comando "Generate flashcards" | Genera propuestas |
| `templateManager` | comando "Templates" | Gestiona templates de notas |
| `coverageAuditor` | comando "Coverage" | Audita cobertura de temas |
| `handwrittenOcr` | al abrir nota con imagen | OCR de escritura |
| `fsrs` | al abrir flashcard | Algoritmo FSRS v5 |
| `loadBalancer` | al estudiar | Balancea carga entre temas |
| `llmManager` | al usar IA | Manager de LLMs |
| `calendarSync` | al abrir daily note | Sincroniza Calendar |
| `drawingManager` | comando "Drawing" | Herramientas de dibujo |
| `rag` | al usar chat | RAG para notas |
| `syncManager` | auto | Sincroniza con backend |
| `htrManager` | al usar handwriting | HTR avanzado |
| `studyOrchestrator` | al estudiar | Orquestador de study sessions |
| `vaultEvaluator` | comando "Eval vault" | Evalúa estado del vault |
| `knowledgeGraph` | al abrir graph view | Grafo de conocimiento |
| `adaptiveQuiz` | comando "Quiz" | Quiz adaptativo |
| `examScheduler` | comando "Schedule exam" | Schedule de exams |

## Tests

```bash
npm test                 # Run all
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage
```

**Total: 1162 tests** organizados en:
- `ai/` — propuestas, study orchestrator
- `coverage/` — auditor
- `e2e*/` — end-to-end (v17, v20, v28)
- `exams/` — scheduler, FSRS integration
- `fsrs/` — algoritmo v5
- `llm/` — providers
- `rag/` — embeddings, retriever
- `structured/` — Notion-style (v0.33+)
- y muchos más...

## Build (release)

```bash
# El CI hace esto:
npm run build
# genera obsidian-plugin/main.js (bundle de src/main.ts)

# Para release se necesita:
# - obsidian-plugin/main.js
# - obsidian-plugin/manifest.json
# - obsidian-plugin/styles.css
# Empaquetados en m-nexus-plugin.zip
```

Ver `.github/workflows/release.yml`.

## Notion-style (v0.33+)

El plugin soporta databases Notion-style en el vault:

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

Comandos:
- "M-NEXUS: Create database" — crea database
- "M-NEXUS: Open table view" — vista Table
- "M-NEXUS: Open kanban view" — vista Kanban (agrupada por status)
- "M-NEXUS: Open calendar view" — vista Calendar (por date)

Vistas soportadas:
- **Table** — todas las propiedades
- **Kanban** — agrupa por una propiedad
- **Calendar** — agrupa por una fecha
- **Gallery** — cover image
- **List** — vista simple

Fórmulas (mini-lenguaje seguro):
- `today()`, `now()` — fecha/hora actual
- `upper(s)`, `lower(s)` — mayúsculas/minúsculas
- `length(s)` — longitud
- `concat(a, b)` — concatenar
- `abs(n)`, `round(n)` — math
- `if(cond, a, b)` — condicional
- `prop(name)` — propiedad del row

Filtros: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `in`, `isEmpty`, `isNotEmpty`.

## Web Clipper (v0.33+)

Extensión Chrome MV3 (`web-clipper/`) que permite guardar páginas como notas:

1. Instala la carpeta `web-clipper/` como unpacked extension en Chrome
2. Configura el backend URL en el storage de la extensión
3. Click en el icono → "Clip página"
4. Se envía al backend → se crea una nota con metadata

Detecta automáticamente dominios médicos:
- PubMed (`pubmed.ncbi.nlm.nih.gov`)
- OpenAlex (`openalex.org`)
- NEJM (`nejm.org`)
- The Lancet (`thelancet.com`)
- BMJ (`bmj.com`)
- JAMA Network (`jamanetwork.com`)
- Cochrane (`cochrane.org`)

Y los marca con `data-mnexus-medical="true"`.

## Settings

Settings tab incluye:
- Backend URL
- Dispositivo (Device ID)
- Calendar
- AI providers (OpenAI, DeepSeek, Ollama)
- Auto-update
- Notion-style databases
- Voice notes (carpeta, formato)
- Tema

## Comandos principales

| Comando | Descripción |
|---|---|
| `M-NEXUS: Open dashboard` | Dashboard principal |
| `M-NEXUS: Open inbox` | Inbox de propuestas |
| `M-NEXUS: Generate flashcards` | Generar propuestas |
| `M-NEXUS: Evaluate vault` | Evaluar estado del vault |
| `M-NEXUS: Open chat` | Chat con IA sobre tus notas |
| `M-NEXUS: Record voice note` | Grabar voice note |
| `M-NEXUS: Schedule exam` | Programar un examen |
| `M-NEXUS: Weekly review` | Revisión semanal |
| `M-NEXUS: Open table/kanban/calendar view` | Vistas Notion |
| `M-NEXUS: Backup now` | Backup manual |
| `M-NEXUS: Help` | Abrir help page |
| `M-NEXUS: Settings` | Settings tab |

## Compatibilidad

- **Obsidian:** >= 1.5.0
- **Node (dev):** >= 22
- **TypeScript:** 5.3+
- **Vite/Vitest:** 2.1+

## Publicar

```bash
# 1. Bump version
vim manifest.json   # version: "0.36.0"
vim package.json    # version: "0.36.0"

# 2. Build
npm run build

# 3. Commit
git add -A
git commit -m "release: v0.36.0"
git push origin main
git tag v0.36.0
git push origin v0.36.0

# 4. CI genera el release
# Ver: https://github.com/rgdi/m-nexus/releases
```

## License

MIT

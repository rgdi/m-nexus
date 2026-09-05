# M-NEXUS — Visión Standalone (migración de Obsidian)

> **Status:** discusión abierta · **Target:** v1.0+ (post-migración completa)

## 📌 Contexto

M-NEXUS nació como un **plugin de Obsidian + companion app Android + backend Node.js**.
La idea era usar Obsidian como "render" de notas markdown, y el companion
como capa de captura (audio, calendar, vault, etc).

El usuario quiere **independizarse de Obsidian** y tener una app totalmente autónoma.

## 🎯 El plan en 3 niveles

### Nivel 1: Companion como centro de todo (ya casi listo)

Hoy el companion **ya hace** la mayoría de las cosas de forma autónoma:

- ✅ Graba audio (foreground service)
- ✅ Lee eventos del Calendar del sistema
- ✅ Edita vault en `Files/` (SAF + MANAGE_EXTERNAL_STORAGE)
- ✅ Sincroniza con el backend (SyncQueue offline-first)
- ✅ Crea estructura `_M-NEXUS/` (Flashcards, Inbox, Photos, etc.)
- ✅ Auto-update via GitHub Releases
- ✅ Notificaciones (RecordingService, etc.)

**Lo que aún requiere Obsidian:**

- ❌ Renderizar las notas (markdown)
- ❌ Mostrar flashcards en UI bonita
- ❌ FSRS schedule (está en el plugin)
- ❌ El "vim" del plugin (comandos, settings, etc.)

### Nivel 2: App Web Companion (webview standalone)

Crear una **versión web de la UI del plugin** que el companion sirva localmente:

```
┌─────────────────────────────────────────┐
│  M-NEXUS Companion (Android)            │
│                                         │
│  ┌──────────────┐  ┌──────────────┐    │
│  │  Audio       │  │  Calendar    │    │
│  │  Recorder    │  │  Picker      │    │
│  └──────────────┘  └──────────────┘    │
│                                         │
│  ┌──────────────────────────────────┐  │
│  │  WebView: localhost:8787         │  │  ← Misma UI que el plugin
│  │  (sirve el backend como SPA)     │  │
│  │  • Notas markdown                │  │
│  │  • Flashcards                    │  │
│  │  • Stats / Dashboard             │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

**Pros:**
- Reutiliza todo el código del plugin (TypeScript → SPA)
- Un único backend que sirve API + UI
- Sin recompilar para cambiar UI

**Cons:**
- WebView es pesado
- No es "nativo" pero es práctico

### Nivel 3: App Flutter Standalone (rewrite)

Reescribir el plugin de Obsidian en Flutter/Dart:

- Pantallas nativas para notas (markdown renderer con `flutter_markdown`)
- Pantalla de flashcards con animaciones
- Dashboard con charts
- Editor de texto
- Search

**Pros:**
- 100% nativo, rápido
- Una sola app, una sola base de código

**Cons:**
- Reescribir el plugin de cero
- 6-12 meses de trabajo
- Re-implementar todo el editor markdown

## 🛠 Roadmap propuesto

| Versión | Hito | Esfuerzo |
|---|---|---|
| **v0.40** | Logger avanzado con adb integration | 1 sesión ✅ |
| **v0.41** | Stats dashboard en el companion | 2-3 sesiones |
| **v0.42** | Editor markdown simple en companion (read-only) | 1 semana |
| **v0.43** | WebView integrado sirviendo el backend como SPA | 1 semana |
| **v0.44** | UI standalone con editor read-write | 1 mes |
| **v1.0** | App Flutter standalone con todas las features | 6 meses |

## 🧩 ¿Qué features de Obsidian querés reemplazar?

Necesito tu input para priorizar:

1. **Markdown rendering** — ¿Querés ver las notas en el companion o en el navegador?
2. **Editor de texto** — ¿Necesitás editar o solo leer?
3. **Flashcards UI** — ¿Las querés en el companion o te alcanza con exportarlas a Anki?
4. **FSRS algorithm** — ¿Querés estudiar desde el companion o desde Obsidian?
5. **Vault browsing** — ¿Querés navegar archivos en el companion?
6. **Settings/Commands** — ¿Panel de settings en el companion?
7. **Sync con GitHub** — ¿O te alcanza con el backend?
8. **Web Clipper** — ¿Querés clipear web en el companion o desde Chrome?
9. **OCR / Handwritten** — ¿Querés reconocimiento de escritura en el companion?
10. **Drawings** — ¿Querés dibujar en el companion?

## 🤔 Decisiones a tomar

- **¿El companion es el hub principal y Obsidian un cliente opcional?**
  - Pros: compatibilidad con lo que ya tenés
  - Cons: dos apps que mantener

- **¿Hacemos un PWA o una app Flutter?**
  - PWA: más rápido de hacer, mismo codebase que el plugin
  - Flutter: más nativo, mejor UX

- **¿El backend persiste notas, o el companion es 100% local?**
  - Backend: sync entre devices, backup automático
  - Local: más simple, más rápido, sin privacidad de servidor

- **¿Migración de notas existentes?**
  - ¿Querés mantener las notas en formato Obsidian (markdown + frontmatter)?
  - ¿O migrar a un formato nuevo?

## 📞 Próximos pasos

1. Decidí qué features son innegociables (las que necesitás SÍ O SÍ)
2. Elegí el approach (Nivel 2 webview vs Nivel 3 Flutter rewrite)
3. Empezamos con el MVP (lo más chico que demuestre valor)

Mientras tanto, **v0.39 trae el sistema de logging avanzado** que pediste,
para que podamos debugear y medir el comportamiento de todo lo que ya
está funcionando.

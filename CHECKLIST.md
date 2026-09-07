# M-NEXUS — CHECKLIST MAESTRO DE MEJORAS

> **Basado en:** `INFORME_EXPECTATIVA_VS_REALIDAD.pdf` + `MEGA_INFORME_M_NEXUS.pdf`
> **Auditor:** Mavis · **Fecha:** 2026-09-07
> **Rama:** `audit/checklist-and-improvements`
> **Reglas:**
> - ❌ NO se marca nada como "hecho" si no funciona end-to-end
> - ❌ NO se hacen claims de features que no estén implementadas
> - ✅ Cada tarea incluye: descripción, criterios de aceptación, tests, archivos a tocar
> - 🔴 Crítico · 🟠 Importante · 🟡 Deseable
> - **Cada commit debe pasar los tests + push a GitHub**

---

## Índice de fases

- [FASE 0 — Honestidad](#fase-0--honestidad-semana-1) — Corregir claims falsos en docs
- [FASE 1 — Core real](#fase-1--core-real-semanas-2-8) — Lo que dice que hace y NO hace
- [FASE 2 — PKM completo](#fase-2--pkm-completo-semanas-9-18) — Backlinks, graph, search, tags
- [FASE 3 — SRS top mundial](#fase-3--srs-top-mundial-semanas-19-32) — FSRS real, cloze, IO, audio
- [FASE 4 — Sync & multi-device](#fase-4--sync--multi-device-semanas-33-42) — CRDT, E2E
- [FASE 5 — AI & marketplace](#fase-5--ai--marketplace-semanas-43-54) — Tutor, propuestas con LLM
- [FASE 6 — Polish & comunidad](#fase-6--polish--comunidad-semanas-55-84) — Web clipper, biometric, themes

---

## FASE 0 — Honestidad (semana 1)

> **Objetivo:** credibilidad. Matar claims falsos en docs y código. La verdad atrae más que la promesa vacía.

### 0.1 Corregir descripción del repo GitHub
- 🔴 **Descripción GitHub actual:** "Auto-updating plugin + companion Android app + Node.js backend"
- 🔴 **Acción:** cambiar a "Standalone Flutter app (Android + Web) + optional Node.js backend for study, with FSRS spaced repetition, voice notes, and offline-first vault."
- 🔴 **Criterio:** la nueva descripción debe coincidir con lo que realmente hace el código
- 📁 **Archivo:** repo settings (GitHub)

### 0.2 Eliminar claim "Plugin de Obsidian" del README
- 🔴 **Actual:** múltiples referencias a "plugin de Obsidian" en README, descripción, y `STANDALONE_VISION.md`
- 🔴 **Acción:** remover todas las menciones o documentar como "futuro, no implementado"
- 🔴 **Criterio:** grep `plugin` no debe devolver referencias falsas
- 📁 **Archivos:** `README.md`, `backend/README.md`, `app/README.md`, `docs/STANDALONE_VISION.md`, `docs/API.md`

### 0.3 Renombrar "FSRS" a "SM-2" en docs y UI (hasta integrar FSRS real)
- 🔴 **Actual:** README, marketing, release notes dicen "FSRS"
- 🔴 **Acción:** etiquetar honestamente como "SM-2 simplificado" hasta integrar `ts-fsrs`
- 🔴 **Criterio:** `grep -ri "fsrs" --include="*.md" --include="*.dart" --include="*.ts"` solo aparece en planes futuros
- 📁 **Archivos:** `README.md`, `app/README.md`, `backend/README.md`, `RELEASE_NOTES.md`, `app/lib/services/flashcard_service.dart` (comentario)

### 0.4 Renombrar "AI-powered proposals" a "heuristic proposals"
- 🔴 **Actual:** `proposals.ts` no llama a ningún LLM
- 🔴 **Acción:** renombrar a "Heuristic-based proposal generator" hasta integrar LLM
- 🔴 **Criterio:** README y `proposals.ts` declaran honestamente que es heurística
- 📁 **Archivos:** `README.md`, `backend/src/services/proposals.ts`

### 0.5 Documentar TODAS las features backend-only
- 🟠 **Actual:** `structuredDatabases.ts`, `embeddings.ts`, `crossRelevance.ts`, `adaptiveQuiz.ts`, `pushNotifications.ts`, `chunkedUpload`, `notion-style` — todo backend, sin UI en la app
- 🟠 **Acción:** crear tabla `docs/BACKEND_ONLY_FEATURES.md` con cada feature y su estado de exposición
- 🟠 **Criterio:** documento existe y lista ≥10 features backend-only
- 📁 **Archivo nuevo:** `docs/BACKEND_ONLY_FEATURES.md`

### 0.6 Crear CHANGELOG.md honesto
- 🟠 **Actual:** `RELEASE_NOTES.md` con claims inflados
- 🟠 **Acción:** crear `CHANGELOG.md` con formato Keep a Changelog. Categorías: Added/Changed/Deprecated/Removed/Fixed/Security
- 🟠 **Criterio:** cumple Keep a Changelog 1.1.0 spec
- 📁 **Archivo nuevo:** `CHANGELOG.md`

### 0.7 Crear ROADMAP.md público
- 🟠 **Acción:** publicar el roadmap de 6 fases del mega-informe como `ROADMAP.md`
- 🟠 **Criterio:** documento accesible, formato markdown, priorización clara
- 📁 **Archivo nuevo:** `ROADMAP.md`

### 0.8 Tests para Fase 0
```bash
# 0.1-0.4: grep tests
grep -ri "fsrs" --include="*.md" --include="*.dart" --include="*.ts" app/ backend/ README.md RELEASE_NOTES.md 2>/dev/null | grep -v "ROADMAP.md\|CHANGELOG.md\|CHECKLIST.md\|audit/" | wc -l
# Expected: 0 (excepto en docs de plan)

grep -ri "plugin de obsidian\|obsidian plugin" --include="*.md" README.md RELEASE_NOTES.md backend/README.md app/README.md 2>/dev/null | wc -l
# Expected: 0

grep -ri "AI-powered" --include="*.md" README.md backend/README.md 2>/dev/null | wc -l
# Expected: 0

# 0.5-0.7: existencia
test -f docs/BACKEND_ONLY_FEATURES.md && echo "OK" || echo "FAIL"
test -f CHANGELOG.md && echo "OK" || echo "FAIL"
test -f ROADMAP.md && echo "OK" || echo "FAIL"
```

---

## FASE 1 — Core real (semanas 2-8)

> **Objetivo:** que el producto haga lo que dice. Reemplazar placeholders, stubs, y claims falsos por implementaciones reales.

### 1.A — FSRS real con `ts-fsrs` 🔴 CRÍTICO

**Por qué:** la promesa más importante del producto ("FSRS mejor que SM-2/Anki") es falsa. El usuario pierde 20-30% de retención.

#### 1.A.1 — Instalar `ts-fsrs` en backend
- 🔴 **Acción:** `npm install ts-fsrs @types/fsrs`
- 🔴 **Criterio:** package.json contiene `ts-fsrs` y compila sin errores
- 📁 **Archivo:** `backend/package.json`

#### 1.A.2 — Reemplazar `fsrsQueue.ts` simulation por scheduler real
- 🔴 **Actual:** `backend/src/workers/fsrsQueue.ts:185-197` simula FSRS
- 🔴 **Acción:** usar `ts-fsrs` con `fsrs(generatorParameters({...}))` y `f.repeat(card, now)[rating]`
- 🔴 **Criterio:** `runJob()` ahora produce S/D/R reales, no más `cardId === "__fail__"` magic strings
- 📁 **Archivo:** `backend/src/workers/fsrsQueue.ts`

#### 1.A.3 — Crear `Flashcard` model con campos FSRS completos en backend
- 🔴 **Acción:** modelar `Card` con `stability`, `difficulty`, `reps`, `lapses`, `state`, `due`, `lastReview`, `scheduledDays`, `elapsedDays` (campos del modelo DSR)
- 🔴 **Criterio:** schema TypeScript completo, JSON serializable
- 📁 **Archivo nuevo:** `backend/src/services/fsrsCard.ts`

#### 1.A.4 — Implementar FSRS en app (Dart)
- 🔴 **Acción:** port directo de `ts-fsrs` a Dart, o usar `fsrs_dart` package, o exponer endpoint del backend
- 🔴 **Opción A:** `pubspec.yaml` agregar `fsrs: ^1.0.0` (si existe en pub.dev)
- 🔴 **Opción B:** port manual de la lógica (~300 LOC en Dart)
- 🔴 **Opción C:** llamar al backend siempre (sacrifica offline)
- 🔴 **Recomendación:** Opción B (control total)
- 🔴 **Criterio:** 4 ratings (Again/Hard/Good/Easy) con S/D/R actualizados
- 📁 **Archivo nuevo:** `app/lib/services/fsrs_engine.dart`

#### 1.A.5 — Reemplazar 3 buttons por 4 buttons en review UI
- 🔴 **Actual:** `flashcard_review.dart:101-137` tiene 3 botones (Difícil/Regular/Fácil)
- 🔴 **Acción:** 4 botones (Again/Hard/Good/Easy) con colores semánticos, haptic feedback, predicted next interval
- 🔴 **Criterio:** UI muestra 4 botones, no 3. Cada botón llama `_rateCard(card, rating)` con valores 1-4
- 📁 **Archivo:** `app/lib/screens/flashcards/flashcard_review.dart`

#### 1.A.6 — Persistir historial de reviews en SQLite local
- 🔴 **Acción:** tabla `reviews` con `(card_id, rating, duration_ms, reviewed_at)`. Permite optimizer per-user.
- 🔴 **Criterio:** cada review crea fila en DB, no se pierde al reinstalar (vía backup/restore)
- 📁 **Archivos:** `app/lib/services/fsrs_engine.dart`, integrar en DB propuesta (1.E)

#### 1.A.7 — Tests para FSRS
- 🔴 **Tests unitarios (Dart):** 4 ratings, intervalos resultantes correctos vs tabla de referencia
- 🔴 **Tests unitarios (TS):** `ts-fsrs` wrapper, scheduler, queue
- 🔴 **Test de integración:** simular 100 repasas, validar que intervals crecen
- 🔴 **Test cross-cutting:** mismo historial produce mismo schedule en backend y app
- 📁 **Archivos nuevos:** `app/test/fsrs_engine_test.dart`, `backend/src/workers/fsrsQueue.test.ts` (re-escrito)

```dart
// app/test/fsrs_engine_test.dart
test('Again (rating 1) resets card to learning state', () {
  final card = makeCard(stability: 14, difficulty: 5, state: State.review);
  final newCard = fsrs.repeat(card, now)[Rating.Again];
  expect(newCard.card.state, State.relearning);
  expect(newCard.card.lapses, 1);
});
```

```ts
// backend/src/workers/fsrsQueue.test.ts
test('FSRS queue produces real DSR values, not simulation', () => {
  const card = createEmptyCard();
  const job = { cardIds: ['card1'], algorithm: 'fsrs-v6' };
  const result = runJob(job);
  expect(result.cards[0].stability).toBeGreaterThan(0);
  expect(result.cards[0].difficulty).toBeGreaterThan(0);
  expect(result.cards[0].due.getTime()).toBeGreaterThan(Date.now());
});
```

### 1.B — AI proposals con LLM real 🔴 CRÍTICO

#### 1.B.1 — Reemplazar `proposals.ts` regex por `LLMService.chat()`
- 🔴 **Actual:** `backend/src/services/proposals.ts:11-35` usa regex
- 🔴 **Acción:** crear nueva `proposalsV2.ts` que usa `LLMService` con prompt estructurado
- 🔴 **Prompt ejemplo:**
  ```
  Sos profesor de medicina. Dada la siguiente nota, generá 5 flashcards de alta calidad.
  Formato JSON: [{"type": "cloze" | "front-back", "front": "...", "back": "..."}].
  Incluí preguntas clínicas relevantes, no solo definiciones.
  ```
- 🔴 **Criterio:** cada card generada tiene contenido específico del tema, no "¿Qué es X?"
- 📁 **Archivo nuevo:** `backend/src/services/proposalsV2.ts`

#### 1.B.2 — Fallback heurístico si LLM no disponible
- 🟠 **Acción:** si `LLMService` no responde (Ollama down, OpenRouter sin key), usar regex como fallback
- 🟠 **Criterio:** función nunca crashea, degrada gracefully
- 📁 **Archivo:** `backend/src/services/proposalsV2.ts`

#### 1.B.3 — Cache de proposals
- 🟠 **Acción:** cache key = `hash(note.content)`, no regenerar si no cambió la nota
- 🟠 **Criterio:** segunda llamada con misma nota retorna en <10ms
- 📁 **Archivo:** `backend/src/services/proposalCache.ts`

#### 1.B.4 — Tests
- 🔴 **Unit:** mockear `LLMService`, verificar que se llama con prompt correcto
- 🔴 **Integration:** nota real de anatomía → 5 cards médicas específicas
- 🔴 **Fallback:** si LLM throws, retorna regex fallback sin crashear

### 1.C — Whisper real 🔴 CRÍTICO

#### 1.C.1 — Instalar whisper-node en backend
- 🔴 **Acción:** `npm install nodejs-whisper` o `npm install whisper-node`
- 🔴 **Nota:** modelos ggml (~140MB) deben descargarse; documentar en install.sh
- 🔴 **Criterio:** whisper service transcribe un mp3 de prueba y devuelve texto real
- 📁 **Archivo:** `backend/package.json`

#### 1.C.2 — Reemplazar `streamingTranscription.ts` placeholder
- 🔴 **Actual:** devuelve `text: ""` (línea 79)
- 🔴 **Acción:** implementar transcripción real con `nodejs-whisper`
- 🔴 **Criterio:** audio de 5 segundos devuelve transcripción con >80% accuracy
- 📁 **Archivo:** `backend/src/services/streamingTranscription.ts`

#### 1.C.3 — Tests con audio real
- 🔴 **Test:** fixture de audio mp3 de 5s con texto conocido → valida transcripción exacta
- 🔴 **Criterio:** test pasa con audio de prueba

### 1.D — Voice input en app 🔴 CRÍTICO

#### 1.D.1 — Agregar dependencias faltantes al pubspec
- 🔴 **Acción:** `pubspec.yaml` agregar:
  ```yaml
  speech_to_text: ^7.0.0
  record: ^5.0.0
  record_android: ^1.0.0  # o record_platform_interface
  permission_handler: ^11.3.1  # ya está
  ```
- 🔴 **Criterio:** `flutter pub get` resuelve sin conflictos
- 📁 **Archivo:** `app/pubspec.yaml`

#### 1.D.2 — Implementar `VoiceNoteService`
- 🔴 **Acción:** service que graba audio + transcribe (en cliente o vía backend)
- 🔴 **Criterio:** graba 10s de audio, lo manda al backend, recibe transcripción, la inserta en nota
- 📁 **Archivo nuevo:** `app/lib/services/voice_note_service.dart`

#### 1.D.3 — Integrar en UI
- 🔴 **Acción:** botón de micrófono en `note_editor` y `home_screen`
- 🔴 **Criterio:** tap → graba → transcribe → texto aparece en editor
- 📁 **Archivos:** `app/lib/screens/note/note_editor.dart`, `app/lib/screens/home/home_screen.dart`

#### 1.D.4 — Permisos
- 🔴 **Acción:** request `RECORD_AUDIO` permission en runtime
- 🔴 **Criterio:** en Android 13+ muestra dialog del sistema
- 📁 **Archivo:** `app/lib/services/permissions.dart` (existente, ampliar)

#### 1.D.5 — Tests
- 🔴 **Test:** mock de `speech_to_text`, simular transcripción
- 🔴 **Criterio:** UI se actualiza con texto transcrito

### 1.E — Tests reales (desactivar MOCKs globales) 🔴 CRÍTICO

#### 1.E.1 — Refactor `backend/tests/setup.ts`
- 🔴 **Actual:** activa `MOCK_WHISPER=1`, `MOCK_OLLAMA=1`, etc. globalmente
- 🔴 **Acción:** NO activar MOCKs globalmente. Mockear solo en tests específicos que lo requieran.
- 🔴 **Criterio:** `grep "MOCK_" backend/tests/*.test.ts` solo en tests específicos
- 📁 **Archivo:** `backend/tests/setup.ts`

#### 1.E.2 — Mockear HTTP a nivel de test, no a nivel de env
- 🔴 **Acción:** usar `vi.mock()` o `nock` para mockear `fetch` por test
- 🔴 **Criterio:** tests de `WhisperService` mockean `fetch` a `localhost:8080`, no `MOCK_WHISPER=1`
- 📁 **Archivos:** cada `*.test.ts` específico

#### 1.E.3 — Cobertura de código real
- 🔴 **Métrica:** `npm run coverage` debe mostrar >70% en código de producción
- 🔴 **Criterio:** excluir del coverage solo los MOCK_*, no el código real
- 📁 **Archivo:** `backend/vitest.config.ts`

#### 1.E.4 — Test cross-cutting backend-app
- 🔴 **Acción:** script que:
  1. Levanta el backend con un fixture de vault
  2. Corre la app con `integration_test` package
  3. Hace POST /api/v1/llm/chat, GET /health
  4. Verifica respuestas
- 🔴 **Criterio:** script pasa en CI local
- 📁 **Archivo nuevo:** `tests/integration/cross_test.sh` o `tests/integration_test/`

### 1.F — i18n (multi-idioma) 🟠 IMPORTANTE

#### 1.F.1 — Agregar dependencias
- 🟠 **Acción:** `pubspec.yaml` agregar:
  ```yaml
  flutter_localizations:
    sdk: flutter
  intl: any
  ```
- 🟠 **Criterio:** `flutter pub get` OK

#### 1.F.2 — Generar archivos ARB
- 🟠 **Acción:** `flutter gen-l10n` con template `lib/l10n/`
- 🟠 **Idiomas iniciales:** español (default), inglés, portugués
- 🟠 **Criterio:** 3 archivos ARB + 3 `.dart` generados

#### 1.F.3 — Reemplazar strings hardcoded
- 🟠 **Acción:** todos los `Text('...')` y `Strings.xml` reemplazados por `AppLocalizations.of(context).xxx`
- 🟠 **Criterio:** `grep -r "Text('" app/lib/ | grep -v ".g.dart" | wc -l` = 0 (excepto dinámicos)
- 📁 **Archivos:** todos los `.dart` con UI

#### 1.F.4 — Backend i18n
- 🟠 **Acción:** mensajes de error en backend retornan `code` (EC-XXX-NNN), frontend traduce
- 🟠 **Criterio:** `errorCodes.ts` mantiene solo códigos, mensajes via `hint` localizado en frontend

#### 1.F.5 — Tests
- 🟠 **Test:** cambiar locale a `en`, verificar que textos aparecen en inglés

### 1.G — Dependencies que faltan (instalar todo de golpe)

#### App (`app/pubspec.yaml`)
```yaml
# CRÍTICOS (1.A-1.D)
fsrs: ^1.0.0  # o port manual
speech_to_text: ^7.0.0
record: ^5.0.0
record_android: ^1.0.0

# DB local (Fase 2)
drift: ^2.20.0
drift_flutter: ^0.2.0
sqlite3_flutter_libs: ^0.5.0

# UI/UX
flutter_quill: ^10.0.0  # editor markdown
fl_chart: ^0.69.0  # gráficos stats
flutter_heatmap_calendar: ^2.0.0
table_calendar: ^3.1.0

# Seguridad
flutter_secure_storage: ^9.0.0
local_auth: ^2.3.0

# Sync (Fase 4)
yjs: any  # si existe, si no, ver alternativa

# Network
connectivity_plus: ^6.0.0

# Notificaciones
flutter_local_notifications: ^17.0.0
firebase_messaging: ^15.0.0  # FCM

# Util
wakelock_plus: ^1.2.0  # pantalla no se apaga
share_plus: ^10.0.0
image_picker: ^1.1.0
photo_view: ^0.15.0
auto_size_text: ^3.0.0
```

#### Backend (`backend/package.json`)
```json
{
  "dependencies": {
    "ts-fsrs": "^4.5.0",
    "nodejs-whisper": "^0.2.0",
    "yjs": "^13.6.0",
    "y-leveldb": "^0.1.0",
    "drizzle-orm": "^0.36.0",
    "better-sqlite3": "^11.0.0",
    "zod": "^3.23.0",
    "@fastify/helmet": "^12.0.0",
    "@fastify/csrf-protection": "^7.0.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.4.0"
  }
}
```

#### 1.G.1 — Verificar que nada rompe
- 🟠 `flutter pub get` sin warnings críticos
- 🟠 `npm install` sin peer dep errors
- 🟠 `npm run build` (TypeScript) sin errores
- 🟠 `flutter analyze` sin errores

#### 1.G.2 — Lock files commited
- 🟠 `pubspec.lock` y `package-lock.json` commited
- 🟠 Criterio: `git status` clean después de install

---

## FASE 2 — PKM completo (semanas 9-18)

> **Objetivo:** ser un PKM real comparable a Obsidian/Logseq, no solo flashcards.

### 2.A — Búsqueda full-text con SQLite FTS5 🔴 CRÍTICO

#### 2.A.1 — Crear schema de DB
- 🔴 **Acción:** `app/lib/db/app_db.dart` con `drift`:
  - Tabla `notes` con índice FTS5 virtual
  - Tabla `cards` con campos FSRS
  - Tabla `reviews` con historial
  - Tabla `tags` y `note_tags`
- 🔴 **Criterio:** DB se crea, FTS5 funciona (`MATCH` queries retornan resultados)
- 📁 **Archivo nuevo:** `app/lib/db/app_db.dart`

#### 2.A.2 — Migrar frontmatter a DB
- 🔴 **Acción:** al primer launch con DB, leer todos los `.md` del vault e importar metadata
- 🔴 **Criterio:** no se duplican cards, no se pierden datos
- 📁 **Archivo:** `app/lib/db/migration.dart`

#### 2.A.3 — Pantalla de Search (command palette)
- 🔴 **Acción:** modal accesible con `Cmd+K` (web/desktop) o gesto (mobile)
- 🔴 **Resultados:** notas, cards, tags, all in one
- 🔴 **Criterio:** búsqueda de "diafragma" retorna en <50ms con FTS5
- 📁 **Archivo nuevo:** `app/lib/screens/search/search_screen.dart`

#### 2.A.4 — Tests
- 🔴 **Test:** FTS5 query con stemming funciona
- 🔴 **Test:** búsqueda "diafragma" en vault de 1000 notas retorna <100ms

### 2.B — Bidirectional links `[[wikilinks]]` 🔴 CRÍTICO

#### 2.B.1 — Parser de wikilinks
- 🔴 **Acción:** regex `\[\[([^\]]+)\]\]` → lista de links
- 🔴 **Criterio:** extraer todos los wikilinks de una nota
- 📁 **Archivo:** `app/lib/services/wikilink_parser.dart`

#### 2.B.2 — Autocompletado en editor
- 🔴 **Acción:** al escribir `[[`, popup con notas existentes
- 🔴 **Criterio:** aparece en <100ms, navegable con teclado
- 📁 **Archivo:** `app/lib/screens/note/note_editor.dart` (modificar)

#### 2.B.3 — Backlinks panel
- 🔴 **Acción:** en `note_view`, mostrar notas que linkean a esta
- 🔴 **Criterio:** actualizado en tiempo real al editar
- 📁 **Archivo:** `app/lib/screens/note/note_view.dart` (modificar)

#### 2.B.4 — Tests
- 🔴 **Unit:** parser extrae correctamente
- 🔴 **Integration:** crear nota A con `[[B]]`, abrir B, ver backlink de A

### 2.C — Graph view 🟠 IMPORTANTE

#### 2.C.1 — Implementar renderer
- 🟠 **Acción:** usar `graphview` package o `CustomPainter` con force-directed layout
- 🟠 **Criterio:** vault de 100 notas renderiza en <2s, interactivo (drag, zoom, click)
- 📁 **Archivo nuevo:** `app/lib/screens/graph/graph_screen.dart`

#### 2.C.2 — Local graph en note_view
- 🟠 **Acción:** mini-graph 1-hop en el panel lateral de cada nota
- 🟠 **Criterio:** muestra vecinos directos
- 📁 **Archivo:** `app/lib/widgets/local_graph.dart` (nuevo)

#### 2.C.3 — Tests
- 🟠 **Test:** layout determinístico con seed fija

### 2.D — Daily notes + Templates 🟠 IMPORTANTE

#### 2.D.1 — Daily note auto-creada
- 🟠 **Acción:** al abrir app, verificar `Daily/YYYY-MM-DD.md`, crear si no existe con template
- 🟠 **Criterio:** funciona offline, no duplica
- 📁 **Archivo:** `app/lib/services/daily_note_service.dart`

#### 2.D.2 — Sistema de templates
- 🟠 **Acción:** carpeta `Templates/` con archivos `.md`. Insertar template al crear nota.
- 🟠 **Templates built-in:** SOAP, H&P, Pharmacology card, Anatomy
- 🟠 **Criterio:** picker de templates al crear nota
- 📁 **Archivos nuevos:** `app/lib/services/template_service.dart`, templates en `assets/templates/`

#### 2.D.3 — Tests
- 🟠 **Test:** template se inserta correctamente
- 🟠 **Test:** daily note se crea solo una vez por día

### 2.E — Tags + tag pages 🟠 IMPORTANTE

#### 2.E.1 — Tag autocomplete
- 🟠 **Acción:** al escribir `#`, popup con tags existentes
- 🟠 **Criterio:** aparecer en <100ms
- 📁 **Archivo:** `app/lib/screens/note/note_editor.dart` (modificar)

#### 2.E.2 — Tag page
- 🟠 **Acción:** ruta virtual `/tags/:tagname` que lista notas con ese tag
- 🟠 **Criterio:** se actualiza al cambiar tags
- 📁 **Archivo nuevo:** `app/lib/screens/tags/tag_page.dart`

#### 2.E.3 — Tag panel lateral
- 🟠 **Acción:** mostrar todos los tags con count
- 🟠 **Criterio:** click navega a tag page
- 📁 **Archivo nuevo:** `app/lib/widgets/tag_panel.dart`

#### 2.E.4 — Tests
- 🟠 **Test:** tag autocomplete funciona con 100 tags

### 2.F — Block-level references 🟡 DESEABLE

#### 2.F.1 — Asignar ID a cada heading
- 🟡 **Acción:** `^b-uuid` en cada `## heading`
- 🟡 **Criterio:** formato compatible con Obsidian
- 📁 **Archivo:** `app/lib/services/block_id_service.dart`

#### 2.F.2 — Link `[[note#^b-uuid]]`
- 🟡 **Acción:** parser y renderer
- 🟡 **Criterio:** scroll automático al bloque
- 📁 **Archivo:** `app/lib/screens/note/note_view.dart`

### 2.G — Dataview-lite 🟡 DESEABLE

#### 2.G.1 — Query parser
- 🟡 **Acción:** `LIST FROM #tag SORT mtime DESC`
- 🟡 **Criterio:** queries simples funcionan
- 📁 **Archivo:** `app/lib/services/dataview_service.dart`

#### 2.G.2 — Render inline
- 🟡 **Acción:** reemplazar query con resultados
- 🟡 **Criterio:** se actualiza al cambiar notas
- 📁 **Archivo:** `app/lib/widgets/dataview_block.dart`

---

## FASE 3 — SRS top mundial (semanas 19-32)

> **Objetivo:** superar a Anki en UX y mantener paridad en features.

### 3.A — Cloze deletion 🔴 CRÍTICO

#### 3.A.1 — Editor con syntax `{{c1::texto}}`
- 🔴 **Acción:** editor con highlighting
- 🔴 **Criterio:** puede crear cloze en cualquier parte del texto
- 📁 **Archivo nuevo:** `app/lib/screens/flashcards/cloze_editor.dart`

#### 3.A.2 — Render en review
- 🔴 **Acción:** mostrar texto con `[___]` por cloze
- 🔴 **Criterio:** cada cloze es una card separada
- 📁 **Archivo:** `app/lib/screens/flashcards/flashcard_review.dart` (extender)

#### 3.A.3 — DB schema
- 🔴 **Acción:** tabla `clozes` con FK a `cards`
- 🔴 **Criterio:** soporta múltiples cloze por card (c1, c2, c3)
- 📁 **Archivo:** `app/lib/db/app_db.dart`

#### 3.A.4 — Tests
- 🔴 **Test:** crear cloze, generar N cards (1 por cloze)

### 3.B — Image occlusion 🔴 CRÍTICO

#### 3.B.1 — Editor con canvas
- 🔴 **Acción:** importar imagen, dibujar rectángulos/elipses
- 🔴 **Criterio:** exporta máscaras en JSON
- 📁 **Archivo nuevo:** `app/lib/screens/flashcards/image_occlusion_editor.dart`

#### 3.B.2 — Modos Hide All/Hide One
- 🔴 **Acción:** dos modos de review
- 🔴 **Criterio:** cada máscara genera 1 card
- 📁 **Archivo:** `app/lib/screens/flashcards/io_review.dart`

#### 3.B.3 — Almacenamiento
- 🔴 **Acción:** imagen + máscaras JSON en vault
- 🔴 **Criterio:** formato portable
- 📁 **Archivo:** `app/lib/services/io_storage.dart`

#### 3.B.4 — Tests
- 🔴 **Test:** dibujar rectángulo genera 1 card con la región ocluida

### 3.C — Audio cards 🟠 IMPORTANTE

#### 3.C.1 — Grabador integrado
- 🟠 **Acción:** grabar audio al crear card
- 🟠 **Criterio:** guarda en vault, persistente
- 📁 **Archivo nuevo:** `app/lib/screens/flashcards/audio_card_editor.dart`

#### 3.C.2 — Reproductor en review
- 🟠 **Acción:** play/pause, playback speed
- 🟠 **Criterio:** speed control 0.5x-2x
- 📁 **Archivo:** `app/lib/screens/flashcards/flashcard_review.dart` (extender)

#### 3.C.3 — Type-answer con audio
- 🟠 **Acción:** escuchar y escribir lo escuchado
- 🟠 **Criterio:** valida con fuzzy match
- 📁 **Archivo nuevo:** `app/lib/screens/flashcards/audio_type_review.dart`

#### 3.C.4 — Tests
- 🟠 **Test:** audio se guarda y se puede reproducir

### 3.D — Type-answer cards 🟠 IMPORTANTE

#### 3.D.1 — Input con fuzzy match
- 🟠 **Acción:** input field, compara con respuesta esperada
- 🟠 **Criterio:** Levenshtein distance, normalización de tildes
- 📁 **Archivo:** `app/lib/services/fuzzy_match.dart`

#### 3.D.2 — Hint escalable
- 🟠 **Acción:** primer carácter tras N segundos, segundo tras 2N, etc.
- 🟠 **Criterio:** configurable
- 📁 **Archivo:** `app/lib/screens/flashcards/type_answer_review.dart`

#### 3.D.3 — Tests
- 🟠 **Test:** "diaphragm" vs "diafragma" → match
- 🟠 **Test:** "diaphragm" vs "dyaphragm" → partial match

### 3.E — 4-button review con FSRS feedback 🟠 IMPORTANTE

#### 3.E.1 — UI mejorada
- 🟠 **Acción:** 4 botones con colores semánticos (Rojo Again, Naranja Hard, Verde Good, Azul Easy)
- 🟠 **Criterio:** haptic feedback diferenciado
- 📁 **Archivo:** `app/lib/screens/flashcards/flashcard_review.dart` (extender)

#### 3.E.2 — Mostrar "next interval" predicho
- 🟠 **Acción:** cada botón muestra "5d", "10d", "20d" debajo
- 🟠 **Criterio:** tiempo real según FSRS
- 📁 **Archivo:** idem

#### 3.E.3 — Retrievability curve
- 🟠 **Acción:** mini-gráfico mostrando R decay
- 🟠 **Criterio:** visualizable, no intrusivo
- 📁 **Archivo:** `app/lib/widgets/retrievability_chart.dart` (nuevo)

#### 3.E.4 — Tests
- 🟠 **Test:** cada botón calcula el próximo intervalo correctamente

### 3.F — Heatmap + Stats dashboard 🟠 IMPORTANTE

#### 3.F.1 — Heatmap de repasas
- 🟠 **Acción:** GitHub-style, 365 días atrás
- 🟠 **Criterio:** tap en día muestra detalle
- 📁 **Archivo nuevo:** `app/lib/screens/stats/heatmap_view.dart`

#### 3.F.2 — Stats screen
- 🟠 **Acción:** retention rate, time spent, cards matured, forecast
- 🟠 **Criterio:** datos reales, no demos
- 📁 **Archivo nuevo:** `app/lib/screens/stats/stats_screen.dart`

#### 3.F.3 — Charts con fl_chart
- 🟠 **Acción:** line chart, bar chart, pie chart
- 🟠 **Criterio:** actualizados en tiempo real
- 📁 **Archivos:** `app/lib/widgets/charts/*.dart` (nuevos)

#### 3.F.4 — Tests
- 🟠 **Test:** stats con 100 repasas simuladas son correctas

### 3.G — Custom retention target 🟡 DESEABLE

#### 3.G.1 — Slider 80-95%
- 🟡 **Acción:** en settings, ajustar retention target
- 🟡 **Criterio:** recalcula schedule existente
- 📁 **Archivo:** `app/lib/services/fsrs_engine.dart` (extender)

### 3.H — Cram mode 🟡 DESEABLE

#### 3.H.1 — Modo sin afectar schedule
- 🟡 **Acción:** opción "estudiar sin reprogramar"
- 🟡 **Criterio:** cards no se mueven, no se actualizan reviews
- 📁 **Archivo:** `app/lib/screens/flashcards/cram_mode.dart`

### 3.I — Filtered decks 🟡 DESEABLE

#### 3.I.1 — Query builder
- 🟡 **Acción:** `deck:Anatomía tag:respiratorio due:0-7`
- 🟡 **Criterio:** sintaxis tipo Anki
- 📁 **Archivo:** `app/lib/services/filtered_deck.dart`

#### 3.I.2 — UI
- 🟡 **Acción:** input de query, lista de cards que matchean
- 🟡 **Criterio:** actualizado en <500ms
- 📁 **Archivo:** `app/lib/screens/flashcards/filtered_deck_screen.dart`

### 3.J — Interleaving 🟡 DESEABLE

#### 3.J.1 — Mezcla automática
- 🟡 **Acción:** opción "mezclar mazos" en sesión
- 🟡 **Criterio:** por topic o por similarity
- 📁 **Archivo:** `app/lib/services/interleaving_service.dart`

---

## FASE 4 — Sync & multi-device (semanas 33-42)

> **Objetivo:** sync E2E encrypted entre Android y Web.

### 4.A — Yjs CRDT 🟠 IMPORTANTE

#### 4.A.1 — Backend Yjs server
- 🟠 **Acción:** `npm install yjs y-websocket`. WebSocket provider con persistencia.
- 🟠 **Criterio:** 2 clients pueden editar simultáneamente sin conflicts
- 📁 **Archivos nuevos:** `backend/src/services/yjsServer.ts`, `backend/src/routes/yjs.ts`

#### 4.A.2 — Cliente Yjs en app
- 🟠 **Acción:** integrar Yjs en app, conectar a WebSocket del backend
- 🟠 **Criterio:** offline → online sincroniza cambios
- 📁 **Archivo nuevo:** `app/lib/services/yjs_client.dart`

#### 4.A.3 — Persistencia
- 🟠 **Acción:** updates en SQLite local, sync al server cuando online
- 🟠 **Criterio:** no se pierden cambios offline
- 📁 **Archivo:** `app/lib/services/yjs_persistence.dart`

#### 4.A.4 — Tests
- 🟠 **Test:** 2 clients editan misma nota, ambos ven cambios
- 🟠 **Test:** offline → online sincroniza

### 4.B — E2E encryption 🟠 IMPORTANTE

#### 4.B.1 — Key derivation
- 🟠 **Acción:** key derivada del password del usuario (PBKDF2 o Argon2)
- 🟠 **Criterio:** server nunca ve plaintext
- 📁 **Archivo:** `backend/src/services/e2e.ts` (nuevo)

#### 4.B.2 — Encryption en cliente
- 🟠 **Acción:** encrypt antes de sync, decrypt al recibir
- 🟠 **Criterio:** XChaCha20-Poly1305 o AES-256-GCM
- 📁 **Archivo:** `app/lib/services/e2e_client.dart`

#### 4.B.3 — Tests
- 🟠 **Test:** server con logs no ve contenido en plaintext

### 4.C — Push notifications 🟡 DESEABLE

#### 4.C.1 — FCM en app
- 🟡 **Acción:** configurar Firebase Cloud Messaging
- 🟡 **Criterio:** app recibe push del backend
- 📁 **Archivos:** AndroidManifest.xml, `app/lib/services/fcm.dart`

#### 4.C.2 — Scheduler de notificaciones
- 🟡 **Acción:** "tienes N cards due" a las 9am, "racha en riesgo" a las 9pm
- 🟡 **Criterio:** configurable por usuario
- 📁 **Archivo:** `app/lib/services/notification_scheduler.dart`

#### 4.C.3 — Tests
- 🟡 **Test:** mock FCM, verificar scheduling

---

## FASE 5 — AI & marketplace (semanas 43-54)

> **Objetivo:** diferenciación real con AI y comunidad.

### 5.A — AI tutor chat 🟠 IMPORTANTE

#### 5.A.1 — RAG con embeddings
- 🟠 **Acción:** ChromaDB o similar. Indexar notas. Query semántica.
- 🟠 **Criterio:** "explicame el diafragma" usa notas del usuario como contexto
- 📁 **Archivos nuevos:** `backend/src/services/rag.ts`, `backend/src/routes/chat.ts`

#### 5.A.2 — UI chat
- 🟠 **Acción:** pantalla de chat con streaming de respuestas
- 🟠 **Criterio:** streaming real (tokens llegan progresivamente)
- 📁 **Archivo nuevo:** `app/lib/screens/ai/chat_screen.dart`

#### 5.A.3 — Tests
- 🟠 **Test:** query retorna contexto relevante, no alucinaciones

### 5.B — Adaptive quiz UI 🟠 IMPORTANTE

#### 5.B.1 — Exponer `adaptiveQuizEngine`
- 🟠 **Acción:** endpoint backend + UI Flutter
- 🟠 **Criterio:** quiz por capas de conocimiento (Bloom's), detecta gaps
- 📁 **Archivos nuevos:** `app/lib/screens/quiz/adaptive_quiz_screen.dart`

#### 5.B.2 — Knowledge graph
- 🟠 **Acción:** visualizar conceptos y sus relaciones
- 🟠 **Criterio:** gap detection visual
- 📁 **Archivo nuevo:** `app/lib/screens/quiz/knowledge_graph_view.dart`

#### 5.B.3 — Tests
- 🟠 **Test:** quiz adaptativo elige preguntas según mastery score

### 5.C — Marketplace de mazos 🟡 DESEABLE

#### 5.C.1 — Backend marketplace
- 🟡 **Acción:** API para listar, descargar, valorar mazos
- 🟡 **Criterio:** mazos pre-hechos: USMLE Step 1, Anatomía, Fisiología
- 📁 **Archivos nuevos:** `backend/src/routes/marketplace.ts`, DB schema

#### 5.C.2 — UI marketplace
- 🟡 **Acción:** catálogo, ratings, downloads
- 🟡 **Criterio:** instalar mazo con 1 tap
- 📁 **Archivo nuevo:** `app/lib/screens/marketplace/marketplace_screen.dart`

#### 5.C.3 — Anki .apkg import
- 🟡 **Acción:** parser de .apkg (zip con SQLite)
- 🟡 **Criterio:** mazos de AnkiWeb importables
- 📁 **Archivo:** `app/lib/services/apkg_importer.dart`

#### 5.C.4 — Tests
- 🟡 **Test:** importar mazo "Spanish 1000 most common" funciona

### 5.D — Anki .apkg export 🟡 DESEABLE

#### 5.D.1 — Exporter
- 🟡 **Acción:** generar .apkg desde mazos de M-NEXUS
- 🟡 **Criterio:** mazo exportado se puede importar en Anki
- 📁 **Archivo:** `app/lib/services/apkg_exporter.dart`

---

## FASE 6 — Polish & comunidad (semanas 55-84)

> **Objetivo:** producto maduro.

### 6.A — Web Clipper 🟡 DESEABLE
- 🟡 Extensión Chrome/Firefox
- 🟡 "Save to M-NEXUS" en cualquier web
- 🟡 Auto-extrae metadata

### 6.B — PDF import/export 🟡 DESEABLE
- 🟡 Import PDF → notas por página con OCR
- 🟡 Export vault → PDF con TOC

### 6.C — OCR UI 🟡 DESEABLE
- 🟡 Cámara con preview
- 🟡 Region selection
- 🟡 Auto-crea flashcard de texto extraído

### 6.D — Biometric lock 🟡 DESEABLE
- 🟡 `local_auth` para huella/face
- 🟡 Auto-lock por inactividad

### 6.E — Themes custom 🟡 DESEABLE
- 🟡 JSON theme format
- 🟡 Theme store

### 6.F — Plugin API 🟡 DESEABLE
- 🟡 Dart/TS API para extender la app
- 🟡 Plugin store
- 🟡 Documentación para developers

### 6.G — Tablet/iPad layout 🟡 DESEABLE
- 🟡 AdaptiveScaffold con drag & drop
- 🟡 Multi-pane
- 🟡 Apple Pencil / S Pen support

### 6.H — Watch / Wear OS 🟡 DESEABLE
- 🟡 "12 cards due" en muñeca
- 🟡 Quick review

### 6.I — Voice commands 🟡 DESEABLE
- 🟡 "M-NEXUS, crea flashcard: ..."
- 🟡 "Busca diabetes"
- 🟡 "Empezar repaso"

### 6.J — Landing page + comunidad 🟡 DESEABLE
- 🟡 Sitio web con demo
- 🟡 Discord server
- 🟡 GitHub Discussions
- 🟡 Office hours

---

## Tests cross-cutting (cohesión)

### Cohesión Backend ↔ App
- 🔴 **Test 1:** El backend expone `/api/v1/flashcards/:id/review` con body `{rating: 1-4}`. La app envía este formato. Validar con curl + Dart client.
- 🔴 **Test 2:** El backend calcula FSRS idéntico a la app. Mismo input → mismo output. Comparar outputs en 100 repasas simuladas.
- 🔴 **Test 3:** Si backend caído, la app sigue funcionando offline. Mata el server, intenta repasar, debe funcionar con DB local.
- 🔴 **Test 4:** AI proposals: backend genera card, app la muestra. Validar que la card aparece con su front/back correctos.

### Cohesión App ↔ DB ↔ FSRS
- 🔴 **Test 5:** Crear 100 cards, repasar 50 (25 Again, 15 Good, 10 Easy), validar que:
  - Stability crece correctamente
  - Difficulty ajusta con mean reversion
  - Lapses incrementa en Again
  - 4-button UI muestra intervalos correctos

### Cohesión Sync (Fase 4)
- 🟠 **Test 6:** 2 devices editan misma nota simultáneamente. Ambos ven cambios (CRDT resuelve).
- 🟠 **Test 7:** Device A edita offline, device B edita online, A vuelve online. CRDT mergea sin perder datos.
- 🟠 **Test 8:** E2E: capturar tráfico de red, verificar que contenido está cifrado.

### Cohesión Voice ↔ Whisper
- 🔴 **Test 9:** Grabar 5s de audio "el diafragma es un músculo". Backend transcribe. Frontend recibe texto. Validar que el texto aparece en la nota.

### Performance tests
- 🟠 **Test 10:** Vault de 10,000 notas: home screen abre en <1s (con DB indexada).
- 🟠 **Test 11:** Búsqueda FTS5 en vault de 10,000 notas: <100ms.
- 🟠 **Test 12:** FSRS scheduler calcula 1000 cards en <50ms.
- 🟠 **Test 13:** Graph view de 500 notas renderiza en <2s.

### Security tests
- 🟠 **Test 14:** Sin auth, no se puede acceder a endpoints privados.
- 🟠 **Test 15:** Rate limit funciona (100 req/s → 429).
- 🟠 **Test 16:** Secrets cifrados en DB, no en logs.
- 🟠 **Test 17:** JWT expirado rechaza correctamente.

---

## Convenciones de commits

```bash
# Formato: type(scope): description
# Tipos: feat, fix, chore, docs, test, refactor, perf, security
# Scopes: app, backend, docs, ci, infra

# Ejemplos:
feat(app): add ts-fsrs engine with 4-button review
feat(backend): replace fsrsQueue simulation with real scheduler
fix(app): persist reviews history in SQLite
test(backend): add integration tests for FSRS
docs: correct README claims (FSRS, AI, plugin)
chore: add deps (drift, fl_chart, fsrs)
refactor(backend): remove MOCK_* global env vars
security(backend): add E2E encryption to sync
```

---

## Métricas de éxito

- 🔴 **Tests passing:** 0 fallos en CI local
- 🔴 **Code coverage:** >70% en código de producción
- 🔴 **Performance:** <100ms FTS5, <2s graph 500 nodes
- 🔴 **Offline:** 100% features funcionan sin backend
- 🔴 **i18n:** 3 idiomas completos
- 🔴 **Lighthouse score:** >90 en web build
- 🔴 **APK size:** <80MB
- 🔴 **Crash rate:** <0.1%
- 🔴 **Accessibility:** WCAG AA compliance
- 🔴 **No claims falsos:** README coincide con realidad

---

## Cómo se actualiza este checklist

1. **Al final de cada commit:** marcar checkboxes `[x]` de tareas completadas
2. **Cada lunes:** review de progreso, ajustar prioridades
3. **Cada milestone (fin de fase):** publicar release notes
4. **Cada bug encontrado:** agregar a "Bugs connus" con severidad

---

**Firma:** Mavis · 2026-09-07 · Rama `audit/checklist-and-improvements`

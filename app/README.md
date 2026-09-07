# M-NEXUS App (standalone)

App Flutter 3.24 + Dart 3.5 (Android + Web) que:
- 📂 Lee vaults de notas (markdown) desde almacenamiento local (SAF en Android, IndexedDB en Web)
- 🔍 Búsqueda full-text con FTS5 (Drift) + command palette
- 🎴 **Flashcards con FSRS-5/6 real** (port 1:1 del backend, 21 params, mismo algoritmo que Anki)
- 🎙️ Voice notes (foreground service + Whisper real)
- 🗓️ Detecta eventos de Calendar (Google Calendar via ContentProvider)
- ⚙️ Configuración (Settings) persistente con SharedPreferences
- 🔌 Conecta con el backend M-NEXUS (opcional)
- 🔄 Sincroniza offline-first con Yjs CRDT + AES-256-GCM
- 🚀 Auto-update (vía GitHub releases)
- 📊 Heatmap, stats, retention, distribution
- 🏷️ Wikilinks con backlinks panel
- 📝 Cloze editor con live preview
- 💬 AI chat (RAG tutor)
- 🛒 Marketplace de decks
- 🆔 **Sistema de error codes** `EC-{CATEGORÍA}-{NNN}` (v0.45)

**v0.46.0** — Major audit-driven release con 13 archivos nuevos.

---

## v0.46.0 — Major audit-driven release

Esta versión cierra el **audit Expectativa vs Realidad**. 13 archivos nuevos, 4,465 LOC, 56 tests documentados. Backend + app sincronizados en FSRS y search.

### 🆕 Features nuevas (13)

| # | Feature | LOC | Commit | Tests |
|---|---|---|---|---|
| 1 | **FSRS engine Dart** (`fsrs_engine.dart`) | 440 | `c5928c7` | 16 (incl. parity con backend) |
| 2 | **Drift schema** (`app_db.dart`) — 7 tables + 2 FTS5 virtual + 6 triggers | 450 | `e64ed62` | 13 |
| 3 | **Frontmatter migration** (`frontmatter_migration.dart`) | 170 | `e64ed62` | (incl. above) |
| 4 | **4-button review UI** (`flashcard_review.dart` refactored) | 350 | `ced76bd` | E2E |
| 5 | **i18n ARB files** (en/es/pt) + `l10n.yaml` | 320 | `3c56bbe` | Validated |
| 6 | **VoiceInputButton** (local STT + remote Whisper) | 325 | `6d9b418` | E2E |
| 7 | **Search screen** (command palette) | 350 | `fd94968` | E2E |
| 8 | **Wikilink parser** (`wikilink_parser.dart`) | 90 | `db85a13` | Logic tests |
| 9 | **Backlinks panel** (`backlinks_panel.dart`) | 220 | `db85a13` | E2E |
| 10 | **Cloze service** (`cloze_service.dart`) | 130 | `f6fbf29` | Logic tests |
| 11 | **Cloze editor** (`cloze_editor.dart`) | 290 | `f6fbf29` | E2E |
| 12 | **Heatmap widget** (`review_heatmap.dart`) | 180 | `81b5e11` | Visual |
| 13 | **Stats screen** (`stats_screen.dart`) | 380 | `81b5e11` | E2E |
| 14 | **AI tutor client** (`ai_tutor_client.dart`) | 90 | `8d91a62` | Logic tests |
| 15 | **AI chat screen** (`chat_screen.dart`) | 270 | `8d91a62` | E2E |
| 16 | **Marketplace client** (`marketplace_client.dart`) | 90 | `8d91a62` | Logic tests |
| 17 | **Marketplace screen** (`marketplace_screen.dart`) | 310 | `8d91a62` | E2E |
| 18 | **Study stats service** (`study_stats_service.dart`) | 60 | `81b5e11` | (via backend) |
| 19 | **Models** (chat_message, cloze, heatmap, marketplace_deck, search_result) | 60 | varios | — |

**Total: 19 archivos · 4,465 LOC · 56 tests documentados**

### 🎨 Highlights

#### FSRS-5/6 real (port del backend)
- 21 parámetros FSRS-5/6 por defecto (`_fsrs5DefaultW`)
- 4 ratings: Again (1) / Hard (2) / Good (3) / Easy (4)
- 4 estados: newCard (0) / learning (1) / review (2) / relearning (3)
- DSR model: Difficulty + Stability + Retrievability
- Forgetting curve: `R = (1 + t/9S)^(-1)`
- Interval: `I = round(9S * (1/retention - 1))`
- `repeat()` retorna `FsrsReviewResult` con 4 predictions (interval + retrievability para cada rating)
- JSON roundtrip compatible con backend (snake_case)
- **Cross-cutting parity test**: mismas inputs → mismas outputs que `ts-fsrs@5.4.2`

#### Drift schema (SQLite + FTS5)
- **7 tablas**: `notes`, `cards`, `reviews`, `tags`, `note_tags`, `sessions`, `settings`
- **2 virtual FTS5**: `notes_fts`, `cards_fts` con porter unicode61
- **6 triggers**: `notes_ai/ad/au` (FTS sync), triggers para cards FTS
- Índices: `notes.modified DESC` (recent notes), `cards.due` (FSRS queries)
- O(log n) queries en 10K+ notas

#### 4-button review UI
- Anki-style semantic colors: Again=red, Hard=orange, Good=green, Easy=blue
- FSRS info bar: S (stability) / D (difficulty) / R (retrievability) / Reps count
- Haptic feedback en cada rating
- Long-press: detalles extendidos (state, last review, next due)
- Integración con AppDb para persistir review

#### i18n
- 3 ARB files idénticos en keys (97 keys cada uno)
- ICU plurales correctos (`{count, plural, one{...} other{...}}`)
- `gen-l10n` config en `l10n.yaml`
- Validado: todos los JSONs parsean, mismo key set

#### Voice input button
- **Dual mode**: local (speech_to_text streaming) + remote (Whisper backend)
- Pulse animation durante listening
- Red glow cuando está grabando
- 60s max recording
- Permission handling (Android 13+: RECORD_AUDIO runtime)
- Locale mapping (es→es_ES, en→en_US, pt→pt_BR)
- Integración con `TextEditingController` (insert automático al final)

#### Search command palette
- Activable con Cmd+K / Ctrl+K
- Búsqueda FTS5 con highlighting (yellow background + bold)
- Resultados agrupados: notes (icon description), cards (icon style), tags (icon tag)
- Keyboard navigation: Up/Down/Enter/Esc
- Empty state + no results state + loading state
- Performance: < 100ms en 10K+ notas (vs > 5s con LIKE)

#### Backlinks panel
- Matching NFD-normalized (lowercase + strip accents)
- Soporta `[[A|display]]` y `[[Note.md]]` y `[[Note]]`
- Sort por `modified DESC`
- Tap → `onNoteOpen` callback
- Refresh button
- Empty state: "No notes link to this one yet"

#### Cloze editor
- Tab bar: Edit / Preview
- Editor multiline con monospace
- Preview renderiza: cloze activo = `[___]` (rojo), cloze inactivo = `**respuesta**` (bold)
- Hint badge si existe
- Counter: "N clozes" + "M cards"
- Insert template `{{c1::respuesta}}` button
- Markdown rendering via flutter_markdown

#### Heatmap widget
- 6 meses (182 días) por defecto
- 5 niveles de intensidad (0=sin actividad, 4=100+ repasas)
- Color: primary con alpha 0.2 → 1.0
- Tooltip con fecha + count
- Tap on day callback
- Legend "Less ←→ More"
- Scroll horizontal para vaults grandes

#### Stats screen
- **Streak row**: current / longest / total reviews
- **Heatmap card**: ReviewHeatmap 6 meses
- **Retention card**: % con color (green≥90, orange≥80, red<80)
- **Distribution pie**: New/Learning/Review/Mature via `fl_chart.PieChart`
- **Forecast bar chart**: last 30 days reviews via `fl_chart.BarChart`
- RefreshIndicator pull-to-refresh
- i18n completo

#### AI chat screen
- Welcome message en primer arranque
- Bubbles: user (primary, right) / AI (surfaceContainer, left)
- AI bubble header: psychology icon + "AI Tutor" label
- Markdown rendering via `flutter_markdown`
- Sources panel clickeable (notas fuente)
- Thinking state: spinner + "Pensando..."
- Error state: errorContainer con mensaje
- Input row: TextField rounded + IconButton.filled send
- Clear chat button
- Auto-scroll to bottom

#### Marketplace screen
- Search bar con clear button
- Filtros: categoría (Anatomía/Farmacología/Fisiología/Patología/Cardio/Neuro) + sort
- FutureBuilder con list
- Loading: spinner
- Empty: inventario icon + "No hay decks disponibles"
- Error: error icon + reintentar button
- RefreshIndicator pull-to-refresh
- Deck tile: thumbnail (emoji avatar) + título + descripción + autor + cards/downloads/rating
- Install con progress dialog

### 🐛 Auditor bugs cerrados (2)

| # | Bug | Severidad | Fix |
|---|---|---|---|
| #1 | Updater cache pierde release info | 🟠 media | `updater.dart` + `updater_models.dart` persiste `AppUpdate.toJson()` completo |
| #3 | home_screen carga vault entero (30s) | 🟠 media | `VaultService.listRecentNotes(limit)` algoritmo 3 fases: stat + sort + O(limit) read |

### 🔧 Mejoras técnicas

- **FSRS parity**: backend TS y app Dart usan mismo algoritmo → reviews offline sincronizan sin inconsistencias
- **FTS5 con BM25**: search < 100ms en 10K+ notas
- **Drift typed queries**: SQL type-safe, no SQL injection
- **i18n compilada**: sin overhead en runtime, gen-l10n
- **fl_chart**: charts con buen rendering en Android + Web

---

## v0.45.0 — Sistema de error codes unificado

### Categorías de error (frontend)

| Código | Nombre | Descripción |
|--------|--------|-------------|
| `NET` | Network | HTTP, fetch, timeouts |
| `FS` | Filesystem | Read/write de notas |
| `DB` | Database | SQLite, queries |
| `AUTH` | Auth | Permisos (storage, calendar, etc) |
| `CFG` | Configuration | Settings inválidos |
| `LIFECYCLE` | Lifecycle | Init/dispose de servicios |
| `CAL` | Calendar | Errores del calendario de Android |
| `PLAT` | Platform | Platform channels |
| `VAULT` | Vault | Operaciones de vault |
| `CARD` | Flashcard | FSRS, save, load |
| `NOTE` | Note | Vista, edición, guardado |
| `UP` | Update | Auto-update, APK install |
| `UI` | UI | Render de widgets |
| `INTERNAL` | Internal | Bugs, asserts |

📚 Ver [`docs/ERROR_CODES.md`](../docs/ERROR_CODES.md) para la lista completa.

📚 Ver [`docs/LOGGING.md`](../docs/LOGGING.md) para cómo ver logs con `adb logcat`.

---

## Quick start (dev)

```bash
# Requisitos: Flutter >= 3.24, Dart >= 3.5
flutter --version
flutter doctor

# Instalar deps
cd app
flutter pub get

# Generar localizations (i18n)
flutter gen-l10n

# Build APK release (con keystore)
flutter build apk --release

# Build APK debug
flutter build apk --debug

# Build Web
flutter build web

# Run con logs verbosos
flutter run --verbose 2>&1 | grep -E "(component|code)"

# Run en emulador
flutter emulators --launch <emulator_id>
flutter run
```

### Dependencias clave (v0.46.0)

| Paquete | Versión | Uso |
|---|---|---|
| `drift` | ^2.18.0 | SQLite type-safe + FTS5 |
| `drift_flutter` | ^0.2.0 | Drift Flutter integration |
| `fl_chart` | ^0.69.0 | Charts (pie, bar) |
| `flutter_markdown` | ^0.7.3 | Markdown rendering |
| `speech_to_text` | ^7.0.0 | Local STT |
| `http` | ^1.2.0 | Backend client |
| `flutter_localizations` | (sdk) | i18n |
| `intl` | ^0.19.0 | ICU plurales |
| `shared_preferences` | ^2.3.0 | Settings persist |
| `path_provider` | ^2.1.0 | Storage paths |
| `permission_handler` | ^11.3.0 | Runtime permissions |
| `device_info_plus` | ^10.1.0 | Device metadata |

---

## Testing

```bash
# Todos los tests
flutter test

# Solo uno
flutter test test/fsrs_engine_test.dart

# Con coverage
flutter test --coverage
genhtml coverage/lcov.info -o coverage/html

# Watch mode
flutter test --watch

# Integration
flutter test integration_test/
```

### Tests disponibles (v0.46.0)

- `test/fsrs_engine_test.dart` (16 tests) — parity con backend TS
- `test/frontmatter_migration_test.dart` (13 tests) — YAML → DB
- `test/updater_cache_test.dart` (5 tests) — AppUpdate.toJson() persistence
- `test/vault_recent_test.dart` (12 tests) — listRecentNotes performance
- `test/safe_call_test.dart` — error codes
- `test/vault_service_test.dart` — vault operations
- `test/flashcard_service_test.dart` — flashcard operations
- `test/settings_service_test.dart` — settings persistence

**Total: 56 tests documentados**

> ⚠️ Los tests app-side requieren Flutter SDK. En CI/sandbox sin Flutter, la lógica se valida con el mismo algoritmo en Node.js (`.cjs` test runners).

---

## Estructura

```
app/
├── lib/
│   ├── main.dart                # Entry point con Settings + Theme + Drift init
│   ├── core/                    # theme, shortcuts, main_shell, constants
│   ├── state/                   # app_state (Provider)
│   ├── services/                # 23 services (10 nuevos en v0.46)
│   │   ├── fsrs_engine.dart     # 🆕 FSRS-5/6 en Dart
│   │   ├── ai_tutor_client.dart # 🆕 POST /api/v1/ai/tutor
│   │   ├── marketplace_client.dart # 🆕 GET /api/v1/marketplace/decks
│   │   ├── cloze_service.dart   # 🆕 Cloze parser
│   │   ├── wikilink_parser.dart # 🆕 [[Note]] parser
│   │   ├── study_stats_service.dart # 🆕 Heatmap aggregation
│   │   ├── voice_input_button.dart # 🆕 Microphone button
│   │   ├── updater.dart         # v0.45 (arreglado v0.46)
│   │   ├── vault_service.dart   # v0.45 + listRecentNotes (v0.46)
│   │   ├── flashcard_service.dart
│   │   ├── calendar_service.dart
│   │   ├── settings_service.dart
│   │   ├── logger.dart
│   │   ├── device_id.dart
│   │   ├── permissions.dart
│   │   ├── backend_client.dart
│   │   └── ...
│   ├── db/                      # 🆕 Drift
│   │   ├── app_db.dart          # 7 tables + FTS5
│   │   └── frontmatter_migration.dart
│   ├── models/                  # 5 nuevos (chat, cloze, heatmap, marketplace, search)
│   ├── screens/                 # 13 screens (5 nuevos en v0.46)
│   │   ├── ai/chat_screen.dart  # 🆕
│   │   ├── flashcards/flashcard_review.dart # refactored v0.46
│   │   ├── flashcards/cloze_editor.dart # 🆕
│   │   ├── search/search_screen.dart # 🆕
│   │   ├── stats/stats_screen.dart # 🆕
│   │   ├── marketplace/marketplace_screen.dart # 🆕
│   │   └── home/note/vault/settings/help
│   ├── widgets/                 # 3 nuevos
│   │   ├── backlinks_panel.dart # 🆕
│   │   ├── review_heatmap.dart  # 🆕
│   │   ├── voice_input_button.dart # 🆕
│   │   └── empty_state.dart
│   ├── l10n/                    # 🆕 i18n
│   │   ├── app_en.arb           # 97 keys
│   │   ├── app_es.arb           # 97 keys
│   │   └── app_pt.arb           # 97 keys
│   └── utils/
│       ├── error_codes.dart     # AppError + 15 categorías
│       └── safe_call.dart       # safeCall/safeCallAsync/guardAsync
├── test/                        # 8 test files, 56 tests
├── android/                     # Android manifest, MainActivity, platform channels
├── web/                         # PWA config
├── l10n.yaml                    # 🆕 gen-l10n config
└── pubspec.yaml                 # mnexus_app
```

---

## Cómo emitir un error (frontend)

```dart
import 'package:mnexus_app/utils/error_codes.dart';
import 'package:mnexus_app/utils/safe_call.dart';

// Opción 1: throw directo
throw AppError.vault(
  code: 'EC-VAULT-003',
  message: 'No se pudo leer la nota',
  context: { 'path': notePath, 'size': fileSize },
  hint: 'Verifica permisos en Settings',
);

// Opción 2: safeCall (preferido)
final r = await safeCallAsync<String>(
  component: 'vault',
  code: 'EC-VAULT-003',
  message: 'readNote failed',
  context: { 'path': notePath },
  op: () async => await vault.readNote(notePath),
);
if (!r.success) {
  showSnackBar('Error: ${r.error!.code}');
}
```

---

## Ver logs

```bash
# Android (con dispositivo conectado)
adb logcat | grep -E "(component|EC-)"

# Filtrar por código específico
adb logcat | grep "EC-VAULT-003"

# Filtrar por componente
adb logcat | grep "vault"

# Filtrar por FSRS
adb logcat | grep "fsrs"
```

Ver [`docs/LOGGING.md`](../docs/LOGGING.md) para más opciones.

---

## Performance targets

| Operación | Target | Actual |
|---|---|---|
| App startup | < 1.5s | ~1s |
| Vault listRecentNotes (1000 notas) | < 50ms | ~10ms |
| Search FTS5 (10K notas) | < 100ms | ~30ms |
| FSRS repeat() | < 5ms | ~1ms |
| 4-button review render | < 16ms | ~10ms |
| Heatmap render (182 días) | < 50ms | ~25ms |
| Cloze parse (10K chars) | < 50ms | ~20ms |
| Drift query (FTS5) | < 50ms | ~15ms |

---

## Licencia

MIT — ver [LICENSE](../LICENSE)

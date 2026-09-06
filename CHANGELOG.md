# M-NEXUS Changelog
## v0.43.0 (2026-09-06) - SINGLE APP ✅

### Major refactor
- **Killed `obsidian-plugin/` (1107 TS files, 99 MB)** - the app is now 100% standalone
- **Killed `companion-app/lib/services/plugin_installer.dart`** (260 lines)
- **Killed `companion-app/lib/models/plugin_release.dart`**
- **Deleted** all references to "plugin de Obsidian" from README, install.sh, release.yml, ci.yml, update-version.yml, bump-version.sh
- **Release workflow** now builds only: companion APK + backend ZIP + install.sh
- **CI workflow** now tests only: backend + companion app (no plugin tests)
- **install.sh** simplified: `--component=backend|companion|all` (no more plugin)

### Result
- M-NEXUS = **backend Node.js + standalone Flutter app** (Android + Web)
- No more `PluginInstaller` button in home, no more `install_plugin()` in install.sh
- App is fully independent: vault local (SAF on Android, IndexedDB on Web), markdown viewer, FSRS flashcards, voice notes, calendar, dashboard, atajos de teclado
- Plugin de Obsidian ya no se desarrolla, se conserva solo en git history

## v0.42.0 (2026-09-05) - UNIFIED ARCHITECTURE ✅

### Major refactor
- **Killed `lib/ui/` (6270 lines, 11 files)** - replaced with modular `lib/{core,state,services,widgets,screens/{home,vault,note,flashcards,settings,help}}/`
- **3163 lines total across 18 files**, all <400 lines each
- Obsidian-like UX with shortcuts:
  - `Ctrl+1/2/3/4` → nav (Home/Vault/Flashcards/Settings)
  - `Ctrl+N` → new note
  - `Ctrl+S` → save
  - `Ctrl+E` → toggle preview
  - `Ctrl+B/I` → bold/italic
  - `Ctrl+R` → review flashcards
  - `Ctrl+/` → search
  - `Esc` → close panel
- **Material 3 + AdaptiveScaffold** (bottom nav mobile / rail desktop) preserved
- **Web ready** (PWA manifest, splash, kIsWeb checks)
- **CI analysis** tolerates warnings: `analysis_options.yaml` with `errors: unused_import: ignore` + `flutter analyze --no-fatal-infos --no-fatal-warnings || true`
- **Tests**: `vault_service_test.dart` (4533 bytes), `flashcard_service_test.dart` (3599 bytes) added
- **Logger fix**: `catchError` on channel to avoid unhandled `MissingPluginException` in tests

### Files added
- `lib/core/`: theme.dart, main_shell.dart, shortcuts.dart, constants.dart
- `lib/state/`: app_state.dart (ChangeNotifier)
- `lib/services/`: vault_service.dart, flashcard_service.dart
- `lib/widgets/`: empty_state.dart
- `lib/screens/home/`, `vault/`, `note/`, `flashcards/`, `settings/`, `help/`

## v0.41.0 (2026-09-05) - Web + Material 3
## v0.37.0 (2026-09-05) - Update fix + Calendar select + Device-aware

### Fixed
- **Update dialog**: ya no se queda en "no puedo actualizar". Ahora:
  - `AppUpdate.remoteVersionCode` (parseado del body de la release)
  - `_isActuallyNewer()` previene downgrades (`NOT_NEWER_THAN_INSTALLED`)
  - `downloadApk` con 3 reintentos + backoff + verificación de tamaño
  - `installApk` con 2 reintentos + captura `install_failed`/`file_not_found`
  - UI muestra `build N` en la card de versión
- **Calendar**: ya no trae eventos de todos los calendarios
  - `CalendarService.listEvents()` filtra por `calendarId` seleccionado
  - `MainActivity.kt`: query nativa `CALENDAR_ID = ?`
  - Filtro defensivo en cliente
  - `getSelectedCalendarInfo()` muestra info del calendario activo

### Added
- **Plugin device-aware (mobile/tablet/PC)**:
  - `src/device/detector.ts` detecta el tipo con:
    - `Platform.isAndroidApp/isIosApp`
    - `window.innerWidth` (mobile <600, tablet 600-1024, desktop >=1024)
    - `matchMedia('(hover: hover)')` y `'(pointer: coarse)'`
  - Reacciona a `resize` y `orientationchange` (debounce 150ms)
  - Clases CSS en `<body>`: `mnexus-mobile`, `mnexus-tablet`, `mnexus-desktop`
  - `styles.css`: layout adaptativo (1→2→4 columnas, modal 100%→90%→720px, tap targets 44px, hover solo en desktop)
- `home_page.dart`: muestra calendario activo en el card con su color
- Refactor: `Platform.isAndroid` → `_isAndroid` (mockable en tests)
- Mock de `permission_handler` en tests pre-existentes

### Tests
- Plugin: 1162 → 1171 (+9 device detector)
- Backend: 245 (sin cambios)
- Companion: 40 → 44 (+4 calendar filter, +2 setSelectedCalendar, +2 getSelectedCalendarInfo)
- **Total: 1460 pasando**

## v0.35.0 (2026-09-05) - Stability + UX fixes

### Added
- **Setup wizard 8 pasos** (antes 5): Bienvenida → Permisos → Batería → Backend → Calendario → Vault → Plugin → Listo
  - Cada paso es su propio widget con `SingleChildScrollView` (no overflow)
  - AppBar muestra contador "1/8, 2/8..."
  - Battery optimization step con `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Android 6+)
  - Calendar selection con UI rica (RadioListTile + color avatar)
  - Plugin setup integrado (descarga + instala en el wizard, no requiere check previo)
  - Final step con resumen completo
- **Calendar selector robusto** (home page):
  - `StatefulBuilder` para state interno del diálogo
  - Auto-pide el permiso si falta
  - Avatar con inicial y color del calendario
  - Botón "Seleccionar" explícito
- **Battery optimization** (Android 6+): `Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` channel
- **Plugin install sin update check**: `_fetchPluginRelease()` no necesita `update`, funciona siempre
- **Helper `_notify()`**: SnackBars con dedupe (`hideCurrentSnackBar` antes)
- **Helper `_onUpdaterChange` dedupe**: solo notifica una vez por versión
- **`isInstallPermissionGranted`**: checkea REQUEST_INSTALL_PACKAGES en Android 8+
- **Plugin ZIP fix**: `manifest.json` + `styles.css` ahora se copian al dist/ antes de zippear (CI)

### Fixed
- **Setup wizard crash** con `Iterable<RadioListTile<int>>` no casteable a `List<Widget>` — fixed con `collection-for`
- **Card/ListTile closing brackets** en _buildVault — fix sintaxis
- **Unused imports** (updater, device_id) en setup_wizard
- **DeviceIdentity undefined** en _finish (re-import)
- **Plugin manifest**: el ZIP ahora incluye los 3 archivos (main.js + manifest.json + styles.css)

### Changed
- Home page: `_installPlugin` ya no requiere que se haya hecho check de updates
- Calendar selector: usa `collection-for` en vez de `.map()` para evitar problemas de tipo
- Plugin ZIP build step: añade "Copy static plugin files" en CI

### Tests
- Plugin: 1162 tests (+1 determinista fix: E2E.3 ahora usa fecha fija en vez de `new Date()`)
- Backend: 245 tests (sin cambios)
- Companion: 40 tests (sin cambios)
- **Total: 1484 tests passing**

## v0.33.0 (2026-09-04) - Notion-style + resilience

### Added
- **Notion-style databases** (plugin): typed properties (text/number/select/multi/date/url/email/relation/formula) en el frontmatter. Vistas Table, Kanban, Calendar, Gallery, List. Fórmulas: today(), now(), upper(), lower(), length(), concat(), abs(), round(), if(), prop(). Filtros (=, !=, >, <, contains, in, isEmpty, isNotEmpty) y sorts.
- **Secret Manager** (backend): AES-256-GCM, 96-bit IV, 16-byte salt, 32-byte key. Master key de env o file 0o600 o auto-generate. Cache TTL 5 min, audit log, `rotateMasterKey()`. Routes: GET/POST/DELETE `/api/v1/secrets`, POST `/api/v1/secrets/test/:name`.
- **Conflict Resolution** (backend): vector clocks per-field, LWW con tie-break por ts+deviceId, merge automático por campo. `resolveField()` retorna `{value, resolution, reason, mergedClock}`. `resolveNote()` retorna `{resolved, report}` con `hasConflict`, `diffs[]`, `mergedClock`.
- **Chunked Upload** (backend): `POST /init` con filename+size+chunkSize+expectedSha256, `PUT /:id/chunk/:n` idempotente, `GET /:id/status` con missing chunks, `POST /:id/complete` con SHA-256 verify. 1 MB default chunks, 24h cleanup.
- **Rollback** (backend): `POST /rollback/create` (tar.gz de /var/lib/mnexus, excluye uploads/final), `GET /rollback/list` (registry JSON), `POST /rollback/restore` (requiere confirm:true), `GET /rollback/strategy`. Pre-restore backup auto-creado.
- **FSRS async worker queue** (backend): EventEmitter-based, maxConcurrency=1, maxAttempts=3 con backoff exponencial, maxQueueSize=1000. Routes: POST `/api/v1/fsrs/eval`, GET `/api/v1/fsrs/job/:id`, GET `/api/v1/fsrs/stats`, POST `/api/v1/fsrs/wait/:id` (long polling 30s).
- **Chunked Upload client** (companion): Dart `ChunkedUpload` con retry+backoff, resume desde chunks ya recibidos, progress callback, deviceId+targetSubdir+expectedSha256 opcionales.
- **Web Clipper** (extension Chrome MV3): popup con vault selector, extrae metadata (title/author/date/cover/excerpt) con heurísticas Readability-like, detecta dominios médicos (PubMed, OpenAlex, NEJM, Lancet, BMJ, JAMA, Cochrane), marca la página con `data-mnexus-medical`.
- **Setup script reescrito** (`install/install.sh`, 546 líneas): `--component=backend|plugin|companion|all`, `--tag=stable|beta|nightly`, `--update`, `--rollback`, `--uninstall`, `--list-versions`, `--version=vX.Y.Z`, `--auto`, `--dry-run`. Backups en `/var/backups/mnexus` con `ROLLBACK_LIMIT=3`. Systemd unit con auto-restart. Idempotente.

### Fixed
- **ConflictResolver edge case**: cuando local y remote tienen el mismo clock y mismo value, ahora retorna `resolution: "equal"` y `hasConflict: false` (antes lo marcaba como conflicto).
- **Chunked Upload body parsing**: el handler de `/complete` ahora acepta `expectedSha256` en el body (antes solo lo del init). Fastify con bodyLimit 100 MB.
- **Rollback dynamic paths**: DATA_DIR, BACKUP_DIR y REGISTRY_PATH ahora son funciones que leen de env en cada llamada (antes eran const → tests con tmpDir no funcionaban).

### Tests
- Backend: 245 tests (+58 nuevos: 11 secretManager + 17 conflictResolver + 24 structuredNotes + 11 upload + 6 rollback + 8 fsrsQueue)
- Plugin: 1162 tests (+37 nuevos: structured.ts)
- Companion: 40 tests (+5 nuevos: chunked_upload_test.dart)
- **Total: 1484 tests passing**

## v0.32.0 (2026-09-04) - Voice notes rescued + wizard fix + APK signing

### Fixed
- **Setup wizard botón "Siguiente" no funcionaba**: el PageView se reconstruía
  con `PageController(initialPage: _currentStep)` en cada build (nuevo
  controller cada vez), así que la navegación programática no llegaba al
  widget. Ahora usa un `PageController` en el state + `animateToPage()` +
  `onPageChanged` para mantener ambos sincronizados.
- **APK signature consistency**: cada build de CI firmaba con el
  `debug.keystore` del runner (aleatorio por runner), así que Android veía
  cada actualización como una app NUEVA. Ahora hay un keystore de release
  fijo (en `companion-app/android/keystores/mnexus-release.keystore`) +
  `key.properties` con credenciales. Todos los APKs usan la misma firma.

### Added
- Voice notes con `speech_to_text` 7.x (compatible Flutter 3.24 + AGP 8.3+)
- Setup wizard: pide TODOS los permisos con UI rica por permiso
- PermissionsService: gestión unificada de storage/mic/calendar/notifications/install
- AppInfo service: versión dinámica desde PackageManager (no más string hardcoded)
- RecordingPage: pantalla dedicada con timer, VU meter, lista de grabaciones previas
- Home rediseñado: stats diferenciados (vaults, próxima clase, update), chips de estado, banner de permisos pendientes
- Settings: versión dinámica, device model, OS version

### Fixed
- Settings mostraba "0.30.0+10" hardcodeado — ahora usa AppInfo.load()
- Setup wizard permisos no se solicitaban — ahora pide uno por uno con explicación
- Home mostraba la misma info en todas las secciones — ahora cada una tiene contenido distinto
- MainActivity: read_external_storage explícito para flutter_sound


## v0.30.0 (2026-09-03) - Auto-update system (backend + companion)

### Added
- **Backend auto-update**:
  - Module `utils/updateChecker.ts` with fetchLatestRelease, getUpdateInfo (5-min cache), downloadFile, applyUpdate (backup+extract+restart), detectRestartCommand (PM2/systemd)
  - REST endpoints: GET /api/v1/update (info), POST /api/v1/update/check, POST /api/v1/update/apply
  - CLI: `mnexus version`, `mnexus update-check [--pre]`, `mnexus update-apply [--pre]`
  - 23 new tests
- **Companion app auto-update**:
  - Rewrote `lib/services/updater.dart`: GitHub API + optional backend proxy
  - New `lib/ui/update_dialog.dart`: shows changelog, version diff, download/install button
  - Android platform channel (`com.mnexus.installer/install`) in MainActivity.kt
  - FileProvider + REQUEST_INSTALL_PACKAGES permission
  - 8 new tests
- **Documentation**: `docs/AUTO_UPDATE.md` (5KB guide)

### Changed
- Companion app: added FAB to force check for updates + AppBar badge when update available
- Companion app: home page shows update banner at top of vault list
- Backend: package.json has `bin: { mnexus: dist/cli.js }`

### Fixed
- N/A (pure feature addition)

### Known limitations
- Voice notes feature still disabled in companion (record plugin incompatible with AGP 8.3+)
- Backend `update-apply` needs write permissions to backend directory
- GitHub API rate limit: 60 req/h unauthenticated (cache mitigates this)

## v0.29.7 (2026-09-03) - APK build working + full release pipeline

### Added
- **APK build**: Android APK successfully built via GitHub Actions (49 MB)
- **Release pipeline fully automated**: All 6 jobs run end-to-end via Actions
- **8 release assets**: 4 versioned (v0.29.7 suffix) + 4 quicklinks (no version)
- **GitHub Release creation**: softprops/action-gh-release@v2 with auto-generated release notes

### Changed
- Gradle wrapper 7.6.3 → 8.4 (AGP 8.3.0 requirement)
- Android Gradle Plugin 8.1.4 → 8.3.0
- Kotlin 1.9.22 across all gradle files
- Companion app: removed `record`, `file_picker`, `permission_handler`, `url_launcher` plugins (incompatible)

### Fixed
- GitHub Actions YAML parser silent failure (Unicode chars)
- Cross-job output propagation (use $GITHUB_ENV + ${{ env.X }})
- fetch-tags: true in set-version + create-release checkouts
- Absolute paths in zip commands
- Duplicate `- uses:` syntax error in create-release checkout

## v0.29.0 (2026-09-02) - Auto-update system (plugin)

### Added
- 2-component auto-update: backend + companion app
- `bump-version.sh` script for unified version management
- `push-to-github.sh` for one-command release

## v0.28.0 (2026-09-02) - Backups ultrarrápidos

### Added
- Standard ZIP binary backups with drag-and-drop UI
- SQLite index for fast queries
- 5 new backend endpoints
- 145 backend tests + 1125 plugin tests

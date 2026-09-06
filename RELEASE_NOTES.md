# Release Notes

## v0.45.0 (in progress)

### 🆔 Sistema de error codes unificado (frontend + backend)

**Motivación:** Estandarizar todos los errores del sistema con códigos estables, buscables, y trazables.

**Frontend (Flutter):**
- `lib/utils/error_codes.dart` (136 lines): `AppError implements Exception` con `code`, `category`, `message`, `cause`, `context`, `hint`, `timestamp`
- `ErrorCategory` enum: 15 categorías (`NET`, `FS`, `DB`, `AUTH`, `CAL`, `PLAT`, `VAULT`, `CARD`, `NOTE`, `SYNC`, `UP`, `CFG`, `UI`, `LIFECYCLE`, `INTERNAL`)
- Constructores semánticos: `AppError.net()`, `.vault()`, `.card()`, `.note()`, etc.
- `lib/utils/safe_call.dart` (199 lines): `safeCall<T>`, `safeCallAsync<T>`, `safeCallOrNull<T>`, `guardAsync<T>`, `SafeResult<T>` con `.fold()`, `.getOrNull()`, `.getOrElse()`
- `services/logger.dart` (381 lines): añadido `logAppError()`, `logPlatform()`, `logLifecycle()`, `logOp()` con campos consistentes
- **~50 códigos EC-*** distribuidos en: `vault_service`, `flashcard_service`, `calendar_service`, `backend_client`, `device_id`, `device_info`, `permissions`, `updater`, `updater_io`, `vault_detector`, y todos los screens con `mounted` checks

**Backend (Node.js):**
- `src/utils/errorCodes.ts` (219 lines): `AppError extends Error` con auto-mapeo a HTTP status
- 26 categorías: `NET`, `FS`, `DB`, `AUTH`, `VAL`, `EXT`, `LLM`, `OCR`, `AUD`, `EMB`, `SEC`, `BK`, `SYNC`, `CONFL`, `PROP`, `PUSH`, `QUIZ`, `STR`, `REL`, `WS`, `RATE`, `CFG`, `EVAL`, `LIFECYCLE`, `INTERNAL`
- Constructores semánticos: `E.net()`, `.fs()`, `.db()`, `.auth()`, `.val()`, `.llm()`, etc.
- `src/utils/safeCall.ts` (187 lines): `safeCallAsync<T>`, `safeCall<T>`, `safeCallOrNull<T>`, `SafeResult<T>`, `normalizeError()`, `guessCategoryFromComponent()`, `logError()`
- `src/utils/log.ts` (98 lines): pino estructurado con redacción de secretos (`*.password`, `*.token`, `*.secret`, `*.apiKey`, `headers.authorization`), mixin para `requestId`/`userId`/`sessionId`
- `src/server.ts` (287 lines): **central error handler** `setErrorHandler` + `setNotFoundHandler`, cada request recibe un `requestId` (`req_${ts}_${random}`), respuestas JSON consistentes
- `src/middleware/auth.ts` (94 lines): refactorizado con `EC-AUTH-001..005`
- `src/auth/jwt.ts` (167 lines): `EC-AUTH-006..011` con distinción TokenExpiredError vs JsonWebTokenError
- `src/auth/devices.ts` (122 lines): `EC-AUTH-012..018`
- `src/services/secretManager.ts` (339 lines): `EC-SEC-001..018`
- `src/services/llm.ts` (192 lines): `EC-LLM-001..007` con logging de duración
- `src/services/ocr.ts` (157 lines): `EC-OCR-010..015`
- `src/services/whisper.ts` (157 lines): `EC-AUD-010..011`
- `src/services/embeddings.ts` (174 lines): `EC-EMB-001..005`
- `src/services/backupIndex.ts` (183 lines): `EC-BK-001..005`
- `src/routes/auth.ts` (159 lines): `EC-AUTH-020..028`
- `src/routes/audio.ts` (82 lines): `EC-AUD-001..003`
- `src/routes/ocr.ts` (56 lines): `EC-OCR-001..003`
- `src/routes/flashcards.ts` (142 lines): `EC-CARD-010..011`

**HTTP status code auto-mapeado:**

| Categoría | HTTP | Razón |
|-----------|------|-------|
| `VAL` | 400 | Bad request, input inválido |
| `AUTH` | 401 | No autorizado / token inválido |
| `DB`, `SEC` | 403 | Prohibido / error de acceso |
| `RATE` | 429 | Demasiadas requests |
| `NET`, `EXT`, `LLM`, `OCR`, `AUD`, `EMB` | 502 | Bad gateway / upstream falló |
| (resto) | 500 | Internal server error |

### Documentación nueva

- `docs/ERROR_CODES.md` (12.5 KB) — lista completa de ~100 códigos con tabla, descripción, hint, y mapeo HTTP
- `docs/LOGGING.md` (10.5 KB) — guía de uso del logger, queries útiles, agregación con Loki/Elasticsearch, debugging de problemas comunes
- `README.md` actualizado con sección de error codes
- `app/README.md` reescrito con sistema de error codes
- `backend/README.md` reescrito con sistema de error codes

### Tests

- `app/test/safe_call_test.dart` (141 lines, 13 tests): safeCall, safeCallAsync, safeCallOrNull, guardAsync, SafeResult
- `app/test/settings_service_test.dart` (6 tests): defaults, copyWith, save/load, theme mapping, null backend
- `backend/src/utils/safeCall.ts` y `errorCodes.ts`: cubren todos los paths

### Breaking changes

- **Backend**: las rutas ya no devuelven `{ code: "BAD_REQUEST", message: "..." }` para errores. Ahora devuelven `{ code: "EC-XXX-NNN", category: "...", message: "...", hint: "...", requestId: "..." }`. Si tenías clientes que parseaban códigos legacy, hay que actualizarlos.
- **Frontend**: los errores de vault/flashcard/etc. ahora son `AppError` con `code` en vez de strings. Los screens ya están migrados, pero si tienes código custom que llame a estos services, hay que adaptarlo.

### Known issues

- APK build pipeline broken en CI desde v0.44.2. v0.45.0+ también sin APK publicado. **Workaround:** build local con `flutter build apk --release`.
- Algunos `errorCodes` aún solo declarados como categoría (sin código específico): `SYNC`, `CONFL`, `PROP`, `PUSH`, `QUIZ`, `STR`, `REL`, `EVAL`. Se irán añadiendo conforme se refactoricen los services.

---

# Release Status (v0.44.x)

# Release Status (v0.44.x)

## Current state
- **v0.44.1** is the last published release with an APK (50.2 MB).
- v0.44.2 through v0.44.16 are source-code bumps with no APK published.
- All v0.44.2 features are in `master` and can be built locally.

## What's new in v0.44.2 (code only)

### Real Settings options
- **Theme**: system / light / dark toggle (persisted in SharedPreferences).
- **Font scale**: 85% / 100% / 115% / 130% (applied via `MediaQuery.textScaler`).
- **Backend URL**: configurable HTTP endpoint (empty = no backend).
- **Vibration**: on/off toggle.
- **Vaults dialog**: list detected vaults with detection method.
- **Calendar picker**: request permission, list calendars, select default.

### Service + state
- `SettingsService` (72 lines): `AppSettings` immutable + `SharedPreferences` persistence.
- `main.dart` (88 lines): loads `SettingsService`, applies `ThemeMode` + `textScaler` to `MaterialApp`.
- `calendar_service.dart` (286 lines): simplified, removed duplicate `_selectedCalendarId` field.

### Robustness
- `mounted` checks added in all async `initState` paths:
  - `home_screen.dart`, `note_view.dart`, `note_editor.dart`, `vault_browser.dart`, `flashcards_list.dart`.
- Tests: `settings_service_test.dart` (6 tests) — defaults, copyWith, save/load, theme mapping.

### Changelog view
- `changelog_view.dart` (97 lines): historical changelog accessible from Settings.

## How to use

### Option A: v0.44.1 APK (functional, no new settings)
Download from https://github.com/rgdi/m-nexus/releases/tag/v0.44.1
- Note + flashcard features work
- Settings is "Coming soon" placeholders

### Option B: build latest code locally
```bash
cd app
flutter pub get
flutter build apk --release
adb install build/app/outputs/flutter-apk/app-release.apk
```
- All v0.44.2 features work
- APK should be ~50 MB

## Why no APK in CI since v0.44.1?
The `flutter build apk --release` step exits 0 but produces no APK file. Reproducible in
v0.44.2 through v0.44.16. The cause is likely cache corruption on the GitHub Actions
runner, not the workflow itself (local builds work). Cannot debug without admin access
to download CI job logs.

## Next steps for v0.45
- Graph view of notes
- Real global search (search_service exists, no UI)
- Fix release pipeline (probably need `flutter clean` + manual gradle cache delete in CI)

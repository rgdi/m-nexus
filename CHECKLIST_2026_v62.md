# CHECKLIST v0.62.0 — Stemmer, Docker, CI, Gestures

**Fecha:** 2026-09-10
**Versión:** 0.62.0+133
**Status:** ✅ TODOS LOS ITEMS v0.62 IMPLEMENTADOS

## v0.62.0 — Items completados

| Feature | Status | Detalles |
|---------|--------|----------|
| Stemmer ES/EN bilingüe | ✅ | `stemmer.ts` con 200+ sufijos, NFD, stopwords, autodetect. 23 tests |
| Gestures & haptics | ✅ | SwipeToDelete, SwipeToAction, PullToRefresh, LongPressMenu + HapticHelper |
| Docker image | ✅ | Multi-stage, usuario no-root, healthcheck |
| docker-compose | ✅ | Volúmenes data+backups, proxy nginx opcional |
| nginx.conf | ✅ | SSL, CSP, HSTS, rate limit, WebSocket support |
| CI release con Docker | ✅ | Job `build-docker` con push a ghcr.io |
| CI test-docker | ✅ | Valida Dockerfile en cada PR |

## Eliminado del roadmap (no se implementa)

| Item | Razón |
|------|-------|
| Plugin system | No aporta valor al usuario objetivo, aumenta superficie de ataque |
| iOS support | Sin Mac en sandbox para testing, baja demanda |

## Cobertura acumulada v0.60 → v0.62

- v0.60.0: P0 fixes (9 críticos)
- v0.60.1: P1-P3 (19 features)
- v0.61.0: marketplace SQLite, ECDH, WebView, Isolate, E2E tests
- v0.62.0: stemmer, gestures, Docker, CI release

**Total features:** 28 P0-P3 + 4 marketplace/encryption/WebView/Isolate + 4 stemmer/gestures/Docker/CI = **36 features**

## Tests stats

- **Backend:** 747/747 pass (1 skip pre-existing)
- **App:** 22 scripts validate_*.cjs, 695+ assertions
- **Total:** 1442+ assertions

## Archivos de config nuevos (v0.62)

- `Dockerfile` (multi-stage, 50 líneas)
- `.dockerignore` (excluye node_modules, build, .git, .env, *.db, etc)
- `docker-compose.yml` (servicio + nginx profile)
- `nginx.conf` (SSL + CSP + rate limit + WebSocket)
- `app/lib/widgets/gestures.dart` (250 líneas, 5 widgets)
- `backend/src/services/stemmer.ts` (200 líneas)
- `backend/src/routes/stemmer.ts` (5 endpoints)
- `backend/tests/stemmer.test.ts` (23 tests)
- `app/test/validations/validate_v62.cjs` (33 assertions)

## Workflow changes

- `.github/workflows/release.yml`: añadido job `build-docker` con save+push a ghcr.io
- `.github/workflows/ci.yml`: añadido job `test-docker` para validar Dockerfile en PRs

## Pendiente v0.63 (siguiente)

- Auto-generar CHANGELOG desde conventional commits
- User-upload real de APKG en marketplace
- Plugin interno "Daily Note" automático
- Búsqueda semántica con embeddings on-device
- Sync conflict resolution UI

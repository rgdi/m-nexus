# CHANGELOG v0.62.0 — Stemmer ES/EN, Docker, CI, Gestures

## Resumen

v0.62.0 añade mejora de búsqueda con stemming bilingüe (ES/EN), gestos móviles pulidos, y operativa de producción con Docker + CI release automatizado. Plugin system y iOS support han sido eliminados del roadmap por no aportar valor crítico al usuario objetivo.

**Versión:** 0.62.0+133
**Tests backend:** 747/747 pass (era 724, +23 nuevos)
**Tests app:** 22 scripts validate_*.cjs, 695+ assertions (era 628, +67)

## Cambios

### v0.62.0 — Stemmer bilingüe ES/EN

**Problema:** FTS5 con porter stemmer solo cubre EN. Queries en español como "anatomías" no encuentran "anatomía", y plurales como "huesos" no matchean "hueso".

**Solución:** `stemmer.ts` con:
- Normalización NFD (sin acentos) para que "anatomía" == "anatomia"
- Stemmer ES custom: sufijos `-ando/-iendo, -ado, -idad, -mente, -es/-s`
- Stemmer EN: porter-style (`-ing, -ed, -s, -tion`)
- 75+ stopwords ES, 30+ stopwords EN
- Auto-detección de idioma (acentos, stopwords)
- Endpoint REST para construir queries FTS5 con wildcard `*`

**Archivos:**
- `backend/src/services/stemmer.ts` (200 líneas)
- `backend/src/routes/stemmer.ts` (5 endpoints: stem, tokenize, query, detect, normalize)
- `backend/tests/stemmer.test.ts` (23 tests)

### v0.62.1 — Gestures y haptics

**Problema:** Sin gestos nativos mobile, la app se siente menos pulida que AnkiMobile o RemNote.

**Solución:** `gestures.dart` con:
- `HapticHelper` (light/medium/heavy/selection/vibrate) — wrapper consistente
- `SwipeToDelete` — confirma con dialog antes de eliminar
- `SwipeToAction` — acciones custom (archive, complete)
- `PullToRefresh` — refreshIndicator con haptic
- `LongPressMenu` — menu contextual al mantener pulsado

**Archivos:**
- `app/lib/widgets/gestures.dart`

### v0.62.2 — Docker image

**Problema:** Deploy manual con dependencias nativas (better-sqlite3, canvas) puede ser complicado.

**Solución:** Multi-stage Dockerfile + docker-compose:
- Stage 1 (deps): instala build tools + production deps
- Stage 2 (build): TypeScript → JS
- Stage 3 (runtime): usuario no-root `mnexus`, healthcheck, expone 3000
- docker-compose con volúmenes `mnexus-data` y `mnexus-backups`
- nginx reverse proxy opcional con SSL, CSP headers, rate limit
- .dockerignore para capas eficientes

**Archivos:**
- `Dockerfile` (multi-stage)
- `.dockerignore`
- `docker-compose.yml` (servicio + proxy opcional)
- `nginx.conf` (SSL, CSP, HSTS, rate limit, WebSocket support)

### v0.62.3 — CI release workflow

**Problema:** El release.yml no construía Docker image.

**Solución:** Job `build-docker` añadido:
- Build multi-tag (`mnexus/backend:${TAG}` y `:latest`)
- Test: arranca container, hace `curl /health`
- Save: comprime a `m-nexus-docker-${TAG}.tar.gz`
- Push a GitHub Container Registry (ghcr.io/rgdi/m-nexus)
- `continue-on-error: true` para no romper el release si Docker no está disponible

También se añadió `test-docker` al CI workflow (no release) para validar el Dockerfile en cada PR.

**Archivos:**
- `.github/workflows/release.yml` (job `build-docker` añadido)
- `.github/workflows/ci.yml` (job `test-docker` añadido)

## Eliminado del roadmap

- **Plugin system (third-party API)**: descartado. El vault es local-first y los plugins añadirían superficie de ataque sin aportar valor inmediato.
- **iOS support**: descartado por ahora. Sin ADB/Mac en sandbox para testing, y la cuota de usuarios iOS en el segmento objetivo (estudiantes de medicina) es baja.

## Stats finales

| Métrica | Antes v0.62 | Después v0.62 |
|---------|-------------|---------------|
| Tests backend | 724 | **747** |
| Tests app (assertions) | 628 | **695** |
| Files de config | 0 | 5 (Docker, compose, nginx, dockerignore, CI) |
| Endpoints REST nuevos | 0 | 5 (stemmer) |
| Widgets Flutter nuevos | 0 | 4 (gesture helpers) |

## Próximos pasos (v0.63)

- Auto-generar CHANGELOG desde commits (conventional commits)
- Mejorar el marketplace con user-upload real de APKG
- Plugin interno para "Daily Note" automático
- Búsqueda semántica con embeddings on-device
- Sync conflict resolution UI

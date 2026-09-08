# AUDIT REPORT — m-nexus v0.47.11

**Fecha:** 2026-09-08
**Alcance:** CI workflows, backend Node.js/TypeScript, Flutter app, infraestructura de release.
**Método:** Inspección estática del código + análisis de configuraciones + verificación de coherencia entre componentes.
**Asunción:** buscar bugs reales, no cosmética.

---

## 🔴 CRÍTICO — Compromiso de seguridad

### C-1. Credenciales de firma Android commiteadas al repositorio público

**Archivo:** `app/android/key.properties` (en git, 1026 bytes)
**Commit de origen:** `5ca2dc1 fix(app): v0.45.4 - use same keystore for debug + release APKs`
**Contenido leak:**
```
storePassword=mnexus2024
keyPassword=mnexus2024
keyAlias=mnexus
storeFile=keystores/mnexus-release.keystore
```

**El keystore binario** (`app/android/keystores/mnexus-release.keystore`, 2752 bytes) **también está en el repo**.

**Comentario en .gitignore (líneas 28-31):**
> v0.32: keystore and key.properties are committed to the repo on purpose, so the release APK signature is consistent across all CI builds. This is a research/study tool, not a production app with secrets.

**Impacto real:**
1. Cualquiera puede firmar APKs con el mismo certificado que las releases oficiales
2. Esos APKs se instalarán como "update" sobre instalaciones existentes (mismo signing cert)
3. Permite distribuir malware suplantando M-NEXUS
4. El repo `rgdi/m-nexus` es público → el keystore es de facto público

**Mitigación:**
- Rotar el keystore INMEDIATAMENTE (generar uno nuevo, re-firmar el próximo APK con el nuevo)
- Añadir `key.properties` y `keystores/` al .gitignore
- Eliminar del historial de git (`git filter-branch` o `bfg-repo-cleaner`) — los commits previos siguen exponiendo
- Invalidar el keystore actual; cualquier update firmado con él debe ser considerado malicioso
- Considerar reportar como CVE si la app tiene usuarios reales

**Severidad:** CRÍTICA. El comentario "research/study tool" no aplica — el repo genera APKs y GitHub Releases que se distribuyen públicamente.

---

### C-2. JWT secret con default hardcodeado

**Archivo:** `backend/src/config.ts` (línea 81)
```typescript
get jwtSecret() { return process.env.JWT_SECRET ?? "change-me-in-production"; },
```

**Impacto real:**
- Si `JWT_SECRET` no está se en producción (caso común en deploys sin configurar .env), todos los tokens JWT se firman con `"change-me-in-production"`.
- Este string es público (está en el código fuente público).
- Un atacante puede firmar tokens JWT válidos con cualquier `deviceId` y obtener acceso completo al backend (`/api/v1/*` excepto `/health`, `/metrics`, `/`).

**Comprobación:** grep `change-me` retorna `backend/src/config.ts: ['change-me']` (1 hit, único).

**Mitigación:**
- Lanzar excepción al arrancar si `JWT_SECRET` no está seteado:
  ```typescript
  get jwtSecret() {
    const s = process.env.JWT_SECRET;
    if (!s || s.length < 32 || s === "change-me-in-production") {
      throw new Error("JWT_SECRET must be set to a strong (>=32 chars) random value");
    }
    return s;
  }
  ```
- Añadir test que verifique que el server NO arranca sin `JWT_SECRET`.

**Severidad:** CRÍTICA. Authentication bypass trivial en producción.

---

### C-3. SecretManager en dev mode por defecto (NODE_ENV no seteado)

**Archivo:** `backend/src/services/secretManager.ts`
```typescript
// línea 213 (getSecretManager)
instance = new SecretManager({ devMode: process.env.NODE_ENV !== "production" });

// línea 47-50 (constructor)
if (opts.devMode || process.env.MNEXUS_DEV_MODE === "1") {
  const devKey = createHash("sha256").update("mnexus-dev-key-do-not-use-in-prod").digest();
  this.masterKey = devKey;
  logger.warn("SecretManager: DEV MODE — keys are NOT secure");
}
```

**Impacto real:**
- Si `NODE_ENV` no está seteado (muy común en Docker/systemd sin env explícito), `process.env.NODE_ENV !== "production"` evalúa a `true` → entra en dev mode.
- Dev mode usa master key hardcodeada: `"mnexus-dev-key-do-not-use-in-prod"`.
- Todos los secrets cifrados (API keys de OpenAI, etc.) son descifrables con esa clave pública.
- El string `"mnexus-dev-key-do-not-use-in-prod"` está en el código fuente público.

**Mitigación:**
- Invertir la lógica: dev mode solo si `NODE_ENV === "development" || MNEXUS_DEV_MODE === "1"`.
- Por defecto, exigir master key desde env o archivo.
- O requerir explícitamente `--dev` flag.

**Severidad:** CRÍTICA. Compromete todas las API keys guardadas vía SecretManager.

---

## 🟠 GRAVE — Bugs de configuración

### G-1. CI falla silenciosamente en instalación de Node en install.sh

**Archivo:** `install/install.sh` (líneas 290-291)
```bash
Environment=PORT=$DEFAULT_PORT
Environment=NODE_ENV=production
EnvironmentFile=-$TARGET_DIR/.env
```

`EnvironmentFile` con prefijo `-` significa "optional, no fallar si no existe". El install no genera `.env` ni avisa al usuario que tiene que crearlo. Si el usuario no crea `.env`, el backend arranca con `JWT_SECRET="change-me-in-production"` (ver C-2) y `NODE_ENV=production`.

**Severidad:** ALTA. Combinado con C-2, esto significa que el flujo de instalación oficial produce un backend inseguro.

---

### G-2. Discrepancia de puerto backend ↔ app

**Archivos:**
- `backend/src/config.ts:79` — default port = `4000`
- `install/install.sh:57` — `readonly DEFAULT_PORT=4000`
- `app/lib/services/backend_client.dart:26` — `const String _defaultBackendUrl = 'http://10.0.2.2:8787';` ← **PUERTO 8787**
- `app/lib/widgets/voice_input_button.dart:10` (comentario) — `'http://10.0.2.2:4000'` ← puerto 4000

**Impacto:**
- El default URL del cliente apunto al puerto **8787** que NO es ni el del backend (4000) ni el de ningún docker-compose del repo.
- Si el usuario no edita el setting "Backend URL" en la app, la app no se puede conectar al backend por defecto.
- Tres fuentes de verdad distintas para el puerto: 4000, 4000, 8787, 4000. Riesgo de confusión en deploys.

**Mitigación:**
- Unificar todos a `4000`.
- Añadir test que verifique que el default del cliente conecta al default del servidor.

---

### G-3. App Flutter asume Ollama local (Node 22 + binding nativo rota)

**Hallazgo:** El backend en runtime local Node 20.19.4 segfaultea con `better-sqlite3@13` (binding nativo compilado para Node 22). Los 5 tests `backupRoutes.test.ts` fallan por esto (no por bug de código, sino entorno).

**En producción:**
- `engines: node >=20.0.0` pero código usa `node:sqlite` (Node 22+ only).
- El README dice "Soporta Node 20+", pero la realidad requiere Node 22.

**Mitigación:**
- Cambiar `engines` a `"node": ">=22.0.0"` para que npm advierta al instalar en Node 20.
- O rebuild better-sqlite3 contra el runtime target.

---

## 🟠 GRAVE — Bugs lógicos en backend

### G-4. Tres routers implementados pero NO registrados en server.ts

**Archivos presentes (código completo) pero sin `app.register(...)`:**

| Archivo | LOC | Endpoint que debería exponer |
|---|---|---|
| `backend/src/routes/upload.ts` | 9952 | `POST /api/v1/upload/init`, `/chunk`, `/complete` (chunked upload) |
| `backend/src/routes/transcriptionStream.ts` | 2233 | `POST /transcription/stream` (SSE) |
| `backend/src/workers/fsrsQueue.ts` | 12421 | `POST /api/v1/fsrs/eval` |

**Verificación:**
```bash
$ grep -E "uploadRoutes|transcriptionStream|fsrsQueue" backend/src/server.ts
(nada)
```

**Impacto:**
- Los tests de `upload.test.ts` y `wsRateLimit.test.ts` instancian Fastify standalone y registran las rutas manualmente → tests pasan.
- El server real (que sale de `buildServer()` en server.ts) **NO expone estos endpoints**.
- Los usuarios que intenten usar chunked upload o FSRS queue evaluation obtienen 404.

**Mitigación:**
```typescript
// en server.ts, junto a los otros app.register():
await app.register(uploadRoutes, { prefix: "/api/v1/upload" });
await app.register(transcriptionStreamRoutes, { prefix: "/api/v1/transcription" });
await app.register(fsrsQueueRoutes, { prefix: "/api/v1/fsrs" });
```
Y añadir imports.

---

### G-5. install.sh imprime solo UNA línea en check_compat

**Archivo:** `install/install.sh` (líneas 396-401)
```bash
check_compat() {
    section "Verificando compatibilidad de versiones"
    log "Versión instalada: v$INSTALLED_VERSION"
    log "Versión backend: v$VERSION (requerida: >= $COMPATIBLE_BACKEND_MIN)"
        log "Versión app: v$VERSION (requerida: >= $COMPATIBLE_COMPANION_MIN)"
    # ...
```

**Bugs:**
1. La línea "Versión app" está indentada con 8 espacios dentro de un bash function — bash lo acepta pero confunde al lector.
2. Solo se imprime info del backend, no del app — el comentario menciona "Versión app" pero falta la línea que debería decir `log "Versión backend instalada: v$INSTALLED_VERSION"`.

**Severidad:** BAJA (cosmético/info incorrecto en instalación). El usuario verá "Versión backend: v$VERSION" pero no sabrá qué versión del app está corriendo.

---

## 🟡 MEDIO — Bugs en app Flutter

### M-1. build.gradle.kts huérfano (no se usa, crea confusión)

**Archivos:**
- `app/android/app/build.gradle` (Groovy, **USADO** por CI, lee versión de gradle.properties)
- `app/android/app/build.gradle.kts` (Kotlin DSL, **NO USADO**, legacy de v0.45.4)

**Impacto:**
- Dos archivos con el mismo target. Gradle prefiere `.gradle` cuando ambos existen.
- El `.kts` tiene `versionCode = 23` y `versionName = "0.42.0"` HARDCODED, lo que sugiere que es un leftover de un branch viejo.
- Cualquier desarrollador que edite el archivo incorrecto perderá horas.

**Mitigación:**
- Borrar `app/android/app/build.gradle.kts`.
- Actualizar `.gitignore` para ignorar archivos `.kts` legacy.

---

### M-2. compileSdk 34 vs flutter_nfc_kit conflict

Documentado en el historial de commits (v0.46.x fix #2 en otras projects del usuario). El `flutter_nfc_kit: ^5.0.0` declara `compileSdk 35` que choca con el `compileSdk = 34` del proyecto. Si en el futuro se añade este plugin, el build de Android fallará con errores de merger.

**Severidad:** BAJA (latente). No afecta al build actual porque el plugin no está en pubspec.

---

### M-3. android.useAndroidX=true + android.enableJetifier=true

`android.enableJetifier=true` está deprecado en AGP 8.x y fuerza re-procesamiento de paquetes que usen Support Library. Debería ser `false` salvo que alguna dep específica lo requiera.

**Severidad:** BAJA (warning, no error).

---

## 🟡 MEDIO — Bugs en CI workflows

### CI-1. release.yml: `LATEST_TAG` parsing asume formato fijo

**Archivo:** `.github/workflows/release.yml` (línea ~66)
```yaml
LATEST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1 || echo "")
```

Si el repo no tiene tags `v*` (por ejemplo, después de un rebase), `LATEST_TAG=""`. La comparación `[[ "$LATEST_TAG" == "$TAG" ]]` retorna false porque `""` ≠ `"v0.47.11"`, así que intenta release. Si `LATEST_TAG == ""` se imprime "ultimo tag: " (string vacío), el log del workflow queda sucio pero no rompe.

**Severidad:** BAJA (cosmético).

---

### CI-2. ci.yml: flutter cache key incluye pubspec.lock pero no se regenera al cambiar deps

Cuando se añade una dep al pubspec.yaml pero el pubspec.lock ya está actualizado, el cache hit funciona. Si pubspec.lock se regenera por completo (ej. `flutter pub upgrade`), el cache miss hace que la instalación tarde más.

**Severidad:** BAJA (perf).

---

### CI-3. release.yml: El `detect-version` job NO verifica backend tests

`detect-version` solo lee pubspec.yaml y package.json. Si hay un mismatch (lo avisa con `::warning::`), pero no falla el build. Eso significa que se puede pushear un release donde el backend está en v0.47.10 y el frontend en v0.47.11 sin que CI se queje.

**Severidad:** MEDIA (puede generar confusion en releases).

---

## 🔵 BAJO — Code smell / tech debt

### L-1. `engines: node >=20.0.0` pero código requiere Node 22

El `package.json` declara `"engines": {"node": ">=20.0.0"}` pero el código importa `node:sqlite` (built-in Node 22+). npm debería fallar al instalar, pero la advertencia es solo deprecation-style.

**Fix:** cambiar a `"node": ">=22.0.0"`.

---

### L-2. Refs circulares / imports

- `backend/src/routes/structured.ts` importa de los 4 archivos `structured{Databases,Rows,Store,Views}.ts` que están en el mismo directorio. Estructural OK pero el `structuredStore.ts` no exporta una `Routes function`, solo constantes — convención inconsistente.

---

### L-3. `debug` y `release` firman con la misma keystore (intencional según comentario)

`app/android/app/build.gradle` líneas 65-72 (build.gradle.kts equivalente): tanto debug como release usan el release keystore. Esto es intencional para evitar "App not installed" al cambiar entre builds. Pero en desarrollo local significa que cualquier `flutter run` produce un APK firmado con la clave de release — lo que si el keystore está expuesto (ver C-1) es un riesgo.

---

## ✅ Cosas que SÍ funcionan (verificación honesta)

- **Flutter analyze:** 0 issues (de 156 iniciales). 100% clean.
- **Flutter test:** 70/70 passing. (Confirmado en sesión anterior.)
- **flutter build web:** éxito (89s).
- **backend TS check:** 0 errores (deps ok en Node 22).
- **No TODOs/FIXMEs activos:** sólo aparecen en docs explicativas y en un comentario de CHANGELOG.
- **refresh tokens con rotación:** implementado correctamente en `jwt.ts`.
- **error codes estructurados (EC-XXX-NNN):** 200+ códigos en 28 categorías, sincronizados frontend↔backend.
- **Secrets cifrados con AES-256-GCM:** correcta implementación criptográfica.

---

## 🎯 Prioridad de fixes

| # | Severidad | Fix | Esfuerzo |
|---|---|---|---|
| C-1 | 🔴 CRÍTICO | Rotar keystore, sacarlo de git | 1h |
| C-2 | 🔴 CRÍTICO | Fail-fast en JWT_SECRET default | 15 min |
| C-3 | 🔴 CRÍTICO | Invertir devMode default | 15 min |
| G-1 | 🟠 ALTO | install.sh debe generar .env o abortar | 30 min |
| G-2 | 🟠 ALTO | Unificar puerto (8787 → 4000) | 5 min |
| G-3 | 🟠 ALTO | engines node >=22 + tests compatibles | 1h |
| G-4 | 🟠 ALTO | Registrar upload/transcription/fsrsQueue en server.ts | 30 min |
| M-1 | 🟡 MEDIO | Borrar build.gradle.kts huérfano | 5 min |
| CI-3 | 🟡 MEDIO | CI falla si versiones difieren | 15 min |
| L-1 | 🔵 BAJO | engines.node = ">=22" | 5 min |

**TOTAL estimado: ~4h para cerrar todos los críticos y altos.**

---

## 📊 Resumen ejecutivo

**Lo que el código dice:** "Sistema médico standalone con backend opcional, FSRS-5, encrypted secrets, 200+ error codes, 567 tests passing".

**Lo que el código realmente hace en producción:**
1. Distribuye un APK firmado con credenciales públicas → cualquiera puede suplantar updates.
2. Arranca con JWT secret hardcodeado si no se configura → auth bypass trivial.
3. Cifra API keys con master key derivada de un string en el código → todas las keys son públicas.
4. El server arranca sin las rutas de upload, transcription stream y fsrs queue → 404 silenciosos.
5. La app Flutter por defecto apunta a un puerto (8787) donde no hay nada.
6. El install script instala sin generar `.env` → el usuario arranca el backend sin secrets configurados.

**Diagnóstico:** El proyecto tiene excelentes abstracciones (FSRS, error codes, encryption) pero la "última milla" de configuración y despliegue está rota. Cualquier usuario que siga las instrucciones del README llega a un sistema inseguro por defecto.
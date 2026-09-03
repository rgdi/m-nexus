# Auto-update en M-NEXUS (v0.30+)

M-NEXUS v0.30 incluye auto-update en **los 3 componentes**:
plugin de Obsidian, backend, y companion app.

## Filosofía

- **Detección automática** de nuevas versiones vía GitHub Releases
- **Aviso al usuario** (no se actualiza silenciosamente)
- **Acción manual** (botón "Actualizar" en cada componente)
- **Sin reinstalación** (Android reemplaza el APK; backend se auto-actualiza y reinicia)

## 1. Plugin de Obsidian

Implementado en `obsidian-plugin/src/updateChecker.ts`.

- Cada 6h consulta GitHub Releases
- Si hay nueva versión, muestra un Notice con link
- Click en el link descarga el ZIP y abre el diálogo de instalación
- Compatible con el auto-update nativo de Obsidian (usa `app.loadPlugin`/`enablePlugin` API)

## 2. Backend

Implementado en `backend/src/utils/updateChecker.ts` y `backend/src/routes/update.ts`.

### Endpoints

- `GET /api/v1/update` (público)
  - Devuelve: `{ currentVersion, latestVersion, hasUpdate, downloadUrl, body, size, ... }`
  - Cache 5 min

- `POST /api/v1/update/check` (público)
  - Fuerza re-check (limpia cache)
  - Útil para dashboards

- `POST /api/v1/update/apply` (público, protegido por red privada)
  - Descarga, respalda, extrae y reinicia
  - Backup: `mnexus-backups/backup-v{old}-{ts}.zip`
  - Restart: detecta automáticamente PM2 o systemd

### CLI

```bash
# Ver versión actual
mnexus version

# Verificar si hay update (no descarga)
mnexus update-check
mnexus update-check --pre  # incluye prereleases

# Aplicar update (descarga, respalda, reinicia)
mnexus update-apply
mnexus update-apply --pre

# Output típico:
# ✓ updated to v0.30.0
#   backup: /home/user/mnexus-backups/backup-v0.29.7-2026-09-03T13-30-00-000Z.zip
#   restart scheduled (pm2 restart mnexus-backend)
```

### Auto-restart

El update-apply detecta automáticamente:
- **PM2**: `pm2 restart mnexus-backend || pm2 restart all`
- **systemd**: `systemctl restart mnexus-backend` (si existe `/etc/systemd/system/mnexus-backend.service`)

Si no detecta ninguno, loguea instrucciones para reinicio manual.

### Rollback

Si algo sale mal:
1. Los backups se guardan en `mnexus-backups/`
2. Para restaurar: `unzip -o mnexus-backups/backup-vX.Y.Z-...zip -d ~/.mnexus`
3. Reiniciar el backend manualmente

## 3. Companion App (Android APK)

Implementado en `companion-app/lib/services/updater.dart` y `companion-app/lib/ui/update_dialog.dart`.

### Flujo del usuario

1. App arranca, chequea GitHub cada 6h
2. Si hay update, aparece un SnackBar: *"M-NEXUS v0.30.0 disponible"*
3. Toca "Ver" o el ícono de update en la AppBar
4. Se muestra un diálogo con:
   - Versión actual vs nueva
   - Tamaño del APK
   - Changelog (markdown renderizado)
   - Botón **Descargar e instalar**
5. El usuario toca el botón → descarga el APK
6. Android muestra el diálogo de instalación estándar
7. El nuevo APK **reemplaza** al viejo (datos y config se conservan)

### Implementación técnica

- **Detección**: GitHub API directa o vía backend (`UpdaterConfig.backendUrl`)
- **Descarga**: HTTP streaming con progreso (`downloadApk`)
- **Instalación**: Platform channel `com.mnexus.installer/install` → Kotlin
  - Usa FileProvider para pasar el APK al sistema
  - `Intent.ACTION_VIEW` con MIME `application/vnd.android.package-archive`
  - El sistema se encarga del resto (incluyendo permisos de "origen desconocido")

### Permisos Android añadidos

```xml
<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
```

Y el FileProvider en `AndroidManifest.xml`:
```xml
<provider
    android:name="androidx.core.content.FileProvider"
    android:authorities="${applicationId}.fileprovider"
    android:exported="false"
    android:grantUriPermissions="true">
    <meta-data
        android:name="android.support.FILE_PROVIDER_PATHS"
        android:resource="@xml/file_paths" />
</provider>
```

## Tests

- **Backend**: 23 tests (`tests/updateChecker.test.ts` + `tests/updateRoutes.test.ts`)
- **Companion**: 8 tests (`test/updater_test.dart`)

## Configuración

### Backend

Variables de entorno:
- `MNEXUS_SKIP_UPDATE_CHECK=1` → desactiva el check al arrancar
- `MNEXUS_BACKEND_DIR=~/.mnexus` → directorio a actualizar (default)
- `MNEXUS_REPO_ROOT=~/.mnexus` → igual

### Companion

`UpdaterConfig`:
```dart
UpdaterConfig(
  checkInterval: Duration(hours: 6),     // cada cuánto chequear
  includePrerelease: false,               // ¿mostrar betas?
  backendUrl: null,                       // usar GitHub directo o proxy
  cacheTTL: Duration(minutes: 30),       // cache local
)
```

## Limitaciones conocidas

- **Voice notes deshabilitadas en companion** (v0.29.7) por incompatibilidad de `record` plugin con AGP 8.3
- **Backend update-apply** requiere permisos de escritura en el directorio del backend (ejecutar como root o el usuario dueño)
- **GitHub API rate limit**: 60 req/h sin auth, 5000 con token. Los chequeos periódicos respetan el cache de 5 min
- **PAT fine-grained** en CI: no triggerea workflows en tag-push, usa push:branches:main con `git describe` para detectar versión

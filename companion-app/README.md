# M-NEXUS Companion App

App Android (Flutter 3.24 + Dart 3.5) que:
- 🎙️ Graba voice notes de clases (foreground service)
- 📅 Detecta eventos de Calendar (Google Calendar via ContentProvider)
- 🔧 Configura permisos y batería
- 🔌 Conecta con el backend M-NEXUS
- 📦 Sube archivos por chunks (resumable)
- 🛠️ Detecta vaults de Obsidian (con SAF picker)
- 🔄 Sincroniza offline-first (SyncQueue)
- 🚀 Auto-update (vía GitHub releases)

## v0.35.0

## Quick start (dev)

```bash
# Requisitos: Flutter >= 3.24, Dart >= 3.5
flutter --version
flutter doctor

# Instalar deps
cd companion-app
flutter pub get

# Build APK release (con keystore)
flutter build apk --release

# Build APK debug
flutter build apk --debug

# Tests (40 tests)
flutter test
```

## Estructura

```
companion-app/
├── lib/
│   ├── main.dart                       # Entry point + splash + test mode
│   ├── models/                         # Modelos
│   │   └── plugin_release.dart
│   ├── services/                       # Servicios
│   │   ├── app_info.dart               # Versión, device, OS (via PackageManager)
│   │   ├── backend_client.dart         # HTTP client (X-Device-Id, retries)
│   │   ├── calendar_service.dart       # Google Calendar integration
│   │   ├── chunked_upload.dart         # Upload por chunks (resumable)
│   │   ├── device_id.dart              # UUID v4 + ANDROID_ID
│   │   ├── permissions.dart            # Permisos unificados
│   │   ├── plugin_installer.dart       # Extrae plugin ZIP al vault
│   │   ├── recorder.dart               # Audio recorder (speech_to_text 7.x)
│   │   ├── sync_queue.dart             # Cola de sync offline-first (v0.34+)
│   │   ├── update_checker.dart         # Chequea updates del plugin
│   │   ├── updater.dart                # Auto-update de la app
│   │   └── vault_detector.dart         # Detector de vaults (5 rutas + SAF)
│   └── ui/                             # Pantallas
│       ├── home_page.dart              # Home con stats, calendar, vaults
│       ├── setup_wizard.dart           # Wizard de 8 pasos (v0.35+)
│       ├── recording_page.dart         # Grabar + lista de recordings
│       ├── install_page.dart           # Instalar plugin en vault
│       ├── activate_plugin_page.dart   # Instrucciones para activar
│       ├── settings_page.dart          # Configuración completa
│       ├── help_page.dart              # Help + FAQ
│       └── update_dialog.dart          # Diálogo de updates
├── android/                            # Android project
│   └── app/src/main/
│       ├── kotlin/com/mnexus/installer/
│       │   ├── MainActivity.kt         # Platform channels
│       │   └── RecordingService.kt     # Foreground service
│       └── res/                        # Resources
└── test/                                # 40 tests (flutter test)
    ├── backend_client_test.dart
    ├── chunked_upload_test.dart
    ├── device_id_test.dart
    ├── hash_test.dart
    ├── help_page_test.dart
    ├── home_install_test.dart
    ├── install_page_test.dart
    ├── permissions_test.dart
    ├── plugin_installer_test.dart
    ├── recorder_test.dart
    ├── updater_test.dart
    └── vault_detector_test.dart
```

## Pantallas

### 1. Splash + Test Mode (`main.dart`)
- Muestra logo de M-NEXUS con gradient
- Long-press en el logo → activa/desactiva test mode (fuerza wizard)
- Decide si mostrar wizard o home

### 2. Setup Wizard (`setup_wizard.dart`, 8 pasos)
1. **Bienvenida** - qué es M-NEXUS
2. **Permisos** - 6 permisos con botón "Pedir todos"
3. **Batería** - desactivar optimización
4. **Backend** - URL + test de conexión
5. **Calendario** - escoger calendario
6. **Vault** - detección automática
7. **Plugin** - descarga e instala
8. **Listo** - resumen

### 3. Home (`home_page.dart`)
- Stats cards (vaults, próxima clase, update)
- Banner de update (si hay)
- Calendar card (próximo evento + menú de opciones)
- Permissions pendientes
- Vaults detectados
- Backend status
- Device ID

### 4. Recording (`recording_page.dart`)
- Sugerir nombre desde Calendar
- Botón grande de grabar
- Timer + indicador ●REC
- Lista de recordings previos con:
  - Badge de sync status (🔄 pending, ✅ synced, ❌ failed)
  - Botones: play, rename, retry sync, delete
- Pull-to-refresh

### 5. Settings (`settings_page.dart`)
- Backend URL + test
- Device ID + nombre
- Calendar (toggle, lista)
- Acerca de (versión, links)

### 6. Install (`install_page.dart`)
- Progreso de descarga
- Extracción al vault
- Resultado

### 7. Activate (`activate_plugin_page.dart`)
- 6 pasos con PageView
- Instrucciones para activar en Obsidian

## Permisos

6 permisos gestionados:

| Permiso | Para qué | Código |
|---|---|---|
| `storage` | Acceso a vault | `Permission.storage` |
| `microphone` | Voice notes | `Permission.microphone` |
| `calendar` | Google Calendar | `Permission.calendarFullAccess` |
| `notifications` | Foreground service | `Permission.notification` |
| `install_unknown` | Auto-update APK | `Permission.requestInstallPackages` |
| `manage_storage` | Vaults en /sdcard (Android 11+) | `Permission.manageExternalStorage` |

## Platform Channels (Kotlin)

4 channels con `MethodChannel`:

### `com.mnexus.installer/install`
- `installApk(filePath)` — instala el APK descargado

### `com.mnexus.installer/device`
- `getAndroidId()`, `getDeviceModel()`, `getOsVersion()`
- `getPackageName()`, `getAppVersion()`

### `com.mnexus.installer/calendar`
- `checkCalendarPermission()`, `requestCalendarPermission()`
- `listCalendars()`, `listEvents({startMs, endMs})`
- `openEvent({eventId})` — abre detalle en Calendar del sistema
- `openCalendarSettings()` — abre app de Calendar

### `com.mnexus.installer/recording`
- `startRecordingService({title})` — inicia foreground service
- `stopRecordingService()` — para el service
- `isRecordingServiceRunning()` — estado

### `com.mnexus.installer/permissions` (v0.34+)
- `openManageStorageSettings()` — abre pantalla MANAGE_EXTERNAL_STORAGE
- `isManageStorageGranted()` — checkea estado (Android 11+)
- `isInstallPermissionGranted()` — checkea REQUEST_INSTALL_PACKAGES (Android 8+)
- `requestIgnoreBatteryOptimizations()` — abre pantalla de batería (v0.35+)

### `com.mnexus.installer/vault` (v0.34+)
- `getSafPath()` — vault seleccionado vía SAF
- `setSafPath({path})` — guarda el path
- `pickVault()` — abre selector SAF

## Foreground Service (Android 14+)

`RecordingService.kt` mantiene la grabación activa cuando la app va a background:
- `foregroundServiceType="microphone"` (requerido en Android 14)
- Notification channel `mnexus_recording` (IMPORTANCE_LOW)
- `setOngoing(true)` — no se puede descartar
- `NOTIFICATION_ID=1001`

## Vault Detection

5 rutas escaneadas (en orden):
1. `/storage/emulated/0/Documents/*` (default Obsidian)
2. `/storage/emulated/0/*` (root, requiere MANAGE_EXTERNAL_STORAGE)
3. External storage (`getExternalStorageDirectory()`)
4. App-specific storage
5. SAF (Storage Access Framework) - vault seleccionado por el usuario

Si no se encuentra ninguno, el usuario puede:
- Pulsar "Elegir manualmente" para abrir SAF
- Conceder MANAGE_EXTERNAL_STORAGE para /sdcard completo

## Sync Queue (offline-first)

Cada recording tiene un `SyncEntry` con estado:
- `pending` — esperando para subir
- `uploading` — actualmente subiendo
- `synced` — subido OK
- `failed` — error (con `lastError`)
- `manual` — solo local (no subir)

Persiste en `SharedPreferences` como JSON.

## Tests

```bash
flutter test
```

**40 tests** cubriendo:
- `backend_client_test.dart` (5) — headers, retries
- `chunked_upload_test.dart` (5) — upload, resume, retry
- `device_id_test.dart` (6) — UUID, persistencia
- `help_page_test.dart` (3) — render
- `home_install_test.dart` (2) — mock GitHub API
- `install_page_test.dart` (5) — PluginRelease model
- `permissions_test.dart` (4) — getAll(), request()
- `plugin_installer_test.dart` (8) — model + constants
- `recorder_test.dart` (1) — mock platform channel
- `updater_test.dart` (10) — version compare, cache
- `vault_detector_test.dart` (1)

Total: ~50 tests (algunos son "groups" que cuentan varios casos).

## Build (release)

```bash
# 1. Bump version
# pubspec.yaml: version: 0.36.0+17
# android/app/build.gradle.kts: versionCode=17, versionName="0.36.0"

# 2. Build
flutter build apk --release

# El APK queda en build/app/outputs/flutter-apk/app-release.apk
# El CI lo renombra a m-nexus-companion-v0.36.0.apk
```

## Android Signing

El keystore está commiteado en `android/keystores/mnexus-release.keystore`:
- PKCS12 format
- 2048-bit RSA
- 100-year validity
- Password: `mnexus2024` (en `android/key.properties`)

`android/app/build.gradle.kts` lo carga automáticamente para builds release.

## Troubleshooting

### "App not installed" al actualizar
- Signature mismatch. Cada APK debe estar firmado con el mismo keystore.
- Solución: `adb uninstall com.mnexus.installer` y reinstalar.

### Permiso de micrófono denegado permanentemente
- Settings → Apps → M-NEXUS → Permissions → Microphone

### No se detecta el vault
- Verifica que existe `/storage/emulated/0/Documents/TuVault/.obsidian/`
- O usa "Elegir manualmente" (SAF picker)

### Battery optimization mata la grabación
- Settings → Apps → M-NEXUS → Battery → Unrestricted
- O desde el wizard paso "Batería"

### Auto-update no instala
- Settings → Apps → M-NEXUS → Install unknown apps → Allow

## License

MIT

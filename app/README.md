# M-NEXUS App (standalone)

App Flutter 3.24 + Dart 3.5 (Android + Web) que:
- 📂 Lee vaults de notas (markdown) desde almacenamiento local
- 🔍 Búsqueda full-text en notas
- 🎴 Flashcards con FSRS spaced repetition
- 🎙️ Voice notes (foreground service)
- 📅 Detecta eventos de Calendar (Google Calendar via ContentProvider)
- ⚙️ Configuración (Settings) persistente con SharedPreferences
- 🔌 Conecta con el backend M-NEXUS (opcional)
- 🔄 Sincroniza offline-first
- 🚀 Auto-update (vía GitHub releases)
- 🆔 **Sistema de error codes** `EC-{CATEGORÍA}-{NNN}` (v0.45)

## v0.45.0

### Novedades de v0.45.0

- **🆔 Sistema de error codes unificado** — `AppError` con `code`, `category`, `message`, `cause`, `context`, `hint`, `timestamp`
- **🛡️ Helpers `safeCall` / `safeCallAsync`** — centralizan try-catch con logging automático
- **📊 Logger estructurado** — `logAppError()`, `logPlatform()`, `logLifecycle()`, `logOp()` con campos consistentes
- **🌐 Compatibilidad** — Mismas categorías que el backend (`NET`, `FS`, `DB`, `AUTH`, `CFG`, `LIFECYCLE`, `INTERNAL`)

### Categorías de error

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

## Quick start (dev)

```bash
# Requisitos: Flutter >= 3.24, Dart >= 3.5
flutter --version
flutter doctor

# Instalar deps
cd app
flutter pub get

# Build APK release (con keystore)
flutter build apk --release

# Build APK debug
flutter build apk --debug

# Run con logs verbosos
flutter run --verbose 2>&1 | grep -E "(component|code)"
```

## Testing

```bash
flutter test
```

## Estructura

```
app/
├── lib/
│   ├── main.dart                # Entry point con Settings + Theme
│   ├── core/                    # theme, shortcuts, main_shell, constants
│   ├── state/                   # app_state (Provider)
│   ├── services/                # 14 services
│   │   ├── backend_client.dart  # HTTP con error codes EC-NET-*
│   │   ├── vault_service.dart   # Vault con EC-VAULT-*
│   │   ├── flashcard_service.dart
│   │   ├── calendar_service.dart # EC-CAL-*
│   │   ├── settings_service.dart # EC-CFG-*
│   │   ├── device_id.dart       # EC-PLAT-*, EC-LIFECYCLE-*
│   │   ├── logger.dart          # 🆕 logger estructurado
│   │   └── ...
│   ├── utils/                   # 🆕
│   │   ├── error_codes.dart     # AppError + 15 categorías
│   │   └── safe_call.dart       # safeCall/safeCallAsync/guardAsync
│   ├── screens/                 # 9 screens (home, vault, note, flashcards, settings, ...)
│   ├── widgets/                 # EmptyState, adaptive widgets
│   └── ...
├── test/                        # 4 test files (safe_call, vault, flashcard, settings)
├── android/                     # Android manifest, MainActivity, platform channels
├── web/                         # PWA config
└── pubspec.yaml                 # mnexus_app
```

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

## Ver logs

```bash
# Android (con dispositivo conectado)
adb logcat | grep -E "(component|EC-)"

# Filtrar por código específico
adb logcat | grep "EC-VAULT-003"

# Filtrar por componente
adb logcat | grep "vault"
```

Ver [`docs/LOGGING.md`](../docs/LOGGING.md) para más opciones.

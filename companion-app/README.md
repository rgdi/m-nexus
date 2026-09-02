# M-NEXUS Installer (Flutter Android)

App Android que detecta vaults de Obsidian, instala/actualiza el plugin M-NEXUS
y graba voice notes que se suben al backend para transcripción.

## v0.28

- **Auto-actualización periódica** (configurable, default 6h)
- **Settings**: URL del backend, JWT, intervalo, autoDownload
- **Notificación** de nueva versión con changelog
- **Voice notes** (v0.22+): graba audio m4a y lo sube a `/audio/upload`
  - Permisos: `RECORD_AUDIO`, `READ_MEDIA_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE`
  - Servicio: `VoiceNotesService` con state machine (idle/recording/paused/processing/completed/error)
  - Auto-classifica por horario de clases con confidence
- **Installer ZIP** v0.28: extrae `main.js`, `manifest.json`, `styles.css`, `versions.json`
- **Carpeta interna**: `_M-NEXUS/{Flashcards/{Drafts,Approved},Inbox,Photos/occlusions,server,PDFs,backups}`

## Estructura

- `lib/main.dart` — entry point
- `lib/services/updater.dart` — chequeo y descarga
- `lib/services/plugin_installer.dart` — instalación en el vault
- `lib/services/vault_detector.dart` — detectar vaults en el dispositivo
- `lib/voice_notes/voice_notes_service.dart` — grabación + upload
- `lib/voice_notes/recording_page.dart` — UI de grabación
- `lib/voice_notes/voice_notes_launcher.dart` — entry point del recording
- `lib/ui/home_page.dart` — lista de vaults
- `lib/ui/install_page.dart` — wizard de instalación
- `lib/ui/settings_page.dart` — settings
- `lib/models/plugin_release.dart` — modelos de release
- `lib/utils/hash.dart` — SHA-256 para checksum

## Tests

```bash
flutter test
```

## Build

```bash
flutter build apk --release
# Output: build/app/outputs/flutter-apk/app-release.apk
```

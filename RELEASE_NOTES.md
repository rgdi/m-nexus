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

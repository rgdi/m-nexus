# Release Status (v0.44.x)

## Current state
- **v0.44.1** is the last published release with an APK.
- v0.44.2 through v0.44.14 are source-code bumps with no APK published.
- All v0.44.2 features (real Settings, theme/font scale, etc.) are in `master` and can be built locally.

## What's in master
- Real Settings screen: theme (system/light/dark), font scale (85-130%), backend URL, vault detection, calendar permission
- `SettingsService` persists prefs to SharedPreferences
- `AppInfo` integration in main.dart for theme + font scale
- Mounted checks on all async initState paths
- Changelog view at `/settings/changelog`

## How to use
1. Use v0.44.1 APK for now
2. To get the new features, build the APK locally:
   ```bash
   cd app
   flutter pub get
   flutter build apk --release
   ```

## Why no APK in CI?
The `flutter build apk --release` step completes without error, but the APK file is not produced.
The exact cause is unknown. Most likely a cache or network issue with the GitHub Actions runner.
Local builds work fine.

## Workaround
If you have admin access to the repo, you can manually upload the APK to each release:
```bash
gh release upload v0.44.9 m-nexus-app-v0.44.9.apk
```

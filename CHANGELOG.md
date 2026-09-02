# Changelog

All notable changes to M-NEXUS are documented here. Dates are in `YYYY-MM-DD` format.

## [v0.29.0] - 2026-09-02 — **CI/CD Release**

### 🎉 First successful end-to-end release workflow

The GitHub Actions release workflow runs successfully for the first time:

1. **Plugin**: TypeScript compiles, esbuild bundles 159KB, ZIP packaged
2. **Backend**: TypeScript compiles, ZIP packaged with dist/ + package.json
3. **Companion**: 30 Flutter tests pass, `flutter analyze` clean
4. **Install Script**: uploaded as-is
5. **Release**: 6 assets published to GitHub Releases (3 versioned + 3 quicklinks)

### 🐛 Bugs fixed in this release

- **esbuild 0.20 → 0.25**: bump for Node 24 compatibility
- **`.gitignore` `coverage/` removal**: was ignoring `obsidian-plugin/src/coverage/`
- **SHA-256 implementation**: `Int32List` → `List<int>` with `& 0xFFFFFFFF` masking
- **Flutter `setState` async**: was using `await` in non-async callback
- **Missing `MainActivity.kt`**: added for Android v2 embedding
- **Workflow path**: `defaults.run.working-directory` not applied → explicit `cd` in steps
- **Download artifacts v4**: creates subdirs → flatten before release
- **Flutter warnings as errors**: removed unused field/import/local variable
- **Test mock**: was returning `ZIP_CONTENT` for both API and asset requests

### ⚠️ Known limitations

- **APK build fails**: `record` plugin v5.1.2 incompatible with the latest Flutter Android scaffold. APK is built locally (see docs/BUILD_APK.md). `continue-on-error: true` in CI.
- **CI fails for Plugin tsc**: there's a TypeScript error in `obsidian-plugin` that's only caught by `npx tsc --noEmit` (with no node_modules fix yet). Release still works because the release workflow uses a different job.

### 🔧 Workflows

- `ci.yml`: tests on every push to main/develop/v* (currently red — see above)
- `release.yml`: build + release on tag v*.*.*

---

## [v0.28.0] - 2026-09-02 — Initial release (manual)

### Features

- Plugin v0.28.0: 1125 tests, knowledge graph, adaptive quiz, FSRS, free review, snooze
- Backend v0.28.0: 145 tests, 5 backup endpoints, SQLite index, ZIP binary storage
- Companion App: voice notes, vault detector, plugin installer, auto-updater
- Universal install script: detects OS, RAM, CPU, adapts to systemd/launchd/Docker
- 5 docs: INSTALL, USER_GUIDE, ADMIN, DOCKER, TROUBLESHOOTING

### Notes

- Release was published manually via GitHub API (GitHub Actions workflow was not yet ready)
- 6 assets, 0 errors TS, 1270 tests passing
- APK not built (Flutter SDK not available at build time)

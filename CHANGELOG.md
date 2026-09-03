# M-NEXUS Changelog

## v0.29.7 (2026-09-03) - APK build working + full release pipeline

### Added
- **APK build**: Android APK successfully built via GitHub Actions (49 MB)
- **Release pipeline fully automated**: All 6 jobs (set-version, build-plugin, build-backend, build-companion, upload-installer, create-release) run end-to-end
- **8 release assets**: 4 versioned (v0.29.7 suffix) + 4 quicklinks (no version, always point to latest)
- **GitHub Release creation**: softprops/action-gh-release@v2 with auto-generated release notes
- **Tag pushing from CI**: Workflow creates and pushes tag if it doesn't exist
- **Workflow-level env**: `RELEASE_TAG` for reliable cross-job data passing

### Changed
- **Gradle wrapper**: 7.6.3 → 8.4 (required for AGP 8.3.0)
- **Android Gradle Plugin**: 8.1.4 → 8.3.0
- **Kotlin**: pinned to 1.9.22 across all gradle files
- **Companion app**: simplified by removing `record` plugin (incompatible with AGP 8.12+)
  - Removed: record 5.1.2, file_picker 8.0.7, permission_handler 11.3.1, url_launcher 6.3.0
  - Removed: lib/voice_notes/ directory
  - Voice notes feature: temporarily disabled (re-enable in future version with different audio plugin)

### Fixed
- **GitHub Actions YAML parser silent failure**: removed all non-ASCII characters (Unicode box-drawing, accented chars) from release.yml
- **APK build with AGP 8.3.0**: full Android build files (build.gradle, settings.gradle, gradle.properties, gradle-wrapper.properties) committed to repo
- **Output propagation between jobs**: use `env.TAG` instead of `needs.set-version.outputs.ref_name` for reliable cross-job data
- **YAML duplicate `- uses:` syntax error**: fixed create-release checkout
- **fetch-tags: true**: ensures git tags are available in checkout for tag detection
- **Absolute paths in zip commands**: avoid relative path issues in CI

### Known limitations
- **PAT doesn't trigger tag-push workflows**: workflow uses `push:branches:main` trigger
- **Voice notes feature removed**: incompatible plugins (record 5.1.2 needs AGP 8.12+ / Gradle 8.13+ which is beyond Flutter 3.24)
- **Build time**: full release takes ~5-7 minutes (APK build is the longest step)

## v0.29.0 (2026-09-02) - Auto-update system

### Added
- 3-component auto-update: plugin (obsidian-plugin), backend, companion app
- `bump-version.sh` script for unified version management
- `push-to-github.sh` for one-command release

## v0.28.0 (2026-09-02) - Backups ultrarrápidos

### Added
- Standard ZIP binary backups with drag-and-drop UI
- SQLite index for fast queries
- 5 new backend endpoints
- 145 backend tests + 1125 plugin tests

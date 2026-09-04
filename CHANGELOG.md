# M-NEXUS Changelog
## v0.32.0 (2026-09-04)

### Added
- Voice notes con flutter_sound (reemplaza record, compatible Flutter 3.24 + AGP 8.3+)
- Setup wizard: pide TODOS los permisos con UI rica por permiso
- PermissionsService: gestión unificada de storage/mic/calendar/notifications/install
- AppInfo service: versión dinámica desde PackageManager (no más string hardcoded)
- RecordingPage: pantalla dedicada con timer, VU meter, lista de grabaciones previas
- Home rediseñado: stats diferenciados (vaults, próxima clase, update), chips de estado, banner de permisos pendientes
- Settings: versión dinámica, device model, OS version

### Fixed
- Settings mostraba "0.30.0+10" hardcodeado — ahora usa AppInfo.load()
- Setup wizard permisos no se solicitaban — ahora pide uno por uno con explicación
- Home mostraba la misma info en todas las secciones — ahora cada una tiene contenido distinto
- MainActivity: read_external_storage explícito para flutter_sound


## v0.30.0 (2026-09-03) - Auto-update system (backend + companion)

### Added
- **Backend auto-update**:
  - Module `utils/updateChecker.ts` with fetchLatestRelease, getUpdateInfo (5-min cache), downloadFile, applyUpdate (backup+extract+restart), detectRestartCommand (PM2/systemd)
  - REST endpoints: GET /api/v1/update (info), POST /api/v1/update/check, POST /api/v1/update/apply
  - CLI: `mnexus version`, `mnexus update-check [--pre]`, `mnexus update-apply [--pre]`
  - 23 new tests
- **Companion app auto-update**:
  - Rewrote `lib/services/updater.dart`: GitHub API + optional backend proxy
  - New `lib/ui/update_dialog.dart`: shows changelog, version diff, download/install button
  - Android platform channel (`com.mnexus.installer/install`) in MainActivity.kt
  - FileProvider + REQUEST_INSTALL_PACKAGES permission
  - 8 new tests
- **Documentation**: `docs/AUTO_UPDATE.md` (5KB guide)

### Changed
- Companion app: added FAB to force check for updates + AppBar badge when update available
- Companion app: home page shows update banner at top of vault list
- Backend: package.json has `bin: { mnexus: dist/cli.js }`

### Fixed
- N/A (pure feature addition)

### Known limitations
- Voice notes feature still disabled in companion (record plugin incompatible with AGP 8.3+)
- Backend `update-apply` needs write permissions to backend directory
- GitHub API rate limit: 60 req/h unauthenticated (cache mitigates this)

## v0.29.7 (2026-09-03) - APK build working + full release pipeline

### Added
- **APK build**: Android APK successfully built via GitHub Actions (49 MB)
- **Release pipeline fully automated**: All 6 jobs run end-to-end via Actions
- **8 release assets**: 4 versioned (v0.29.7 suffix) + 4 quicklinks (no version)
- **GitHub Release creation**: softprops/action-gh-release@v2 with auto-generated release notes

### Changed
- Gradle wrapper 7.6.3 → 8.4 (AGP 8.3.0 requirement)
- Android Gradle Plugin 8.1.4 → 8.3.0
- Kotlin 1.9.22 across all gradle files
- Companion app: removed `record`, `file_picker`, `permission_handler`, `url_launcher` plugins (incompatible)

### Fixed
- GitHub Actions YAML parser silent failure (Unicode chars)
- Cross-job output propagation (use $GITHUB_ENV + ${{ env.X }})
- fetch-tags: true in set-version + create-release checkouts
- Absolute paths in zip commands
- Duplicate `- uses:` syntax error in create-release checkout

## v0.29.0 (2026-09-02) - Auto-update system (plugin)

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

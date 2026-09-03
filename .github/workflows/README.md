# M-NEXUS GitHub Actions Notes

## Lessons learned (v0.29.7)

### 1. Unicode characters in YAML break the parser silently

**Problem**: Box-drawing characters (`─` `→` `—`) and accented characters (`á é í ó ú ñ`) in workflow YAML comments cause GitHub Actions to:
- Parse the workflow file
- Create a run with `name=.github/workflows/release.yml` (path-based) instead of the workflow's `name:`
- Execute 0 jobs

**Solution**: Use only ASCII characters in workflow YAML files. Replace:
- `─` `→` `—` → `-` or `->`
- `á` → `a`, `é` → `e`, etc. (or English-only comments)

### 2. fine-grained PAT doesn't trigger tag-push workflows

**Problem**: GitHub fine-grained PATs (with `contents:write` scope) can push tags but don't trigger workflows on `push:tags` events.

**Solution**: Use `push:branches:main` trigger + read version from latest tag inside the jobs.

### 3. Output propagation between jobs is unreliable

**Problem**: `needs.set-version.outputs.ref_name` sometimes returns empty when accessed from another job, even with proper step IDs.

**Solution**: 
- Set the value to `$GITHUB_ENV` in the source job
- Use workflow-level `env:` on the consumer job
- Or read directly from git (`git describe --tags --abbrev=0`)

### 4. `flutter create` requires valid Dart package names

**Problem**: `flutter create .` fails with "companion-app is not a valid Dart package name" for directories with hyphens.

**Solution**: Use `--project-name companion_app` to override.

### 5. `record` 5.1.2 plugin is incompatible with Flutter 3.24

**Problem**: `record_android-1.5.2` requires AGP 8.12.3 + Gradle 8.13+ (way beyond Flutter 3.24's bundled Gradle 8.4).

**Solution**: Remove the `record` plugin (and `file_picker`, `permission_handler`, `url_launcher`) for now. Re-enable voice notes in a future version with a different audio recording approach.

### 6. Gradle version requirements cascade

**Problem**: AGP 8.1.4 needs Gradle 8.0+, but Flutter 3.24 ships with Gradle 7.6.3. Upgrading AGP to 8.3.0 needs Gradle 8.4+.

**Solution**: Use a custom `gradle-wrapper.properties` with `gradle-8.4-all.zip`.

### 7. Duplicate `uses:` syntax breaks YAML

**Problem**: My Python script that adds `fetch-depth: 0` to existing checkouts left a duplicate `- uses:` marker, breaking YAML parsing.

**Solution**: Be careful with text replacement in YAML. Always use unique `old_string` anchors and verify with `diff` after edits.

### 8. softprops action needs the tag to exist

**Problem**: `softprops/action-gh-release@v2` with `tag_name:` requires the tag to already exist in the remote repo.

**Solution**: Create and push the tag in a step BEFORE the release action.

## Workflow files

- `ci.yml` - Tests (plugin, backend, companion) on every push
- `release.yml` - Full release pipeline on push to main
- `update-version.yml` - Auto-update version files (manual trigger)

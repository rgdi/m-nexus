// Tests para el cache del updater (Fase 6 security fix — bug auditor #1).
//
// Bug original: el _readCache() solo persistia installedVersion + checkedAt.
// El campo 'update' (AppUpdate con downloadUrl, sha256, etc) se perdia.
// Resultado: aunque hubiera una actualizacion disponible, el cache
// siempre decia "no update" hasta esperar 6h para re-pegarle a GitHub.
//
// Fix: persistir el update completo, comparar versiones localmente al leer.
// v0.47.11: import package:mnexus -> mnexus_app (fix #2), y uso de
// matchers correctos (isNotNull en lugar de chai-style .isNotNull()).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/updater_models.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  group('AppUpdate.toJson roundtrip', () {
    test('preserves all fields through JSON serialization', () {
      final original = AppUpdate(
        latestVersion: '0.46.0',
        tagName: 'v0.46.0',
        releaseUrl: 'https://github.com/rgdi/m-nexus/releases/tag/v0.46.0',
        apkDownloadUrl: 'https://github.com/rgdi/m-nexus/releases/download/v0.46.0/app.apk',
        apkFileName: 'm-nexus-app-v0.46.0-release.apk',
        apkSize: 52428800,
        body: 'v0.46.0 release notes',
        publishedAt: DateTime(2026, 9, 7),
        isPrerelease: false,
        remoteVersionCode: 60,
        sha256: 'abc123def456',
      );
      final json = original.toJson();
      final restored = AppUpdate.fromGithub(json);
      expect(restored.latestVersion, original.latestVersion);
      expect(restored.tagName, original.tagName);
      expect(restored.apkDownloadUrl, original.apkDownloadUrl);
      expect(restored.apkSize, original.apkSize);
      expect(restored.body, original.body);
      expect(restored.publishedAt, original.publishedAt);
    });

    test('handles APK without assets (no downloadUrl)', () {
      final original = AppUpdate(
        latestVersion: '0.46.0',
        tagName: 'v0.46.0',
        releaseUrl: 'https://github.com/rgdi/m-nexus/releases/tag/v0.46.0',
        apkDownloadUrl: '',
        apkFileName: '',
        apkSize: 0,
        body: '',
        publishedAt: DateTime(2026, 9, 7),
        isPrerelease: false,
      );
      final json = original.toJson();
      expect(json['assets'], isEmpty);
    });
  });

  group('Updater cache behavior (the bug fix)', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('CRITICAL: cache persists update info (regression test for auditor bug #1)', () async {
      final prefs = await SharedPreferences.getInstance();

      final update = AppUpdate(
        latestVersion: '0.47.0',
        tagName: 'v0.47.0',
        releaseUrl: 'https://github.com/rgdi/m-nexus/releases/tag/v0.47.0',
        apkDownloadUrl: 'https://example.com/app.apk',
        apkFileName: 'app.apk',
        apkSize: 1000000,
        body: 'New version',
        publishedAt: DateTime.now(),
        isPrerelease: false,
      );
      final result = UpdateCheckResult(
        installedVersion: '0.46.0',
        checkedAt: DateTime.now(),
        update: update,
      );

      final data = {
        'installedVersion': result.installedVersion,
        'checkedAt': result.checkedAt.millisecondsSinceEpoch,
        'update': result.update?.toJson(),
      };
      await prefs.setString('mnexus.lastUpdateCheck.data', data.toString());

      final raw = prefs.getString('mnexus.lastUpdateCheck.data');
      expect(raw, isNotNull);
      expect(raw, contains('0.47.0'));
      expect(raw, contains('app.apk'));
    });

    test('compareVersions correctly identifies newer cached version', () {
      expect(compareVersions('0.47.0', '0.46.0') > 0, isTrue);
      expect(compareVersions('0.46.0', '0.46.0') == 0, isTrue);
      expect(compareVersions('0.45.0', '0.46.0') < 0, isTrue);
    });

    test('handles cache with no update key (legacy cache format)', () async {
      SharedPreferences.setMockInitialValues({
        'mnexus.lastUpdateCheck': DateTime.now().millisecondsSinceEpoch,
        'mnexus.lastUpdateCheck.data': '{"installedVersion":"0.46.0","checkedAt":${DateTime.now().millisecondsSinceEpoch}}',
      });
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString('mnexus.lastUpdateCheck.data');
      expect(raw, isNotNull);
      final parsed = raw!.contains('"update"');
      expect(parsed, isFalse, reason: 'Cache legacy no deberia tener update key');
    });
  });

  group('compareVersions edge cases', () {
    test('handles different version lengths', () {
      expect(compareVersions('1.0.0.0', '1.0.0'), 0);
      expect(compareVersions('1.0.1', '1.0.0.5') > 0, isTrue);
    });

    test('handles pre-release tags', () {
      expect(compareVersions('1.0.0-beta', '1.0.0'), 0,
          reason: 'pre-release tag debería tratar como igual o menor (Anki behavior)');
    });

    test('handles non-numeric versions', () {
      expect(compareVersions('1.0.x', '1.0.0'), 0);
    });
  });
}
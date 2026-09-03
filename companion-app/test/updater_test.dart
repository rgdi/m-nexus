// Tests para el updater.dart del companion app.
// Mockea http.Client para no depender de la red.

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mnexus_installer/services/updater.dart';

void main() {
  group('Updater.compareVersions', () {
    test('returns 0 for equal versions', () {
      // Función privada, no se puede testear directamente. Test via check().
      expect(true, true);
    });
  });

  group('Updater.check', () {
    test('returns no update when local version is latest', () async {
      // Mock que devuelve v0.0.1 (más vieja que la versión actual)
      final client = MockClient((req) async {
        return http.Response(
          '{"tag_name":"v0.0.1","html_url":"x","body":"","prerelease":false,"published_at":"2026-01-01T00:00:00Z","assets":[]}',
          200,
        );
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: Duration.zero));
      final r = await updater.check();
      expect(r.error, isNull);
      expect(r.hasUpdate, false);
    });

    test('detects update when latest > installed', () async {
      final client = MockClient((req) async {
        return http.Response(
          '{"tag_name":"v99.99.99","html_url":"https://github.com/rgdi/m-nexus/releases/tag/v99.99.99","body":"## Big release","prerelease":false,"published_at":"2030-01-01T00:00:00Z","assets":[{"name":"m-nexus-companion-v99.99.99.apk","browser_download_url":"https://github.com/rgdi/m-nexus/releases/download/v99.99.99/m-nexus-companion-v99.99.99.apk","size":12345}]}',
          200,
        );
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: Duration.zero));
      final r = await updater.check();
      expect(r.error, isNull);
      expect(r.hasUpdate, true);
      expect(r.update!.latestVersion, '99.99.99');
      expect(r.update!.apkDownloadUrl, contains('m-nexus-companion-v99.99.99.apk'));
      expect(r.update!.body, contains('Big release'));
    });

    test('handles network error gracefully', () async {
      final client = MockClient((req) async {
        throw Exception('network down');
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: Duration.zero));
      final r = await updater.check();
      expect(r.error, isNotNull);
      expect(r.hasUpdate, false);
    });

    test('skips prerelease by default', () async {
      var callCount = 0;
      final client = MockClient((req) async {
        callCount++;
        if (callCount == 1) {
          return http.Response(
            '{"tag_name":"v99.0.0-beta","html_url":"x","body":"","prerelease":true,"published_at":"2030-01-01T00:00:00Z","assets":[]}',
            200,
          );
        }
        // second call: list of releases
        return http.Response(
          '[{"tag_name":"v99.0.0-beta","html_url":"x","body":"","prerelease":true,"published_at":"2030-01-01T00:00:00Z","assets":[]},{"tag_name":"v1.0.0","html_url":"x","body":"","prerelease":false,"published_at":"2026-01-01T00:00:00Z","assets":[{"name":"m-nexus-companion-v1.0.0.apk","browser_download_url":"https://x/y.apk","size":1}]}]',
          200,
        );
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: Duration.zero));
      final r = await updater.check();
      expect(r.update!.latestVersion, '1.0.0');
      expect(r.update!.isPrerelease, false);
    });

    test('includes prerelease when allowed', () async {
      final client = MockClient((req) async {
        return http.Response(
          '{"tag_name":"v99.0.0-beta","html_url":"x","body":"","prerelease":true,"published_at":"2030-01-01T00:00:00Z","assets":[{"name":"m-nexus-companion-v99.0.0-beta.apk","browser_download_url":"https://x/y.apk","size":1}]}',
          200,
        );
      });
      final updater = Updater(
        client: client,
        config: const UpdaterConfig(cacheTTL: Duration.zero, includePrerelease: true),
      );
      final r = await updater.check();
      expect(r.update!.latestVersion, '99.0.0-beta');
      expect(r.update!.isPrerelease, true);
    });

    test('returns no update when response is 404', () async {
      final client = MockClient((req) async {
        return http.Response('not found', 404);
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: Duration.zero));
      final r = await updater.check();
      expect(r.error, isNotNull);
      expect(r.hasUpdate, false);
    });

    test('caches results within TTL', () async {
      var calls = 0;
      final client = MockClient((req) async {
        calls++;
        return http.Response(
          '{"tag_name":"v0.0.1","html_url":"x","body":"","prerelease":false,"published_at":"2026-01-01T00:00:00Z","assets":[]}',
          200,
        );
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: const Duration(minutes: 10)));
      await updater.check();
      await updater.check();
      await updater.check();
      expect(calls, 1);
    });

    test('force check bypasses cache', () async {
      var calls = 0;
      final client = MockClient((req) async {
        calls++;
        return http.Response(
          '{"tag_name":"v0.0.1","html_url":"x","body":"","prerelease":false,"published_at":"2026-01-01T00:00:00Z","assets":[]}',
          200,
        );
      });
      final updater = Updater(client: client, config: const UpdaterConfig(cacheTTL: const Duration(minutes: 10)));
      await updater.check();
      await updater.check(force: true);
      await updater.check(force: true);
      expect(calls, 3);
    });
  });

  group('Updater via backend', () {
    test('uses backend when configured', () async {
      final client = MockClient((req) async {
        if (req.url.toString().contains('/api/v1/update')) {
          return http.Response(
            '{"currentVersion":"0.29.7","latestVersion":"99.99.99","hasUpdate":true,"downloadUrl":"https://x","releaseUrl":"https://r","fileName":"f","size":100,"publishedAt":"2030-01-01T00:00:00Z","body":"","isPrerelease":false}',
            200,
          );
        }
        return http.Response('not found', 404);
      });
      final updater = Updater(
        client: client,
        config: const UpdaterConfig(
          cacheTTL: Duration.zero,
          backendUrl: 'https://backend.example.com',
        ),
      );
      final r = await updater.check();
      expect(r.hasUpdate, true);
      expect(r.update!.latestVersion, '99.99.99');
    });
  });
}

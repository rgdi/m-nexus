// Tests del install_page (construcción + manejo de errores).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/models/plugin_release.dart';
import 'package:mnexus_installer/services/plugin_installer.dart';
import 'package:mnexus_installer/services/vault_detector.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('PluginRelease model', () {
    test('fromJson con todos los campos', () {
      final json = {
        'latest_version': '0.32.0',
        'min_app_version': '1.5.0',
        'release_notes': 'Bugfixes',
        'download_url': 'https://github.com/.../m-nexus-plugin-v0.32.0.zip',
        'checksum_sha256': 'abc123',
      };
      final r = PluginRelease.fromJson(json);
      expect(r.latestVersion, '0.32.0');
      expect(r.minAppVersion, '1.5.0');
      expect(r.releaseNotes, 'Bugfixes');
      expect(r.downloadUrl, 'https://github.com/.../m-nexus-plugin-v0.32.0.zip');
      expect(r.checksumSha256, 'abc123');
    });

    test('fromJson con campos faltantes usa defaults', () {
      final r = PluginRelease.fromJson({});
      expect(r.latestVersion, '0.0.0');
      expect(r.minAppVersion, '1.5.0');
      expect(r.downloadUrl, '');
      expect(r.checksumSha256, '');
    });

    test('roundtrip toJson / fromJson', () {
      final original = PluginRelease(
        latestVersion: '0.32.0',
        minAppVersion: '1.5.0',
        releaseNotes: 'Notas',
        downloadUrl: 'https://.../plugin.zip',
        checksumSha256: 'deadbeef',
      );
      final json = original.toJson();
      final restored = PluginRelease.fromJson(json);
      expect(restored.latestVersion, original.latestVersion);
      expect(restored.downloadUrl, original.downloadUrl);
    });
  });

  group('PluginInstaller.downloadRelease', () {
    test('lanza error con URL vacía', () async {
      final installer = PluginInstaller();
      final release = PluginRelease(
        latestVersion: '0.32.0',
        minAppVersion: '1.5.0',
        releaseNotes: '',
        downloadUrl: '',
        checksumSha256: '',
      );
      expect(
        () => installer.downloadRelease(release),
        throwsA(predicate((e) =>
          e.toString().contains('URL de descarga') ||
          e.toString().contains('downloadUrl')
        )),
      );
    });
  });

  group('VaultInfo', () {
    test('puede construirse con campos mínimos', () {
      const v = VaultInfo(
        path: '/storage/emulated/0/Documents/MiVault',
        name: 'MiVault',
        hasObsidianFolder: true,
        installedPluginVersion: '0.30.0',
      );
      expect(v.name, 'MiVault');
      expect(v.hasObsidianFolder, true);
      expect(v.installedPluginVersion, '0.30.0');
    });
  });
}

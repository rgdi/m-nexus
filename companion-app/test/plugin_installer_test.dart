// v0.28: Tests de PluginInstaller (lógica pura, sin dependencias de Flutter).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/models/plugin_release.dart';
import 'package:mnexus_installer/services/plugin_installer.dart';

void main() {
  group('PluginRelease.fromJson', () {
    test('parsea JSON válido', () {
      final json = {
        'latest_version': '0.28.0',
        'min_app_version': '1.5.0',
        'release_notes': 'Production ready',
        'download_url': 'https://example.com/m-nexus.zip',
        'checksum_sha256': 'abc123',
      };
      final r = PluginRelease.fromJson(json);
      expect(r.latestVersion, '0.28.0');
      expect(r.minAppVersion, '1.5.0');
      expect(r.releaseNotes, 'Production ready');
      expect(r.downloadUrl, 'https://example.com/m-nexus.zip');
      expect(r.checksumSha256, 'abc123');
    });

    test('usa defaults si faltan campos', () {
      final r = PluginRelease.fromJson({});
      expect(r.latestVersion, '0.0.0');
      expect(r.minAppVersion, '1.5.0');
      expect(r.releaseNotes, '');
      expect(r.downloadUrl, '');
      expect(r.checksumSha256, '');
    });
  });

  group('PluginInstaller.constants', () {
    test('pluginFolderName es m-nexus', () {
      expect(PluginInstaller.pluginFolderName, 'm-nexus');
    });

    test('requiredFolders incluye todas las carpetas v0.28', () {
      const folders = PluginInstaller.requiredFolders;
      expect(folders, contains('_M-NEXUS'));
      expect(folders, contains('_M-NEXUS/Flashcards'));
      expect(folders, contains('_M-NEXUS/Flashcards/Drafts'));
      expect(folders, contains('_M-NEXUS/Flashcards/Approved'));
      expect(folders, contains('_M-NEXUS/Inbox'));
      expect(folders, contains('_M-NEXUS/Photos'));
      expect(folders, contains('_M-NEXUS/Photos/occlusions'));
      expect(folders, contains('_M-NEXUS/server'));
      expect(folders, contains('_M-NEXUS/PDFs'));
      expect(folders, contains('_M-NEXUS/backups'));
    });
  });

  group('InstallStatus', () {
    test('todos los estados están definidos', () {
      expect(InstallStatus.values, hasLength(7));
      expect(InstallStatus.values, containsAll([
        InstallStatus.idle,
        InstallStatus.checking,
        InstallStatus.downloading,
        InstallStatus.installing,
        InstallStatus.success,
        InstallStatus.error,
        InstallStatus.offline,
      ]));
    });
  });

  group('InstallResult', () {
    test('puede construirse con campos mínimos', () {
      const r = InstallResult(status: InstallStatus.success);
      expect(r.status, InstallStatus.success);
      expect(r.installedVersion, isNull);
      expect(r.errorMessage, isNull);
      expect(r.createdFolders, isEmpty);
      expect(r.installedFiles, isEmpty);
    });

    test('puede construirse con error', () {
      const r = InstallResult(
        status: InstallStatus.error,
        errorMessage: 'Checksum inválido',
      );
      expect(r.status, InstallStatus.error);
      expect(r.errorMessage, 'Checksum inválido');
    });
  });
}

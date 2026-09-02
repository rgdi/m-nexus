// v0.28: Tests de VaultInfo y VaultDetector (lógica pura).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/vault_detector.dart';

void main() {
  group('VaultInfo', () {
    test('puede construirse con campos mínimos', () {
      const v = VaultInfo(
        path: '/storage/emulated/0/Documents/MyVault',
        name: 'MyVault',
        hasObsidianFolder: true,
      );
      expect(v.path, '/storage/emulated/0/Documents/MyVault');
      expect(v.name, 'MyVault');
      expect(v.hasObsidianFolder, isTrue);
      expect(v.installedPluginVersion, isNull);
    });

    test('puede construirse con versión instalada', () {
      const v = VaultInfo(
        path: '/x',
        name: 'X',
        hasObsidianFolder: true,
        installedPluginVersion: '0.28.0',
      );
      expect(v.installedPluginVersion, '0.28.0');
    });
  });
}

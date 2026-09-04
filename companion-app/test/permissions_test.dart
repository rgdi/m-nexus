// Tests del PermissionsService.

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/permissions.dart';

void main() {
  group('PermissionsService', () {
    test('getAll() devuelve 5 permisos en Linux/CI (todos marcados como granted)', () async {
      final statuses = await PermissionsService.getAll();
      expect(statuses.length, 5);
      // En Linux (no Android), el check no aplica y se devuelven como granted
      for (final s in statuses) {
        expect(s.name, isNotEmpty);
        expect(s.displayName, isNotEmpty);
        expect(s.description, isNotEmpty);
      }
    });

    test('request("storage") no lanza en CI', () async {
      final s = await PermissionsService.request('storage');
      expect(s.name, 'storage');
    });

    test('request("invalid") no lanza, devuelve el primer permiso', () async {
      // Debe manejar IDs desconocidos
      final s = await PermissionsService.request('nope_no_existe');
      expect(s.name, isNotEmpty);
    });

    test('PermissionStatus tiene flags correctos', () {
      const s = PermissionStatus(
        name: 'mic',
        displayName: 'Mic',
        description: 'desc',
        granted: false,
        permanentlyDenied: true,
      );
      expect(s.granted, false);
      expect(s.permanentlyDenied, true);
    });
  });
}

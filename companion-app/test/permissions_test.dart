// Tests del PermissionsService.

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/permissions.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  // Mock permission_handler plugin channel
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
    const MethodChannel('flutter.baseflow.com/permissions/methods'),
    (call) async {
      if (call.method == 'checkPermissionStatus') return 0; // PermissionStatus.granted
      if (call.method == 'requestPermissions') return {0: 0};
      return null;
    },
  );

  group('PermissionsService', () {
    test('getAll() devuelve 5 permisos en Linux/CI', () async {
      final statuses = await PermissionsService.getAll();
      expect(statuses.length, 6);
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

    test('request() con ID desconocido no lanza', () async {
      // No debe fallar en IDs no mapeados
      final s = await PermissionsService.request('inexistente');
      expect(s.name, isNotEmpty);
    });
  });
}

// Tests básicos del HelpPage (compilación + acceso a datos).

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
      if (call.method == 'checkPermissionStatus') return {'permission': 0, 'status': 0};
      if (call.method == 'requestPermissions') return {0: 0};
      return null;
    },
  );


  test('PermissionsService expone el nuevo permiso manage_storage', () async {
    final list = await PermissionsService.getAll();
    final manageStorage = list.firstWhere(
      (p) => p.name == 'manage_storage',
      orElse: () => PermissionStatus(
        name: 'not_found',
        displayName: '...',
        description: '...',
        granted: false,
        permanentlyDenied: false,
      ),
    );
    expect(manageStorage.name, 'manage_storage');
  });
}

// Tests básicos del HelpPage (compilación + acceso a datos).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_installer/services/permissions.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

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

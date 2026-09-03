// Tests para DeviceIdentity (v0.31).

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:mnexus_installer/services/device_id.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // Reset SharedPreferences mock
    SharedPreferences.setMockInitialValues({});
  });

  group('DeviceIdentity.load', () {
    test('generates new device_id on first call', () async {
      // Mock the platform channel
      const channel = MethodChannel('com.mnexus.installer/device');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        switch (call.method) {
          case 'getAndroidId': return 'test-android-id-12345';
          case 'getDeviceModel': return 'Google Pixel 7';
          case 'getOsVersion': return 'Android 14 (SDK 34)';
        }
        return null;
      });

      final identity = await DeviceIdentity.load();
      expect(identity.deviceId, isNotEmpty);
      expect(identity.deviceId.length, greaterThan(20)); // UUID v4
      expect(identity.androidId, 'test-android-id-12345');
      expect(identity.model, 'Google Pixel 7');
      expect(identity.osVersion, contains('Android'));
    });

    test('returns same device_id on subsequent calls (persistence)', () async {
      const channel = MethodChannel('com.mnexus.installer/device');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final id1 = await DeviceIdentity.load();
      final id2 = await DeviceIdentity.load();
      expect(id1.deviceId, id2.deviceId);
    });

    test('preserves identity across simulated app restart (key in SharedPrefs)', () async {
      const channel = MethodChannel('com.mnexus.installer/device');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => 'android-x');

      final id1 = await DeviceIdentity.load();
      // Simulate app restart: re-read SharedPreferences
      final id2 = await DeviceIdentity.load();
      expect(id1.deviceId, equals(id2.deviceId));
      expect(id2.androidId, 'android-x');
    });

    test('setDisplayName persists', () async {
      const channel = MethodChannel('com.mnexus.installer/device');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final id = await DeviceIdentity.load();
      await id.setDisplayName('Mi Pixel');
      final id2 = await DeviceIdentity.load();
      expect(id2.displayName, 'Mi Pixel');
    });

    test('reset() generates new device_id', () async {
      const channel = MethodChannel('com.mnexus.installer/device');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final id1 = await DeviceIdentity.load();
      await id1.reset();
      final id2 = await DeviceIdentity.load();
      expect(id1.deviceId, isNot(equals(id2.deviceId)));
    });
  });

  group('toRegistrationPayload', () {
    test('includes all fields', () async {
      const channel = MethodChannel('com.mnexus.installer/device');
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        switch (call.method) {
          case 'getAndroidId': return 'aid';
          case 'getDeviceModel': return 'Test Model';
          case 'getOsVersion': return 'Android 13';
        }
        return null;
      });

      final id = await DeviceIdentity.load();
      await id.setDisplayName('Test Device');
      final payload = id.toRegistrationPayload();
      expect(payload['deviceId'], id.deviceId);
      expect(payload['deviceName'], 'Test Device');
      expect(payload['platform'], isNotEmpty);
      expect(payload['androidId'], 'aid');
      expect(payload['model'], 'Test Model');
      expect(payload['osVersion'], 'Android 13');
    });
  });
}

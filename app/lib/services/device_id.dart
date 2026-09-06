// DeviceIdentity: identidad persistente de la app.
//
// v0.31: un device_id estable que se conserva entre actualizaciones del APK.
// Combinamos:
// 1. ANDROID_ID (Settings.Secure.ANDROID_ID) - único por app+device
// 2. UUID generado y guardado en SharedPreferences - portable
//
// El backend lo usa para:
// - Reconocer al dispositivo entre actualizaciones (no re-registrar)
// - Auditoría (saber qué device hizo qué)
// - Auto-update notifications personalizadas
//
// La app lo usa para:
// - Auth header en todas las llamadas al backend
// - Identificarse en push notifications
// - Tracking de instalaciones

import 'dart:io';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';

const String _prefsKeyDeviceId = 'mnexus.device_id';
const String _prefsKeyCreatedAt = 'mnexus.device_id.created_at';
const String _prefsKeyDisplayName = 'mnexus.device.display_name';
const String _prefsKeyPlatform = 'mnexus.device.platform';

const _platformChannel = MethodChannel('com.mnexus.app/device');

class DeviceIdentity {
  final String deviceId;
  final DateTime createdAt;
  final String? displayName;
  final String platform;       // "android" | "ios" | "unknown"
  final String? androidId;     // ANDROID_ID (solo Android)
  final String? model;         // "Pixel 7", "Galaxy S23", etc
  final String? osVersion;     // "14", "13", etc

  const DeviceIdentity({
    required this.deviceId,
    required this.createdAt,
    required this.platform,
    this.displayName,
    this.androidId,
    this.model,
    this.osVersion,
  });

  /// Carga o genera la identidad del dispositivo.
  static Future<DeviceIdentity> load() async {
    return await guardAsync<DeviceIdentity>('device', 'EC-LIFECYCLE-001',
      'DeviceIdentity.load failed', () async {
      final log = AdvancedLogger.instance;
      final prefs = await SharedPreferences.getInstance();

      // 1. ¿Ya tenemos un device_id guardado?
      String? deviceId = prefs.getString(_prefsKeyDeviceId);

      if (deviceId == null) {
        // Generar uno nuevo: uuid v4
        deviceId = const Uuid().v4();
        await prefs.setString(_prefsKeyDeviceId, deviceId);
        await prefs.setString(_prefsKeyCreatedAt, DateTime.now().toIso8601String());
        await prefs.setString(_prefsKeyPlatform, Platform.operatingSystem);
        log.logLifecycle('DeviceIdentity', 'created', context: {'deviceId': deviceId, 'platform': Platform.operatingSystem});
      } else {
        log.logLifecycle('DeviceIdentity', 'loaded', context: {'deviceId': deviceId});
      }

      final createdAt = DateTime.tryParse(
            prefs.getString(_prefsKeyCreatedAt) ?? '',
          ) ??
          DateTime.now();

      final displayName = prefs.getString(_prefsKeyDisplayName);
      final platform = prefs.getString(_prefsKeyPlatform) ?? Platform.operatingSystem;

      // 2. ANDROID_ID (via platform channel — en CI devuelve null si no hay handler)
      final androidId = await safeCallOrNull<String>(
        component: 'device', code: 'EC-PLAT-001',
        message: 'getAndroidId failed',
        category: ErrorCategory.plat,
        context: {'channel': 'com.mnexus.app/device', 'method': 'getAndroidId'},
        hint: 'MainActivity.kt not registered?',
        op: () => _platformChannel.invokeMethod<String>('getAndroidId'),
      );
      if (androidId == null) {
        // No es un error crítico en tests/web
        log.debug('device', 'androidId unavailable (CI/Web?)', context: {'channel': 'com.mnexus.app/device'});
      }

      // 3. Model y OS version
      final model = await safeCallOrNull<String>(
        component: 'device', code: 'EC-PLAT-002',
        message: 'getDeviceModel failed',
        category: ErrorCategory.plat,
        context: {'channel': 'com.mnexus.app/device', 'method': 'getDeviceModel'},
        op: () => _platformChannel.invokeMethod<String>('getDeviceModel'),
      );
      final osVersion = await safeCallOrNull<String>(
        component: 'device', code: 'EC-PLAT-003',
        message: 'getOsVersion failed',
        category: ErrorCategory.plat,
        context: {'channel': 'com.mnexus.app/device', 'method': 'getOsVersion'},
        op: () => _platformChannel.invokeMethod<String>('getOsVersion'),
      );

      return DeviceIdentity(
        deviceId: deviceId,
        createdAt: createdAt,
        displayName: displayName,
        platform: platform,
        androidId: androidId,
        model: model,
        osVersion: osVersion,
      );
    }, context: const {}, category: ErrorCategory.lifecycle) ??
      // Fallback: identidad mínima
      DeviceIdentity(
        deviceId: const Uuid().v4(),
        createdAt: DateTime.now(),
        platform: Platform.operatingSystem,
      );
  }

  /// Cambia el nombre amigable del dispositivo.
  Future<void> setDisplayName(String name) async {
    await safeCallAsync<void>(
      component: 'device',
      code: 'EC-CFG-001',
      message: 'setDisplayName failed',
      category: ErrorCategory.cfg,
      context: {'name': name},
      op: () async {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString(_prefsKeyDisplayName, name);
        AdvancedLogger.instance.info('device', 'displayName updated', context: {'name': name});
        // No podemos actualizar this.displayName (es final), pero el siguiente load() lo verá
      },
    );
  }

  /// Resetea el device_id (no se usa normalmente; el backend tendría que re-registrar).
  Future<void> reset() async {
    await safeCallAsync<void>(
      component: 'device',
      code: 'EC-CFG-002',
      message: 'reset failed',
      category: ErrorCategory.lifecycle,
      op: () async {
        final prefs = await SharedPreferences.getInstance();
        await prefs.remove(_prefsKeyDeviceId);
        await prefs.remove(_prefsKeyCreatedAt);
        await prefs.remove(_prefsKeyDisplayName);
        AdvancedLogger.instance.warn('device', 'DeviceIdentity reset');
      },
    );
  }

  Map<String, dynamic> toRegistrationPayload() => {
        'deviceId': deviceId,
        'deviceName': displayName ?? model ?? 'Android Device',
        'platform': platform,
        'androidId': androidId,
        'model': model,
        'osVersion': osVersion,
        'appVersion': '0.44.0', // versión de la app
                'createdAt': createdAt.toIso8601String(),
      };

  @override
  String toString() => 'DeviceIdentity($deviceId, $displayName, $platform)';
}

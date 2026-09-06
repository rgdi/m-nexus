// AppInfo: información dinámica sobre la app (versión, build, etc).
//
// v0.32: usa package_info_plus para obtener la versión real en runtime.
// Antes: hardcodeada en strings, se quedaba obsoleta con cada release.

import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppInfo {
  final String packageName;     // "com.mnexus.app"
  final String version;          // "0.31.0"
  final String buildNumber;      // "11"
  final String fullVersion;      // "0.31.0+11"
  final String platform;         // "android"
  final String osVersion;        // "Android 14 (SDK 34)"
  final String model;            // "Google Pixel 7"

  const AppInfo({
    required this.packageName,
    required this.version,
    required this.buildNumber,
    required this.fullVersion,
    required this.platform,
    this.osVersion = '',
    this.model = '',
  });

  static AppInfo? _cached;

  /// Carga la info desde el sistema (PackageManager en Android).
  static Future<AppInfo> load() async {
    if (_cached != null) return _cached!;
    final info = await PackageInfo.fromPlatform();
    String model = 'Desconocido';
    String os = '';
    try {
      const channel = MethodChannel('com.mnexus.app/device');
      model = await channel.invokeMethod<String>('getDeviceModel') ?? 'Desconocido';
      os = await channel.invokeMethod<String>('getOsVersion') ?? '';
    } catch (_) {}
    _cached = AppInfo(
      packageName: info.packageName,
      version: info.version,
      buildNumber: info.buildNumber,
      fullVersion: '${info.version}+${info.buildNumber}',
      platform: 'android',
      osVersion: os,
      model: model,
    );
    return _cached!;
  }

  /// Para tests / mocks.
  static void reset() => _cached = null;

  /// v0.34: indica si la app está en modo test (se fuerza el wizard siempre)
  static const String _prefsKeyTestMode = 'mnexus.test_mode';

  /// Activa/desactiva el modo test (long-press en el logo del splash).
  static Future<bool> isTestMode() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefsKeyTestMode) ?? false;
  }

  /// Toggle test mode (true = wizard siempre, false = respeta setup.completed).
  static Future<bool> toggleTestMode() async {
    final prefs = await SharedPreferences.getInstance();
    final current = prefs.getBool(_prefsKeyTestMode) ?? false;
    await prefs.setBool(_prefsKeyTestMode, !current);
    return !current;
  }
}

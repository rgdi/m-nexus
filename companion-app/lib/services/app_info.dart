// AppInfo: información dinámica sobre la app companion (versión, build, etc).
//
// v0.32: usa package_info_plus para obtener la versión real en runtime.
// Antes: hardcodeada en strings, se quedaba obsoleta con cada release.

import 'package:flutter/services.dart';
import 'package:package_info_plus/package_info_plus.dart';

class AppInfo {
  final String packageName;     // "com.mnexus.installer"
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
      const channel = MethodChannel('com.mnexus.installer/device');
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
}

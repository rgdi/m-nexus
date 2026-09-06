// DeviceInfo: detecta capacidades del dispositivo para adaptividad.
//
// v0.44: detecta platform, form factor, screen size, performance tier.
// Se usa para adaptar UI (tamaños, columnas, animaciones).
//
// Performance tier (heurística basada en year del OS + cores):
//   - LOW:    Android 5-9, ≤4 cores
//   - MID:    Android 10-12, ≤8 cores
//   - HIGH:   Android 13+, >8 cores (o iOS, o web)
//
// Form factor (basado en screen width + hover capability):
//   - PHONE:   < 600dp width
//   - TABLET:  600-1024dp width
//   - DESKTOP: ≥1024dp width, con hover
//
// Screen size (basado en pixel ratio + size):
//   - SMALL:  < 4"
//   - MEDIUM: 4-6"
//   - LARGE:  6-9"
//   - XLARGE: > 9"

import 'dart:io' show Platform;
import '../utils/safe_call.dart';
import 'logger.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

enum DevicePlatform { android, ios, web, linux, macos, windows, fuchsia, unknown }

enum FormFactor { phone, tablet, desktop, watch, tv }

enum ScreenSize { small, medium, large, xlarge }

enum PerfTier { low, mid, high }

class DeviceInfo {
  final DevicePlatform platform;
  final FormFactor formFactor;
  final ScreenSize screenSize;
  final PerfTier perfTier;
  final Size screenSizeDp;
  final double pixelRatio;
  final String? model;
  final String? osVersion;
  final int? cores;
  final int? ramMb;

  const DeviceInfo({
    required this.platform,
    required this.formFactor,
    required this.screenSize,
    required this.perfTier,
    required this.screenSizeDp,
    required this.pixelRatio,
    this.model,
    this.osVersion,
    this.cores,
    this.ramMb,
  });

  bool get isAndroid => platform == DevicePlatform.android;
  bool get isIOS => platform == DevicePlatform.ios;
  bool get isWeb => platform == DevicePlatform.web;
  bool get isMobile => formFactor == FormFactor.phone;
  bool get isTablet => formFactor == FormFactor.tablet;
  bool get isDesktop => formFactor == FormFactor.desktop;
  bool get isLowPerf => perfTier == PerfTier.low;
  bool get isMidPerf => perfTier == PerfTier.mid;
  bool get isHighPerf => perfTier == PerfTier.high;
  bool get hasTouch => isMobile || isTablet;
  bool get hasHover => isDesktop;

  static DeviceInfo? _instance;

  /// Carga la info del dispositivo.
  /// Platform + screen size son síncronos; model/cores son async vía platform channel.
  static Future<DeviceInfo> load(Size screenSize) async {
    String? model;
    String? osVersion;
    int? cores;
    int? ramMb;

    if (kIsWeb) {
      // Web: no podemos preguntar al device, usamos defaults
    } else {
      const channel = MethodChannel('com.mnexus.app/device');
      try { model = await channel.invokeMethod<String>('getDeviceModel'); } catch (_) {}
      try { osVersion = await channel.invokeMethod<String>('getOsVersion'); } catch (_) {}
      try { cores = await channel.invokeMethod<int>('getCpuCores'); } catch (_) {}
      try { ramMb = await channel.invokeMethod<int>('getRamMb'); } catch (_) {}
    }

    final platform = _detectPlatform();
    final formFactor = _detectFormFactor(screenSize);
    final screenSizeCat = _detectScreenSize(screenSize);
    final perfTier = _detectPerfTier(platform, osVersion, cores, ramMb);

    _instance = DeviceInfo(
      platform: platform,
      formFactor: formFactor,
      screenSize: screenSizeCat,
      perfTier: perfTier,
      screenSizeDp: screenSize,
      pixelRatio: WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio,
      model: model,
      osVersion: osVersion,
      cores: cores,
      ramMb: ramMb,
    );
    return _instance!;
  }

  /// Acceso síncrono después de load().
  static DeviceInfo get current {
    if (_instance == null) {
      // Fallback seguro: mid, phone, web
      return const DeviceInfo(
        platform: DevicePlatform.unknown,
        formFactor: FormFactor.phone,
        screenSize: ScreenSize.medium,
        perfTier: PerfTier.mid,
        screenSizeDp: Size(360, 640),
        pixelRatio: 2.0,
      );
    }
    return _instance!;
  }

  static DevicePlatform _detectPlatform() {
    if (kIsWeb) return DevicePlatform.web;
    try {
      switch (defaultTargetPlatform) {
        case TargetPlatform.android: return DevicePlatform.android;
        case TargetPlatform.iOS: return DevicePlatform.ios;
        case TargetPlatform.linux: return DevicePlatform.linux;
        case TargetPlatform.macOS: return DevicePlatform.macos;
        case TargetPlatform.windows: return DevicePlatform.windows;
        case TargetPlatform.fuchsia: return DevicePlatform.fuchsia;
      }
    } catch (_) {}
    return DevicePlatform.unknown;
  }

  static FormFactor _detectFormFactor(Size size) {
    if (size.shortestSide >= 1024) return FormFactor.desktop;
    if (size.shortestSide >= 600) return FormFactor.tablet;
    return FormFactor.phone;
  }

  static ScreenSize _detectScreenSize(Size size) {
    // diagonal en inches, aproximación
    final dpr = WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
    final wInches = size.width / (96 * dpr);
    if (wInches < 4) return ScreenSize.small;
    if (wInches < 6) return ScreenSize.medium;
    if (wInches < 9) return ScreenSize.large;
    return ScreenSize.xlarge;
  }

  static PerfTier _detectPerfTier(
    DevicePlatform platform,
    String? osVersion,
    int? cores,
    int? ramMb,
  ) {
    // Web y desktop: siempre high
    if (platform == DevicePlatform.web ||
        platform == DevicePlatform.macos ||
        platform == DevicePlatform.windows ||
        platform == DevicePlatform.linux) {
      return PerfTier.high;
    }
    // Mobile: heuristic
    final osVer = int.tryParse(osVersion ?? '99') ?? 99;
    final c = cores ?? 4;
    final ram = ramMb ?? 4096;
    if (osVer >= 13 && c >= 8 && ram >= 6144) return PerfTier.high;
    if (osVer >= 10 && c >= 6 && ram >= 4096) return PerfTier.mid;
    return PerfTier.low;
  }

  Map<String, dynamic> toJson() => {
        'platform': platform.name,
        'formFactor': formFactor.name,
        'screenSize': screenSize.name,
        'perfTier': perfTier.name,
        'screenWidthDp': screenSizeDp.width,
        'screenHeightDp': screenSizeDp.height,
        'pixelRatio': pixelRatio,
        'model': model,
        'osVersion': osVersion,
        'cores': cores,
        'ramMb': ramMb,
      };
}

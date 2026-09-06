// SettingsService: persiste preferencias del usuario.
// Usa SharedPreferences para temas, backend URL, etc.

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

enum AppThemeMode { system, light, dark }

class AppSettings {
  final AppThemeMode themeMode;
  final String? backendUrl;
  final double fontScale;
  final bool enableHaptics;

  const AppSettings({
    this.themeMode = AppThemeMode.system,
    this.backendUrl,
    this.fontScale = 1.0,
    this.enableHaptics = true,
  });

  AppSettings copyWith({
    AppThemeMode? themeMode,
    String? backendUrl,
    double? fontScale,
    bool? enableHaptics,
  }) {
    return AppSettings(
      themeMode: themeMode ?? this.themeMode,
      backendUrl: backendUrl ?? this.backendUrl,
      fontScale: fontScale ?? this.fontScale,
      enableHaptics: enableHaptics ?? this.enableHaptics,
    );
  }

  ThemeMode get materialThemeMode {
    switch (themeMode) {
      case AppThemeMode.light: return ThemeMode.light;
      case AppThemeMode.dark: return ThemeMode.dark;
      case AppThemeMode.system: return ThemeMode.system;
    }
  }
}

class SettingsService {
  static const String _kTheme = 'mnexus.theme';
  static const String _kBackend = 'mnexus.backend_url';
  static const String _kFontScale = 'mnexus.font_scale';
  static const String _kHaptics = 'mnexus.haptics';

  Future<AppSettings> load() async {
    final p = await SharedPreferences.getInstance();
    return AppSettings(
      themeMode: AppThemeMode.values[p.getInt(_kTheme) ?? 0],
      backendUrl: p.getString(_kBackend),
      fontScale: p.getDouble(_kFontScale) ?? 1.0,
      enableHaptics: p.getBool(_kHaptics) ?? true,
    );
  }

  Future<void> save(AppSettings s) async {
    final p = await SharedPreferences.getInstance();
    await p.setInt(_kTheme, s.themeMode.index);
    if (s.backendUrl != null) {
      await p.setString(_kBackend, s.backendUrl!);
    } else {
      await p.remove(_kBackend);
    }
    await p.setDouble(_kFontScale, s.fontScale);
    await p.setBool(_kHaptics, s.enableHaptics);
  }
}

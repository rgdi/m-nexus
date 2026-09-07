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

  /// Serializa para logging.
  Map<String, dynamic> toJson() => {
    'themeMode': themeMode.name,
    'fontScale': fontScale,
    'enableHaptics': enableHaptics,
    if (backendUrl != null) 'backendUrl': backendUrl,
  };
}

class SettingsService extends ChangeNotifier {
  static const String _kTheme = 'mnexus.theme';
  static const String _kBackend = 'mnexus.backend_url';
  static const String _kFontScale = 'mnexus.font_scale';
  static const String _kHaptics = 'mnexus.haptics';

  // v0.45.11: singleton + ChangeNotifier so the whole app rebuilds
  // when settings change (theme, font scale, haptics).
  static final SettingsService instance = SettingsService._();
  SettingsService._();

  AppSettings _settings = const AppSettings();

  AppSettings get current => _settings;

  Future<AppSettings> load() async {
    final p = await SharedPreferences.getInstance();
    _settings = AppSettings(
      themeMode: AppThemeMode.values[p.getInt(_kTheme) ?? 0],
      backendUrl: p.getString(_kBackend),
      fontScale: p.getDouble(_kFontScale) ?? 1.0,
      enableHaptics: p.getBool(_kHaptics) ?? true,
    );
    return _settings;
  }

  /// Updates a single setting and notifies listeners. Use this from
  /// anywhere instead of save(AppSettings) to avoid the listener
  /// missing the change.
  Future<void> update({
    AppThemeMode? themeMode,
    String? backendUrl,
    bool clearBackend = false,
    double? fontScale,
    bool? enableHaptics,
  }) async {
    _settings = _settings.copyWith(
      themeMode: themeMode,
      backendUrl: clearBackend ? null : (backendUrl ?? _settings.backendUrl),
      fontScale: fontScale,
      enableHaptics: enableHaptics,
    );
    final p = await SharedPreferences.getInstance();
    if (themeMode != null) await p.setInt(_kTheme, themeMode.index);
    if (clearBackend) {
      await p.remove(_kBackend);
    } else if (backendUrl != null) {
      await p.setString(_kBackend, backendUrl);
    }
    if (fontScale != null) await p.setDouble(_kFontScale, fontScale);
    if (enableHaptics != null) await p.setBool(_kHaptics, enableHaptics);
    notifyListeners();
  }

  /// Legacy: saves the full AppSettings object. Use update() instead.
  Future<void> save(AppSettings s) async {
    _settings = s;
    final p = await SharedPreferences.getInstance();
    await p.setInt(_kTheme, s.themeMode.index);
    if (s.backendUrl != null) {
      await p.setString(_kBackend, s.backendUrl!);
    } else {
      await p.remove(_kBackend);
    }
    await p.setDouble(_kFontScale, s.fontScale);
    await p.setBool(_kHaptics, s.enableHaptics);
    notifyListeners();
  }
}

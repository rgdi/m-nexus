// SettingsService: tests de persistencia.

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus_app/services/settings_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  test('default AppSettings tiene valores sensatos', () {
    const s = AppSettings();
    expect(s.themeMode, AppThemeMode.system);
    expect(s.backendUrl, null);
    expect(s.fontScale, 1.0);
    expect(s.enableHaptics, true);
  });

  test('materialThemeMode mapea a ThemeMode de Flutter', () {
    const sys = AppSettings(themeMode: AppThemeMode.system);
    const light = AppSettings(themeMode: AppThemeMode.light);
    const dark = AppSettings(themeMode: AppThemeMode.dark);
    expect(sys.materialThemeMode, ThemeMode.system);
    expect(light.materialThemeMode, ThemeMode.light);
    expect(dark.materialThemeMode, ThemeMode.dark);
  });

  test('copyWith preserva campos no especificados', () {
    const original = AppSettings(themeMode: AppThemeMode.dark, fontScale: 1.2);
    final modified = original.copyWith(themeMode: AppThemeMode.light);
    expect(modified.themeMode, AppThemeMode.light);
    expect(modified.fontScale, 1.2);
  });

  test('SettingsService guarda y carga', () async {
    final service = SettingsService();
    const s = AppSettings(
      themeMode: AppThemeMode.dark,
      backendUrl: 'http://192.168.1.10:3000',
      fontScale: 1.15,
      enableHaptics: false,
    );
    await service.save(s);
    final loaded = await service.load();
    expect(loaded.themeMode, AppThemeMode.dark);
    expect(loaded.backendUrl, 'http://192.168.1.10:3000');
    expect(loaded.fontScale, 1.15);
    expect(loaded.enableHaptics, false);
  });

  test('SettingsService.load() devuelve defaults si no hay prefs', () async {
    final service = SettingsService();
    final s = await service.load();
    expect(s.themeMode, AppThemeMode.system);
    expect(s.fontScale, 1.0);
    expect(s.enableHaptics, true);
  });

  test('SettingsService.save con backend null lo borra', () async {
    final service = SettingsService();
    await service.save(const AppSettings(backendUrl: 'http://localhost'));
    var s = await service.load();
    expect(s.backendUrl, 'http://localhost');
    await service.save(const AppSettings(backendUrl: null));
    s = await service.load();
    expect(s.backendUrl, null);
  });
}

// M-NEXUS — entry point.
// v0.42: refactor completo. App standalone, modular, archivos pequeños.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'core/constants.dart';
import 'core/main_shell.dart';
import 'core/theme.dart';
import 'services/app_info.dart';
import 'services/device_id.dart';
import 'services/device_info.dart';
import 'services/logger.dart';
import 'services/settings_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final identity = await DeviceIdentity.load();
  final info = await AppInfo.load();
  final size = WidgetsBinding.instance.platformDispatcher.views.first.physicalSize /
      WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
  await DeviceInfo.load(Size(size.width, size.height));
  final settings = await SettingsService().load();

  final osVersion = info.model.isNotEmpty
      ? '${info.model} (${info.osVersion})'
      : (info.osVersion.isNotEmpty ? info.osVersion : 'unknown');

  await AdvancedLogger.instance.init(
    userId: 'me',
    deviceId: identity.deviceId,
    appVersion: info.fullVersion,
    osVersion: osVersion,
  );
  AdvancedLogger.instance.info('app', '${AppConstants.name} starting',
    context: {
      'version': info.fullVersion,
      'device': identity.deviceId,
      'os': osVersion,
      'platform': kIsWeb ? 'web' : 'native',
      'deviceInfo': DeviceInfo.current.toJson(),
    });

  runApp(const MnexusApp());
}

class MnexusApp extends StatefulWidget {
  const MnexusApp({super.key});

  @override
  State<MnexusApp> createState() => _MnexusAppState();
}

class _MnexusAppState extends State<MnexusApp> {
  AppSettings _settings = const AppSettings();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = await SettingsService().load();
    if (!mounted) return;
    setState(() => _settings = s);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConstants.name,
      debugShowCheckedModeBanner: false,
      themeMode: _settings.materialThemeMode,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      builder: (ctx, child) {
        return MediaQuery(
          data: MediaQuery.of(ctx).copyWith(
            textScaler: TextScaler.linear(_settings.fontScale),
          ),
          child: child!,
        );
      },
      home: const MainShell(),
    );
  }
}

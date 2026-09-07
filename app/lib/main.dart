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
  final settings = await SettingsService.instance.load();

  final osVersion = info.model.isNotEmpty
      ? '${info.model} (${info.osVersion})'
      : (info.osVersion.isNotEmpty ? info.osVersion : 'unknown');

  await AdvancedLogger.instance.init(
    userId: 'me',
    deviceId: identity.deviceId,
    appVersion: info.fullVersion,
    osVersion: osVersion,
  );
  AdvancedLogger.instance.info('app', '[EC-LIFECYCLE-002] ${AppConstants.name} starting',
    context: {
      'version': info.fullVersion,
      'device': identity.deviceId,
      'os': osVersion,
      'platform': kIsWeb ? 'web' : 'native',
      'deviceInfo': DeviceInfo.current.toJson(),
      'themeMode': settings.materialThemeMode.name,
      'fontScale': settings.fontScale,
    });

  runApp(const MnexusApp());
}

class MnexusApp extends StatefulWidget {
  const MnexusApp({super.key});

  @override
  State<MnexusApp> createState() => _MnexusAppState();
}

class _MnexusAppState extends State<MnexusApp> {
  final SettingsService _settings = SettingsService.instance;

  @override
  void initState() {
    super.initState();
    _settings.load();
    _settings.addListener(_onSettingsChanged);
  }

  void _onSettingsChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _settings.removeListener(_onSettingsChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = _settings.current;
    return MaterialApp(
      title: AppConstants.name,
      debugShowCheckedModeBanner: false,
      themeMode: s.materialThemeMode,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      builder: (ctx, child) {
        return MediaQuery(
          data: MediaQuery.of(ctx).copyWith(
            textScaler: TextScaler.linear(s.fontScale),
          ),
          child: child!,
        );
      },
      home: const MainShell(),
    );
  }
}

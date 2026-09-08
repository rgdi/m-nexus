// M-NEXUS — entry point.
// v0.47.0: refactor para cargar AppState UNA vez al arranque.
// Antes: cada screen llamaba VaultDetector + FlashcardService en su initState
//        (4 screens x 2 scans = 8 lecturas del vault = 30s en cold start).
// Ahora: 1 init global, todas las screens leen de cache (<100ms).

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'core/constants.dart';
import 'core/main_shell.dart';
import 'core/theme.dart';
import 'screens/setup/setup_wizard.dart';
import 'screens/setup/onboarding_tutorial.dart';
import 'services/app_info.dart';
import 'services/device_id.dart';
import 'services/device_info.dart';
import 'services/logger.dart';
import 'services/settings_service.dart';
import 'state/app_state.dart';

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

  // Carga global UNA sola vez
  await AppState.instance.init();

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
      // Si no hay vault, mostrar el setup wizard
      home: AppState.instance.hasVault
          ? const MainShell()
          : const _SetupGate(),
    );
  }
}

class _SetupGate extends StatelessWidget {
  const _SetupGate();

  @override
  Widget build(BuildContext context) {
    return const SetupWizard();
  }
}

class _TutorialGate extends StatelessWidget {
  final VoidCallback onFinish;
  const _TutorialGate({required this.onFinish});

  @override
  Widget build(BuildContext context) {
    return OnboardingTutorial(onFinish: onFinish);
  }
}

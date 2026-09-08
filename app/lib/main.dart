// M-NEXUS — entry point.
// v0.47.1: NO bloquea esperando AppState.init. La UI se muestra inmediatamente
// y los datos se cargan en background. Esto elimina la pantalla "Cargando..."
// que aparecia durante 30s en cold start.

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

  // Carga info básica (rapida, en paralelo)
  final identityFuture = DeviceIdentity.load();
  final infoFuture = AppInfo.load();
  final settingsFuture = SettingsService.instance.load();

  final identity = await identityFuture;
  final info = await infoFuture;
  final size = WidgetsBinding.instance.platformDispatcher.views.first.physicalSize /
      WidgetsBinding.instance.platformDispatcher.views.first.devicePixelRatio;
  await DeviceInfo.load(Size(size.width, size.height));
  final settings = await settingsFuture;

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
    });

  // v0.47.1: NO esperamos AppState.init aquí. La UI se muestra
  // inmediatamente. Las pantallas leen AppState (que se inicializa en
  // background) y muestran skeleton/empty state hasta que esté listo.
  //
  // Antes: 30s "Cargando..." en cold start (bloqueaba esperando vault scan)
  // Ahora: <500ms para mostrar UI; vault scan corre en background.

  // Inicia carga en background (no awaited)
  // ignore: discarded_futures
  AppState.instance.init().catchError((e) {
    AdvancedLogger.instance.error('app', 'AppState.init failed', error: e);
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
      home: const _RootGate(),
    );
  }
}

/// v0.47.1: root gate inteligente que cambia de UI segun el estado de AppState.
///   - Si no hay vault: setup wizard
///   - Si hay vault: MainShell
///   - Mientras AppState se inicializa: skeleton (no pantalla de "Cargando..." infinito)
class _RootGate extends StatefulWidget {
  const _RootGate();
  @override
  State<_RootGate> createState() => _RootGateState();
}

class _RootGateState extends State<_RootGate> {
  @override
  void initState() {
    super.initState();
    // Escucha cambios en AppState para cambiar UI cuando esté listo
    AppState.instance.addListener(_onAppStateChanged);
    // Si despues de 100ms AppState sigue cargando, no esperamos
    // (la UI ya muestra algo)
  }

  void _onAppStateChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    AppState.instance.removeListener(_onAppStateChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppState.instance;
    if (app.hasVault) {
      return const MainShell();
    }
    // Si no tiene vault pero ya termino de cargar → setup wizard
    if (app.initialLoaded) {
      return const _SetupWithTutorialGate();
    }
    // Mientras carga: skeleton mínimo (nada de "Cargando..." infinito)
    return const _BootSkeleton();
  }
}

class _BootSkeleton extends StatelessWidget {
  const _BootSkeleton();
  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: SizedBox(
          width: 32, height: 32,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );
  }
}

class _SetupWithTutorialGate extends StatefulWidget {
  const _SetupWithTutorialGate();
  @override
  State<_SetupWithTutorialGate> createState() => _SetupWithTutorialGateState();
}

class _SetupWithTutorialGateState extends State<_SetupWithTutorialGate> {
  bool _showTutorial = false;

  @override
  Widget build(BuildContext context) {
    if (_showTutorial) {
      return OnboardingTutorial(onFinish: () {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const MainShell()),
        );
      });
    }
    return SetupWizard(
      onComplete: () {
        // Despues del setup, muestra el tutorial
        setState(() => _showTutorial = true);
      },
    );
  }
}

// M-NEXUS companion app — entry point.
//
// v0.31: integracion con device identity + setup wizard.
// v0.39: AdvancedLogger inicializado al arranque.

import 'package:flutter/material.dart';
import 'services/app_info.dart';
import 'services/backend_client.dart';
import 'services/device_id.dart';
import 'services/logger.dart';
import 'ui/home_page.dart';
import 'ui/setup_wizard.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Cargar identidad persistida
  final identity = await DeviceIdentity.load();
  final info = await AppInfo.load();

  // v0.39: inicializar logger avanzado
  final osVersion = '${info.model} (${info.osVersion})';
  await AdvancedLogger.instance.init(
    userId: 'me',
    deviceId: identity.deviceId,
    appVersion: info.fullVersion,
    osVersion: info.model.isNotEmpty ? "${info.model} (${info.osVersion})" : (info.osVersion.isNotEmpty ? info.osVersion : "unknown"),
  );
  AdvancedLogger.instance.info('app', 'M-NEXUS companion starting',
    context: {
      'version': info.fullVersion,
      'device': identity.deviceId,
      'os': osVersion,
    });

  debugPrint('M-NEXUS companion ${info.fullVersion} | device=${identity.deviceId}');

  // Determinar si mostrar el wizard:
  //  - Test mode: SIEMPRE mostrar el wizard
  //  - Normal: solo si no se completó
  final testMode = await AppInfo.isTestMode();
  final shouldShowWizard = testMode || !(await SetupWizard.isCompleted());
  AdvancedLogger.instance.info('app', 'Setup state',
    context: {'testMode': testMode, 'showWizard': shouldShowWizard});
  if (!shouldShowWizard) {
    // Setup ya completado → registrar en background
    _registerInBackground(identity);
  }

  runApp(MnexusApp(forceSetup: shouldShowWizard));
}

void _registerInBackground(DeviceIdentity identity) async {
  final log = AdvancedLogger.instance;
  final stopwatch = Stopwatch()..start();
  try {
    final client = await BackendClient.create();
    final ok = await client.registerDevice(identity);
    stopwatch.stop();
    log.info('app', 'Device registration result',
      context: {
        'success': ok,
        'duration_ms': stopwatch.elapsedMilliseconds,
      });
    client.close();
  } catch (e, s) {
    stopwatch.stop();
    log.error('app', 'Device registration failed',
      context: {'duration_ms': stopwatch.elapsedMilliseconds},
      error: e, stack: s);
  }
}

/// v0.34: splash screen que decide entre wizard o home.
/// Long-press en el logo activa/desactiva el test mode (fuerza wizard).
class _RootRouter extends StatelessWidget {
  final bool forceSetup;
  const _RootRouter({required this.forceSetup});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<bool>(
      future: Future.wait([
        SetupWizard.isCompleted(),
        AppInfo.isTestMode(),
      ]).then((results) => results[0] == false || results[1]),
      builder: (context, snap) {
        if (!snap.hasData) {
          return Scaffold(
            body: GestureDetector(
              onLongPress: () async {
                final newMode = await AppInfo.toggleTestMode();
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(newMode
                          ? '🧪 Test mode ON: wizard siempre visible'
                          : '✅ Test mode OFF: respeta setup.completed'),
                    ),
                  );
                }
              },
              child: Container(
                color: Theme.of(context).colorScheme.surface,
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(24),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(
                            colors: [
                              Theme.of(context).colorScheme.primary,
                              Theme.of(context).colorScheme.secondary,
                            ],
                          ),
                        ),
                        child: const Icon(
                          Icons.medical_services,
                          size: 64,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text('M-NEXUS',
                          style: TextStyle(
                              fontSize: 28, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 8),
                      Text('v0.34.0',
                          style: TextStyle(
                              color: Colors.grey, fontSize: 14)),
                    ],
                  ),
                ),
              ),
            ),
          );
        }
        if (snap.data == true) {
          return const SetupWizard();
        }
        return const HomePage();
      },
    );
  }
}

class MnexusApp extends StatelessWidget {
  /// v0.34: si true, siempre muestra el setup wizard al inicio.
  final bool forceSetup;
  const MnexusApp({super.key, this.forceSetup = false});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'M-NEXUS Installer',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2563EB),
          brightness: Brightness.dark,
        ),
      ),
      home: _RootRouter(forceSetup: forceSetup),
    );
  }
}

// M-NEXUS companion app — entry point.
//
// v0.31: integracion con device identity + setup wizard.

import 'package:flutter/material.dart';
import 'services/backend_client.dart';
import 'services/device_id.dart';
import 'ui/home_page.dart';
import 'ui/setup_wizard.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Cargar identidad persistida
  final identity = await DeviceIdentity.load();
  debugPrint('M-NEXUS companion v0.30.0+10 | device=${identity.deviceId}');

  // Si el setup ya se completó, intentar registrar el device en el backend
  // (fire-and-forget; no bloquea el arranque)
  if (await SetupWizard.isCompleted()) {
    _registerInBackground(identity);
  }

  runApp(const MnexusApp());
}

void _registerInBackground(DeviceIdentity identity) async {
  try {
    final client = await BackendClient.create();
    final ok = await client.registerDevice(identity);
    debugPrint('Device registration: ${ok ? "ok" : "skipped (offline?)"}');
    client.close();
  } catch (e) {
    debugPrint('Device registration failed: $e');
  }
}

class MnexusApp extends StatelessWidget {
  const MnexusApp({super.key});

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
      home: FutureBuilder<bool>(
        future: SetupWizard.isCompleted(),
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          if (snap.data == false) {
            return const SetupWizard();
          }
          return const HomePage();
        },
      ),
    );
  }
}

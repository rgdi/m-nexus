// M-NEXUS standalone app — entry point.
//
// v0.41: Refactor completo. La app es ahora la app principal.
// - Soporta Android, Web, Desktop
// - Material 3 theme
// - Dashboard como home
// - AdaptiveScaffold (bottom nav en mobile, rail en tablet/desktop)
// - Auto-update solo en Android (no en web)

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'services/app_info.dart';
import 'services/device_id.dart';
import 'services/logger.dart';
import 'screens/dashboard_screen.dart';
import 'screens/vault_list_page.dart';
import 'screens/flashcards_hub_page.dart';
import 'screens/settings_screen.dart';
import 'screens/help_screen.dart';
import 'utils/theme.dart';
// Re-uso la home original (que tiene todos los features de settings/update/etc)
// en un alias para evitar conflicto de nombre con esta MnexusApp
import 'ui/home_page.dart' as legacy;

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final identity = await DeviceIdentity.load();
  final info = await AppInfo.load();

  final osVersion = info.model.isNotEmpty
      ? '${info.model} (${info.osVersion})'
      : (info.osVersion.isNotEmpty ? info.osVersion : 'unknown');

  await AdvancedLogger.instance.init(
    userId: 'me',
    deviceId: identity.deviceId,
    appVersion: info.fullVersion,
    osVersion: osVersion,
  );
  AdvancedLogger.instance.info('app', 'M-NEXUS starting',
    context: {
      'version': info.fullVersion,
      'device': identity.deviceId,
      'os': osVersion,
      'platform': kIsWeb ? 'web' : 'native',
    });

  runApp(MnexusApp(identity: identity, info: info));
}

class MnexusApp extends StatelessWidget {
  final DeviceIdentity identity;
  final AppInfo info;
  const MnexusApp({super.key, required this.identity, required this.info});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'M-NEXUS',
      debugShowCheckedModeBanner: false,
      themeMode: ThemeMode.system,
      theme: MnexusTheme.light(),
      darkTheme: MnexusTheme.dark(),
      home: MainShell(identity: identity, info: info),
    );
  }
}

class MainShell extends StatefulWidget {
  final DeviceIdentity identity;
  final AppInfo info;
  const MainShell({super.key, required this.identity, required this.info});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    // En desktop/tablet, mostramos navigation rail + la pantalla
    // En mobile, bottom nav
    return AdaptiveScaffold(
      currentIndex: _index,
      onIndexChanged: (i) => setState(() { _index = i; }),
      destinations: const [
        AdaptiveDestination(
          icon: Icon(Icons.home_outlined),
          selectedIcon: Icon(Icons.home),
          label: 'Inicio',
        ),
        AdaptiveDestination(
          icon: Icon(Icons.folder_outlined),
          selectedIcon: Icon(Icons.folder),
          label: 'Vault',
        ),
        AdaptiveDestination(
          icon: Icon(Icons.style_outlined),
          selectedIcon: Icon(Icons.style),
          label: 'Flashcards',
        ),
        AdaptiveDestination(
          icon: Icon(Icons.settings_outlined),
          selectedIcon: Icon(Icons.settings),
          label: 'Ajustes',
        ),
      ],
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    switch (_index) {
      case 0:
        return DashboardScreen();
      case 1:
        return const VaultListPage();
      case 2:
        return const FlashcardsHubPage();
      case 3:
        // Settings: reusa la home original como panel de control completo
        return legacy.HomePage();
      default:
        return DashboardScreen();
    }
  }
}

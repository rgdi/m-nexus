// MainShell: navigation adaptativa con bottom nav (mobile) /
// NavigationRail (tablet/desktop).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'theme.dart';
import '../screens/home/home_screen.dart';
import '../screens/vault/vault_browser.dart';
import '../screens/flashcards/flashcards_list.dart';
import '../screens/settings/settings_screen.dart';
import '../screens/help/help_screen.dart';
import '../core/shortcuts.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  static const _destinations = [
    _NavDest(Icons.home_outlined, Icons.home, 'Inicio', HomeScreen()),
    _NavDest(Icons.folder_outlined, Icons.folder, 'Vault', VaultBrowser()),
    _NavDest(Icons.style_outlined, Icons.style, 'Tarjetas', FlashcardsList()),
    _NavDest(Icons.settings_outlined, Icons.settings, 'Ajustes', SettingsScreen()),
  ];

  @override
  Widget build(BuildContext context) {
    return CallbackShortcuts(
      bindings: {
        const SingleActivator(LogicalKeyboardKey.digit1, control: true):
            const _GoToIntent(0),
        const SingleActivator(LogicalKeyboardKey.digit2, control: true):
            const _GoToIntent(1),
        const SingleActivator(LogicalKeyboardKey.digit3, control: true):
            const _GoToIntent(2),
        const SingleActivator(LogicalKeyboardKey.digit4, control: true):
            const _GoToIntent(3),
        const SingleActivator(LogicalKeyboardKey.comma, control: true):
            const _GoToIntent(0),
      },
      child: Actions(
        actions: {
          _GoToIntent: CallbackAction<_GoToIntent>(
            onInvoke: (i) {
              setState(() { _index = i.target; });
              return null;
            },
          ),
        },
        child: Focus(
          autofocus: true,
          child: AppTheme.isMobile(context)
              ? _buildMobile(context)
              : _buildRail(context),
        ),
      ),
    );
  }

  Widget _buildMobile(BuildContext context) {
    return Scaffold(
      body: SafeArea(child: _destinations[_index].page),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() { _index = i; }),
        destinations: _destinations
            .map((d) => NavigationDestination(
                  icon: Icon(d.icon),
                  selectedIcon: Icon(d.activeIcon),
                  label: d.label,
                ))
            .toList(),
      ),
    );
  }

  Widget _buildRail(BuildContext context) {
    final extended = AppTheme.isDesktop(context);
    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            extended: extended,
            minExtendedWidth: 180,
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() { _index = i; }),
            labelType: extended
                ? NavigationRailLabelType.none
                : NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 36, height: 36,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF4F6BED), Color(0xFF7B5BE6)],
                      ),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    alignment: Alignment.center,
                    child: const Text('M',
                      style: TextStyle(color: Colors.white,
                        fontWeight: FontWeight.bold, fontSize: 18)),
                  ),
                  if (extended) ...[
                    const SizedBox(width: 12),
                    const Text('M-NEXUS',
                      style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                  ],
                ],
              ),
            ),
            destinations: _destinations
                .map((d) => NavigationRailDestination(
                      icon: Icon(d.icon),
                      selectedIcon: Icon(d.activeIcon),
                      label: Text(d.label),
                    ))
                .toList(),
          ),
          const VerticalDivider(width: 1),
          Expanded(child: _destinations[_index].page),
        ],
      ),
    );
  }
}

class _NavDest {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final Widget page;
  const _NavDest(this.icon, this.activeIcon, this.label, this.page);
}

class _GoToIntent extends Intent {
  final int target;
  const _GoToIntent(this.target);
}

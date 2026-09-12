// MainShell: navigation adaptativa con bottom nav (mobile) /
// NavigationRail (tablet/desktop).
//
// v0.49: mobile usa FloatingDock glass en lugar de NavigationBar nativo;
// cada página recibe AppBackground en su Scaffold.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/design_tokens.dart';
import '../widgets/glass_widgets.dart';
import 'theme.dart';
import '../screens/home/home_screen.dart';
import '../screens/vault/vault_browser.dart';
import '../screens/flashcards/flashcards_list.dart';
import '../screens/plan/plan_screen.dart';
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
    _NavDest(
        Icons.home_outlined, Icons.home_rounded, 'Inicio', HomeScreen()),
    _NavDest(
        Icons.folder_outlined, Icons.folder_rounded, 'Vault', VaultBrowser()),
    _NavDest(Icons.style_outlined, Icons.style_rounded, 'Tarjetas',
        FlashcardsList()),
    _NavDest(Icons.event_note_outlined, Icons.event_note_rounded, 'Plan',
        PlanScreen()),
    _NavDest(Icons.settings_outlined, Icons.settings_rounded, 'Ajustes',
        SettingsScreen()),
  ];

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.digit1, control: true): _GoToIntent(0),
        SingleActivator(LogicalKeyboardKey.digit2, control: true): _GoToIntent(1),
        SingleActivator(LogicalKeyboardKey.digit3, control: true): _GoToIntent(2),
        SingleActivator(LogicalKeyboardKey.digit4, control: true): _GoToIntent(3),
        SingleActivator(LogicalKeyboardKey.digit5, control: true): _GoToIntent(4),
        SingleActivator(LogicalKeyboardKey.comma, control: true): _GoToIntent(0),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
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
      // v0.62.13: UpdateBanner eliminado del Stack del MainShell (volvió
      // al modelo original de hermano en main.dart). El problema era la
      // falta de persistencia del dismiss, ya resuelto con SharedPreferences.
      // Revertir este cambio evita que el banner tape el contenido de cada
      // screen (que no tiene AppBar propio en Home, o lo tiene en otros).
      body: Stack(
        children: [
          // Página activa (cada una ya trae su AppBackground si quiere).
          // v0.62.10: Padding(bottom: 80) para que el contenido de cada
          // screen tenga espacio reservado y no quede tapado por el dock.
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 80),
              child: _destinations[_index].page,
            ),
          ),
          // Floating dock en la parte inferior
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: FloatingDock(
              currentIndex: _index,
              onTap: (i) => setState(() { _index = i; }),
              items: _destinations
                  .map((d) => DockItem(icon: d.icon, label: d.label))
                  .toList(),
            ),
          ),
        ],
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
            minExtendedWidth: 200,
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() { _index = i; }),
            labelType: extended
                ? NavigationRailLabelType.none
                : NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 38, height: 38,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF5B5BD6), Color(0xFF8B5CF6)],
                      ),
                      borderRadius: BorderRadius.circular(11),
                      boxShadow: MxShadows.md,
                    ),
                    alignment: Alignment.center,
                    child: const Text('M',
                      style: TextStyle(color: Colors.white,
                        fontWeight: FontWeight.w800, fontSize: 19)),
                  ),
                  if (extended) ...[
                    const SizedBox(width: 12),
                    const Text('M-NEXUS',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
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

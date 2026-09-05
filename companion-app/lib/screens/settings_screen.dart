// SettingsScreen: reutiliza la home original que tiene todas las settings.
// En v0.42 separamos en sub-pantallas.

import 'package:flutter/material.dart';
import '../ui/home_page.dart' as legacy;

class SettingsScreen extends StatelessWidget {
  final VoidCallback? onLogout;
  const SettingsScreen({super.key, this.onLogout});
  @override
  Widget build(BuildContext context) {
    return const legacy.HomePage();
  }
}

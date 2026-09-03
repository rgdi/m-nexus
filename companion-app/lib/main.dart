// M-NEXUS Installer — entry point.

import 'package:flutter/material.dart';
import 'ui/home_page.dart';

void main() {
  runApp(const MNexusInstallerApp());
}

class MNexusInstallerApp extends StatelessWidget {
  const MNexusInstallerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'M-NEXUS Installer',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1F6FEB),
          brightness: Brightness.light,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1F6FEB),
          brightness: Brightness.dark,
        ),
      ),
      themeMode: ThemeMode.system,
      home: const HomePage(),
    );
  }
}
// v0.29.6
// test
// v0.29.7
// v0.29.8

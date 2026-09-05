// Theme system para M-NEXUS v0.41.
//
// Material 3 con:
//   - Light + Dark themes
//   - Color seed: azul clínico
//   - Adaptive (mobile/tablet/desktop con NavigationRail)
//
// Inspirado en Obsidian (minimal, eye-friendly) + Notion (cards, generous padding)
// + Material You (M3 colors, dynamic).

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class MnexusTheme {
  /// Color seed principal (azul clínico)
  static const Color seed = Color(0xFF4F6BED);

  /// Tamaño breakpoint: si width > 600, es tablet/desktop
  static const double tabletBreakpoint = 600;
  static const double desktopBreakpoint = 1024;

  static bool isTablet(BuildContext context) =>
    MediaQuery.of(context).size.width >= tabletBreakpoint;
  static bool isDesktop(BuildContext context) =>
    MediaQuery.of(context).size.width >= desktopBreakpoint;

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.light,
    );
    return _build(scheme, Brightness.light);
  }

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark,
    );
    return _build(scheme, Brightness.dark);
  }

  static ThemeData _build(ColorScheme scheme, Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    return ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      scaffoldBackgroundColor: scheme.surface,
      visualDensity: VisualDensity.standard,
      textTheme: _textTheme(scheme),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: scheme.onSurface,
          fontSize: 20,
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardTheme(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: scheme.outlineVariant.withOpacity(0.5),
            width: 1,
          ),
        ),
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
          side: BorderSide(color: scheme.outline.withOpacity(0.5)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHigh,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.outline.withOpacity(0.3)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.outline.withOpacity(0.3)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surface,
        selectedIconTheme: IconThemeData(color: scheme.primary),
        unselectedIconTheme: IconThemeData(color: scheme.onSurfaceVariant),
        selectedLabelTextStyle: TextStyle(
          color: scheme.primary, fontWeight: FontWeight.w600,
        ),
        unselectedLabelTextStyle: TextStyle(color: scheme.onSurfaceVariant),
        indicatorColor: scheme.primaryContainer,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primaryContainer,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant.withOpacity(0.4),
        space: 1,
        thickness: 1,
      ),
      listTileTheme: ListTileThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
        ),
      ),
    );
  }

  static TextTheme _textTheme(ColorScheme scheme) {
    return TextTheme(
      displayLarge: TextStyle(
        fontSize: 32, fontWeight: FontWeight.w700, color: scheme.onSurface,
        letterSpacing: -0.5,
      ),
      displayMedium: TextStyle(
        fontSize: 24, fontWeight: FontWeight.w700, color: scheme.onSurface,
        letterSpacing: -0.3,
      ),
      displaySmall: TextStyle(
        fontSize: 20, fontWeight: FontWeight.w600, color: scheme.onSurface,
      ),
      headlineLarge: TextStyle(
        fontSize: 18, fontWeight: FontWeight.w600, color: scheme.onSurface,
      ),
      headlineMedium: TextStyle(
        fontSize: 16, fontWeight: FontWeight.w600, color: scheme.onSurface,
      ),
      titleLarge: TextStyle(
        fontSize: 15, fontWeight: FontWeight.w600, color: scheme.onSurface,
      ),
      titleMedium: TextStyle(
        fontSize: 14, fontWeight: FontWeight.w500, color: scheme.onSurface,
      ),
      bodyLarge: TextStyle(
        fontSize: 15, color: scheme.onSurface, height: 1.5,
      ),
      bodyMedium: TextStyle(
        fontSize: 14, color: scheme.onSurface, height: 1.45,
      ),
      bodySmall: TextStyle(
        fontSize: 12, color: scheme.onSurfaceVariant, height: 1.4,
      ),
      labelLarge: TextStyle(
        fontSize: 14, fontWeight: FontWeight.w600, color: scheme.onSurface,
      ),
    );
  }
}

/// Widget que adapta el layout según el tamaño de pantalla.
/// - Mobile: bottom NavigationBar
/// - Tablet: NavigationRail (compacta)
/// - Desktop: NavigationRail (extendida) + body
class AdaptiveScaffold extends StatelessWidget {
  final Widget body;
  final int currentIndex;
  final ValueChanged<int> onIndexChanged;
  final List<AdaptiveDestination> destinations;
  final Widget? floatingActionButton;
  final PreferredSizeWidget? appBar;
  final Widget? drawer;

  const AdaptiveScaffold({
    super.key,
    required this.body,
    required this.currentIndex,
    required this.onIndexChanged,
    required this.destinations,
    this.floatingActionButton,
    this.appBar,
    this.drawer,
  });

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size.width;
    if (size < MnexusTheme.tabletBreakpoint) {
      // Mobile: bottom nav
      return Scaffold(
        appBar: appBar,
        body: body,
        floatingActionButton: floatingActionButton,
        drawer: drawer,
        bottomNavigationBar: NavigationBar(
          selectedIndex: currentIndex,
          onDestinationSelected: onIndexChanged,
          destinations: destinations.map((d) => NavigationDestination(
            icon: d.icon,
            selectedIcon: d.selectedIcon ?? d.icon,
            label: d.label,
          )).toList(),
        ),
      );
    } else {
      // Tablet/Desktop: NavigationRail
      final extended = size >= MnexusTheme.desktopBreakpoint;
      return Scaffold(
        appBar: appBar,
        body: Row(
          children: [
            NavigationRail(
              extended: extended,
              minExtendedWidth: 180,
              selectedIndex: currentIndex,
              onDestinationSelected: onIndexChanged,
              labelType: extended
                  ? NavigationRailLabelType.none
                  : NavigationRailLabelType.all,
              leading: floatingActionButton != null
                  ? Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: floatingActionButton!,
                    )
                  : null,
              destinations: destinations.map((d) => NavigationRailDestination(
                icon: d.icon,
                selectedIcon: d.selectedIcon ?? d.icon,
                label: Text(d.label),
              )).toList(),
            ),
            const VerticalDivider(width: 1),
            Expanded(child: body),
          ],
        ),
        floatingActionButton: floatingActionButton == null || !extended
            ? floatingActionButton
            : null,
        drawer: drawer,
      );
    }
  }
}

class AdaptiveDestination {
  final Icon icon;
  final Icon? selectedIcon;
  final String label;
  const AdaptiveDestination({
    required this.icon,
    required this.label,
    this.selectedIcon,
  });
}

/// Helper para mostrar que una feature solo funciona en Android
class AndroidOnly extends StatelessWidget {
  final Widget child;
  final String? alternativeHint;
  const AndroidOnly({super.key, required this.child, this.alternativeHint});

  @override
  Widget build(BuildContext context) {
    if (kIsWeb) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.android, size: 48, color: Colors.grey),
              const SizedBox(height: 12),
              const Text('Solo disponible en Android',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              if (alternativeHint != null) ...[
                const SizedBox(height: 8),
                Text(alternativeHint!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.grey)),
              ],
            ],
          ),
        ),
      );
    }
    return child;
  }
}

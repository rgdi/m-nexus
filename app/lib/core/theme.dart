// Theme system M-NEXUS v0.49 — major visual redesign.
//
// Cambios principales:
//   - Dark mode optimizado para OLED (negros profundos, no saturados)
//   - Light mode con superficie slate-50 (warm white, no gris puro)
//   - Glass morphism REAL: surfaceContainerLow con backdrop-filter effect
//   - Cards con elevation tonal (no shadow-based en M3)
//   - Tipografía mejorada: displayLarge/medium para hero, bodyMedium legible
//   - Border-radius scale: 8/12/16/20/28 (era 12 plano)
//   - AppBar transparent con scrolledUnderElevation tonal
//   - Tonal elevation para diferenciación de superficies
//   - Outline colors con opacidad reducida para jerarquía sutil
//   - Botones con foreground/background contrastivos (Material 3)

import 'package:flutter/material.dart';
import 'design_tokens.dart';

class AppTheme {
  static const Color seed = MxColors.indigoDeep;
  static const double mobileBreak = 600;
  static const double desktopBreak = 1024;

  static bool isMobile(BuildContext c) =>
      MediaQuery.sizeOf(c).width < mobileBreak;
  static bool isTablet(BuildContext c) =>
      MediaQuery.sizeOf(c).width >= mobileBreak &&
      MediaQuery.sizeOf(c).width < desktopBreak;
  static bool isDesktop(BuildContext c) =>
      MediaQuery.sizeOf(c).width >= desktopBreak;

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness b) {
    final isDark = b == Brightness.dark;

    // ColorScheme custom (no fromSeed para tener control total)
    final scheme = ColorScheme(
      brightness: b,
      primary: isDark ? const Color(0xFFA5A5F0) : MxColors.indigoDeep,
      onPrimary: isDark ? const Color(0xFF1A1A40) : Colors.white,
      primaryContainer: isDark
          ? const Color(0xFF2A2A7B)
          : const Color(0xFFE0E7FF),
      onPrimaryContainer: isDark
          ? const Color(0xFFC7C7FF)
          : const Color(0xFF1E1B4B),
      secondary: MxColors.violet,
      onSecondary: Colors.white,
      secondaryContainer: isDark
          ? const Color(0xFF4C1D95)
          : const Color(0xFFEDE9FE),
      onSecondaryContainer: isDark
          ? const Color(0xFFDDD6FE)
          : const Color(0xFF2E1065),
      tertiary: MxColors.cyan,
      onTertiary: isDark ? const Color(0xFF003B45) : const Color(0xFF0F172A),
      tertiaryContainer: isDark
          ? const Color(0xFF005A6B)
          : const Color(0xFFCFFAFE),
      onTertiaryContainer: isDark
          ? const Color(0xFFCFFAFE)
          : const Color(0xFF083344),
      error: isDark ? const Color(0xFFF87171) : const Color(0xFFDC2626),
      onError: Colors.white,
      errorContainer: isDark
          ? const Color(0xFF7F1D1D)
          : const Color(0xFFFEE2E2),
      onErrorContainer: isDark
          ? const Color(0xFFFCA5A5)
          : const Color(0xFF7F1D1D),
      surface: isDark ? MxColors.darkBg : MxColors.lightBg,
      onSurface: isDark ? MxColors.darkInk : MxColors.lightInk,
      surfaceContainerLowest: isDark
          ? const Color(0xFF050507)
          : Colors.white,
      surfaceContainerLow: isDark
          ? MxColors.darkSurface
          : MxColors.lightSurface,
      surfaceContainer: isDark
          ? MxColors.darkSurfaceHigh
          : const Color(0xFFFAFBFC),
      surfaceContainerHigh: isDark
          ? const Color(0xFF28283A)
          : MxColors.lightSurfaceHigh,
      onSurfaceVariant: isDark
          ? MxColors.darkInkSoft
          : MxColors.lightInkSoft,
      outline: isDark
          ? const Color(0xFF3F3F50)
          : const Color(0xFFCBD5E1),
      outlineVariant: isDark
          ? MxColors.darkBorder
          : MxColors.lightBorder,
      inverseSurface: isDark
          ? Colors.white
          : MxColors.darkInk,
      onInverseSurface: isDark
          ? MxColors.darkBg
          : Colors.white,
      inversePrimary: MxColors.indigoSoft,
      shadow: Colors.black,
      scrim: Colors.black,
      surfaceTint: MxColors.indigoDeep,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: b,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      canvasColor: scheme.surface,

      // AppBar transparente con blur sutil al scroll
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface.withOpacity(0.7),
        surfaceTintColor: Colors.transparent,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: scheme.onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
        iconTheme: IconThemeData(color: scheme.onSurface, size: 22),
        actionsIconTheme: IconThemeData(color: scheme.onSurface, size: 22),
      ),

      // Cards con elevation tonal y radius generoso
      cardTheme: CardTheme(
        elevation: 0,
        color: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(MxRadius.lg),
          side: BorderSide(color: scheme.outlineVariant, width: 1),
        ),
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
      ),

      // Inputs con fill tonal
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surfaceContainerHigh.withOpacity(0.6),
        hintStyle: TextStyle(
          color: scheme.onSurfaceVariant.withOpacity(0.7),
          fontSize: 15,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(MxRadius.md),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(MxRadius.md),
          borderSide: BorderSide(color: scheme.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(MxRadius.md),
          borderSide: BorderSide(color: scheme.primary, width: 2),
        ),
      ),

      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primaryContainer,
        selectedIconTheme: IconThemeData(color: scheme.onPrimaryContainer),
        unselectedIconTheme: IconThemeData(color: scheme.onSurfaceVariant),
        selectedLabelTextStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: scheme.onSurface,
        ),
        unselectedLabelTextStyle: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: scheme.onSurfaceVariant,
        ),
      ),

      // Bottom nav: transparent (usamos FloatingDock en MainShell)
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: Colors.transparent,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.primaryContainer,
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? scheme.onPrimaryContainer : scheme.onSurfaceVariant,
            size: 24,
          );
        }),
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11,
            fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
            color: selected ? scheme.onSurface : scheme.onSurfaceVariant,
            letterSpacing: 0.2,
          );
        }),
      ),

      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant.withOpacity(0.5),
        space: 1,
        thickness: 1,
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: TextStyle(
          color: scheme.onInverseSurface,
          fontSize: 14,
        ),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(MxRadius.md),
        ),
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: scheme.surfaceContainerLow,
        modalBackgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(MxRadius.xxl)),
        ),
      ),

      dialogTheme: DialogTheme(
        backgroundColor: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(MxRadius.xl),
        ),
      ),

      // Tipografía — Inter-like (system default), jerarquía clara
      textTheme: TextTheme(
        displayLarge: TextStyle(
          fontSize: 40,
          fontWeight: FontWeight.w800,
          letterSpacing: -1.5,
          height: 1.1,
          color: scheme.onSurface,
        ),
        displayMedium: TextStyle(
          fontSize: 32,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.8,
          height: 1.15,
          color: scheme.onSurface,
        ),
        displaySmall: TextStyle(
          fontSize: 26,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.5,
          height: 1.2,
          color: scheme.onSurface,
        ),
        headlineLarge: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.3,
          color: scheme.onSurface,
        ),
        headlineMedium: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
          color: scheme.onSurface,
        ),
        headlineSmall: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.1,
          color: scheme.onSurface,
        ),
        titleLarge: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.1,
          color: scheme.onSurface,
        ),
        titleMedium: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: scheme.onSurface,
        ),
        titleSmall: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: scheme.onSurface,
        ),
        bodyLarge: TextStyle(
          fontSize: 15.5,
          fontWeight: FontWeight.w400,
          height: 1.45,
          color: scheme.onSurface,
        ),
        bodyMedium: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          height: 1.45,
          color: scheme.onSurface,
        ),
        bodySmall: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w400,
          height: 1.4,
          color: scheme.onSurfaceVariant,
        ),
        labelLarge: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.1,
        ),
        labelMedium: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
        labelSmall: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          letterSpacing: 0.5,
        ),
      ),

      iconTheme: IconThemeData(color: scheme.onSurface, size: 22),
      primaryIconTheme: IconThemeData(color: scheme.onPrimary),
      visualDensity: VisualDensity.standard,
      splashColor: scheme.primary.withOpacity(0.08),
      highlightColor: scheme.primary.withOpacity(0.04),
    );
  }
}

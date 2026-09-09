// design_tokens.dart: tokens de diseño centralizados para M-NEXUS v0.49.
//
// v0.49: rediseño completo. Tokens consistentes para color, spacing,
// radius, shadows, motion. Material 3 + glass morphism.
//
// Inspiración: Linear/Notion/Vercel — minimalismo elegante con profundidad
// sutil, gradientes profundos, jerarquía tipográfica marcada.

import 'package:flutter/material.dart';

/// Paleta de marca. M-NEXUS v0.49 — "Estudio Nocturno".
///
/// Identidad visual:
///   - Deep Indigo como primario (calma, conocimiento, profundidad)
///   - Electric Violet para acentos (creatividad, IA, energía)
///   - Soft Cyan para highlights (frescura, aire)
///   - Warm Amber para alertas/achievements (calor humano)
///
/// La paleta dark prioriza OLED-friendly (verdes no saturados, negros profundos)
/// y la light prioriza legibilidad en exteriores.
class MxColors {
  MxColors._();

  // Brand
  static const Color indigoDeep = Color(0xFF5B5BD6);   // primary base
  static const Color indigoSoft = Color(0xFF8B8BFF);
  static const Color violet = Color(0xFFA78BFA);        // accent (IA / tutor)
  static const Color cyan = Color(0xFF67E8F9);          // highlight (FSRS boost)
  static const Color amber = Color(0xFFFBBF24);         // streak / achievements

  // Surfaces (light)
  static const Color lightBg = Color(0xFFF8FAFC);       // slate-50
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightSurfaceHigh = Color(0xFFF1F5F9);
  static const Color lightBorder = Color(0xFFE2E8F0);
  static const Color lightInk = Color(0xFF0F172A);      // slate-900
  static const Color lightInkSoft = Color(0xFF475569);   // slate-600

  // Surfaces (dark)
  static const Color darkBg = Color(0xFF0A0A0F);        // near-black, slight blue tint
  static const Color darkSurface = Color(0xFF13131A);   // card base
  static const Color darkSurfaceHigh = Color(0xFF1E1E28); // elevated
  static const Color darkBorder = Color(0xFF27272F);
  static const Color darkInk = Color(0xFFF1F5F9);
  static const Color darkInkSoft = Color(0xFF94A3B8);

  // Semantic — heatmap intensity ramp
  static const List<Color> heatmapLight = [
    Color(0xFFF1F5F9), Color(0xFFDDD6FE), Color(0xFFA78BFA),
    Color(0xFF7C3AED), Color(0xFF5B21B6),
  ];
  static const List<Color> heatmapDark = [
    Color(0xFF1E1E28), Color(0xFF3D2B6E), Color(0xFF5B21B6),
    Color(0xFF7C3AED), Color(0xFFA78BFA),
  ];

  // Accent gradients (for stat cards, action cards, hero)
  static const LinearGradient heroGradientLight = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF5B5BD6), Color(0xFF8B5CF6)],
  );
  static const LinearGradient heroGradientDark = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF1E1B4B), Color(0xFF312E81)],
  );

  static const LinearGradient statStreak = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFB923C), Color(0xFFF97316)],
  );
  static const LinearGradient statCards = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF6366F1), Color(0xFF8B5CF6)],
  );
  static const LinearGradient statTime = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF06B6D4), Color(0xFF3B82F6)],
  );
  static const LinearGradient statRetention = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF10B981), Color(0xFF059669)],
  );

  // Subtle background mesh for the entire app (used as a BackdropFilter layer)
  static List<Color> bgMesh(Brightness b) => b == Brightness.dark
      ? [
          const Color(0xFF0A0A0F),
          const Color(0xFF1E1B4B).withOpacity(0.25),
          const Color(0xFF0A0A0F),
        ]
      : [
          const Color(0xFFF8FAFC),
          const Color(0xFFEEF2FF),
          const Color(0xFFF8FAFC),
        ];
}

/// Espaciado — escala 4pt base, sigue MUI spacing.
class MxSpacing {
  MxSpacing._();
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
}

/// Border radius — escala log-style (4, 8, 12, 16, 20, 28, full).
class MxRadius {
  MxRadius._();
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 28;
  static const double pill = 999;
}

/// Shadow tokens — soft, modern, single-layer mostly.
class MxShadows {
  MxShadows._();

  static List<BoxShadow> get sm => const [
        BoxShadow(
          color: Color(0x0F000000),
          blurRadius: 8,
          offset: Offset(0, 2),
        ),
      ];
  static List<BoxShadow> get md => const [
        BoxShadow(
          color: Color(0x14000000),
          blurRadius: 16,
          offset: Offset(0, 4),
        ),
      ];
  static List<BoxShadow> get lg => const [
        BoxShadow(
          color: Color(0x18000000),
          blurRadius: 32,
          offset: Offset(0, 12),
        ),
      ];
  // Inner glow (top highlight) for glass surfaces
  static List<BoxShadow> glassGlow(Brightness b) => [
        BoxShadow(
          color: b == Brightness.dark
              ? const Color(0x33FFFFFF)
              : const Color(0x66FFFFFF),
          blurRadius: 0.5,
          offset: const Offset(0, 1),
        ),
      ];
}

/// Duraciones de animación — todas "snappy" para sensación moderna.
class MxMotion {
  MxMotion._();
  static const Duration instant = Duration(milliseconds: 80);
  static const Duration fast = Duration(milliseconds: 180);
  static const Duration medium = Duration(milliseconds: 280);
  static const Duration slow = Duration(milliseconds: 420);
  static const Duration emphasis = Duration(milliseconds: 600);

  // Curvas
  static const Curve standard = Cubic(0.2, 0.0, 0.0, 1.0);
  static const Curve decelerate = Cubic(0.0, 0.0, 0.2, 1.0);
  static const Curve emphasize = Cubic(0.2, 0.0, 0.0, 1.2);
  static const Curve spring = Cubic(0.34, 1.56, 0.64, 1.0);
}

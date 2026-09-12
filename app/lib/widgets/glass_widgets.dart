// glass_card.dart: widgets reutilizables de glass morphism + efectos visuales.
//
// v0.49: rediseño completo. Inspirado en Linear/Vercel/Notion.

import 'dart:ui';
import 'package:flutter/material.dart';
import '../core/design_tokens.dart';

/// Card con glass morphism REAL (BackdropFilter).
///
/// - Background tonal translúcido
/// - Border sutil 1px blanco al 12% (light) / 8% (dark)
/// - Inner glow highlight (top edge)
/// - Drop shadow suave
///
/// Uso:
///   GlassCard(
///     gradient: MxColors.statStreak,
///     child: Text('Hello'),
///   )
class GlassCard extends StatelessWidget {
  final Widget child;
  final double borderRadius;
  final EdgeInsetsGeometry? padding;
  final EdgeInsetsGeometry? margin;
  final double blur;
  final double opacity;
  final Gradient? gradient;
  final Color? solidColor;
  final BorderSide borderSide;
  final List<BoxShadow>? shadows;
  final VoidCallback? onTap;

  const GlassCard({
    super.key,
    required this.child,
    this.borderRadius = MxRadius.lg,
    this.padding,
    this.margin,
    this.blur = 12,
    this.opacity = 0.85,
    this.gradient,
    this.solidColor,
    this.borderSide = BorderSide.none,
    this.shadows,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final hasGradient = gradient != null;
    return Padding(
      padding: margin ?? EdgeInsets.zero,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(borderRadius),
              child: Container(
                decoration: BoxDecoration(
                  gradient: hasGradient
                      ? gradient
                      : LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            (solidColor ?? Theme.of(context).colorScheme.surfaceContainerLow)
                                .withOpacity(opacity),
                            (solidColor ?? Theme.of(context).colorScheme.surfaceContainerLow)
                                .withOpacity(opacity * 0.7),
                          ],
                        ),
                  borderRadius: BorderRadius.circular(borderRadius),
                  border: borderSide == BorderSide.none
                      ? Border.all(
                          color: isDark
                              ? Colors.white.withOpacity(0.08)
                              : Colors.white.withOpacity(0.6),
                          width: 1,
                        )
                      : Border.fromBorderSide(borderSide),
                  boxShadow: shadows ?? (hasGradient ? MxShadows.md : MxShadows.sm),
                ),
                padding: padding,
                child: child,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// HeroCard grande para el home screen — full-width, gradient, padding generoso.
class HeroCard extends StatelessWidget {
  final Widget child;
  final Gradient gradient;
  final double height;
  final VoidCallback? onTap;

  const HeroCard({
    super.key,
    required this.child,
    this.gradient = MxColors.heroGradientDark,
    this.height = 180,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GlassCard(
      onTap: onTap,
      borderRadius: MxRadius.xxl,
      padding: const EdgeInsets.all(MxSpacing.xl),
      gradient: gradient,
      shadows: MxShadows.lg,
      child: SizedBox(
        height: height,
        child: child,
      ),
    );
  }
}

/// StatCard para home/stats — gradient + icon badge + value + label.
class StatCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String? suffix;
  final Gradient gradient;
  final VoidCallback? onTap;

  const StatCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.suffix,
    required this.gradient,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return GlassCard(
      gradient: gradient,
      borderRadius: MxRadius.xl,
      // v0.62.8: reduced padding from MxSpacing.lg (16) to 14 to fit stat text
      padding: const EdgeInsets.all(14),
      onTap: onTap,
      shadows: MxShadows.md,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Container(
            padding: const EdgeInsets.all(MxSpacing.sm),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.18),
              borderRadius: BorderRadius.circular(MxRadius.sm),
            ),
            child: Icon(icon, color: Colors.white, size: 18),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    value,
                    style: theme.textTheme.headlineLarge?.copyWith(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      height: 1.0,
                    ),
                  ),
                  if (suffix != null) ...[
                    const SizedBox(width: 4),
                    Text(
                      suffix!,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: Colors.white.withOpacity(0.85),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 2),
              Text(
                label,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: Colors.white.withOpacity(0.85),
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Action card para home — icon + title + subtitle + chevron, glass effect.
class ActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? trailing; // ej "5 pendientes"
  final VoidCallback? onTap;
  final bool accent;

  const ActionCard({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.accent = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return GlassCard(
      borderRadius: MxRadius.lg,
      padding: const EdgeInsets.all(MxSpacing.lg),
      onTap: onTap,
      opacity: accent ? 1.0 : 0.95,
      solidColor: accent ? scheme.primaryContainer.withOpacity(0.5) : null,
      shadows: accent ? MxShadows.md : MxShadows.sm,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: accent
                  ? scheme.primary
                  : scheme.surfaceContainerHigh.withOpacity(0.8),
              borderRadius: BorderRadius.circular(MxRadius.md),
            ),
            child: Icon(
              icon,
              color: accent ? scheme.onPrimary : scheme.primary,
              size: 22,
            ),
          ),
          const SizedBox(width: MxSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[
            const SizedBox(width: MxSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: MxSpacing.md,
                vertical: MxSpacing.xs,
              ),
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(MxRadius.pill),
              ),
              child: Text(
                trailing!,
                style: theme.textTheme.labelMedium?.copyWith(
                  color: scheme.onPrimaryContainer,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
          const SizedBox(width: MxSpacing.sm),
          Icon(
            Icons.chevron_right_rounded,
            color: scheme.onSurfaceVariant.withOpacity(0.5),
            size: 20,
          ),
        ],
      ),
    );
  }
}

/// Background mesh gradient sutil para toda la app (detrás de todo).
class AppBackground extends StatelessWidget {
  final Widget child;
  const AppBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final colors = MxColors.bgMesh(brightness);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: RadialGradient(
          center: const Alignment(-0.6, -0.8),
          radius: 1.2,
          colors: colors,
        ),
      ),
      child: child,
    );
  }
}

/// Floating dock bottom navigation — modern macOS/iOS inspired.
class FloatingDock extends StatelessWidget {
  final List<DockItem> items;
  final int currentIndex;
  final ValueChanged<int> onTap;

  const FloatingDock({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
            MxSpacing.lg, 0, MxSpacing.lg, MxSpacing.md),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(28),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
            child: Container(
              height: 64,
              decoration: BoxDecoration(
                color: scheme.surfaceContainerLow.withOpacity(0.85),
                borderRadius: BorderRadius.circular(28),
                border: Border.all(
                  color: scheme.outlineVariant.withOpacity(0.5),
                  width: 1,
                ),
                boxShadow: MxShadows.lg,
              ),
              child: Row(
                children: List.generate(items.length, (i) {
                  final item = items[i];
                  final selected = i == currentIndex;
                  return Expanded(
                    child: InkWell(
                      onTap: () => onTap(i),
                      borderRadius: BorderRadius.circular(24),
                      child: AnimatedContainer(
                        duration: MxMotion.fast,
                        curve: MxMotion.standard,
                        margin: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: selected
                              ? scheme.primaryContainer
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              item.icon,
                              size: 22,
                              color: selected
                                  ? scheme.onPrimaryContainer
                                  : scheme.onSurfaceVariant,
                            ),
                            const SizedBox(height: 2),
                            Text(
                              item.label,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: selected
                                    ? scheme.onPrimaryContainer
                                    : scheme.onSurfaceVariant,
                                fontWeight: selected
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                }),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class DockItem {
  final IconData icon;
  final String label;
  const DockItem({required this.icon, required this.label});
}

/// Section header — title + optional action.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget? trailing;

  const SectionHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.2,
                ),
              ),
              if (subtitle != null) ...[
                const SizedBox(height: 2),
                Text(
                  subtitle!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ],
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

/// Tag/badge chip minimalista.
class MxTag extends StatelessWidget {
  final String label;
  final Color? color;
  final IconData? icon;
  const MxTag({super.key, required this.label, this.color, this.icon});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = color ?? theme.colorScheme.primaryContainer;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: MxSpacing.md,
        vertical: MxSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: c,
        borderRadius: BorderRadius.circular(MxRadius.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: theme.colorScheme.onPrimaryContainer),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: theme.textTheme.labelMedium?.copyWith(
              color: theme.colorScheme.onPrimaryContainer,
            ),
          ),
        ],
      ),
    );
  }
}

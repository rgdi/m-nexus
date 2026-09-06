// Adaptive widgets: typography, padding, grids según dispositivo.
import 'package:flutter/material.dart';
import '../services/device_info.dart';

/// Tipografía que se adapta al form factor y perf tier.
class AdaptiveText extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  const AdaptiveText(
    this.text, {
    super.key,
    this.style,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });

  @override
  Widget build(BuildContext context) {
    final base = style ?? Theme.of(context).textTheme.bodyMedium;
    return Text(
      text,
      style: _adaptStyle(base!),
      textAlign: textAlign,
      maxLines: maxLines,
      overflow: overflow,
    );
  }

  TextStyle _adaptStyle(TextStyle base) {
    final device = DeviceInfo.current;
    double scale = 1.0;
    if (device.isTablet) scale = 1.1;
    if (device.isDesktop) scale = 1.2;
    if (device.screenSize == ScreenSize.large) scale *= 1.05;
    if (device.screenSize == ScreenSize.xlarge) scale *= 1.1;
    return base.copyWith(fontSize: (base.fontSize ?? 14) * scale);
  }
}

/// Padding que se adapta al form factor.
class AdaptivePadding extends StatelessWidget {
  final Widget child;
  final EdgeInsets? mobilePadding;
  final EdgeInsets? tabletPadding;
  final EdgeInsets? desktopPadding;
  final EdgeInsets defaultPadding;

  const AdaptivePadding({
    super.key,
    required this.child,
    this.mobilePadding,
    this.tabletPadding,
    this.desktopPadding,
    this.defaultPadding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    final device = DeviceInfo.current;
    EdgeInsets p;
    if (device.isDesktop && desktopPadding != null) {
      p = desktopPadding!;
    } else if (device.isTablet && tabletPadding != null) {
      p = tabletPadding!;
    } else if (mobilePadding != null) {
      p = mobilePadding!;
    } else {
      p = defaultPadding;
    }
    return Padding(padding: p, child: child);
  }
}

/// Grid que ajusta el número de columnas según el ancho.
class ResponsiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double mobileColumnWidth;
  final double tabletColumnWidth;
  final double desktopColumnWidth;
  final double spacing;

  const ResponsiveGrid({
    super.key,
    required this.children,
    this.mobileColumnWidth = 180,
    this.tabletColumnWidth = 240,
    this.desktopColumnWidth = 280,
    this.spacing = 12,
  });

  @override
  Widget build(BuildContext context) {
    final device = DeviceInfo.current;
    double colWidth;
    if (device.isDesktop) {
      colWidth = desktopColumnWidth;
    } else if (device.isTablet) {
      colWidth = tabletColumnWidth;
    } else {
      colWidth = mobileColumnWidth;
    }
    final screenW = MediaQuery.of(context).size.width;
    final cols = (screenW / colWidth).floor().clamp(1, 6);
    return GridView.count(
      crossAxisCount: cols,
      mainAxisSpacing: spacing,
      crossAxisSpacing: spacing,
      childAspectRatio: 1.1,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: children,
    );
  }
}

/// Builder que deshabilita animaciones en low-perf.
class LowPerfGuard extends StatelessWidget {
  final Widget child;
  final Duration lowPerfDuration;
  final Duration normalDuration;

  const LowPerfGuard({
    super.key,
    required this.child,
    this.lowPerfDuration = Duration.zero,
    this.normalDuration = const Duration(milliseconds: 250),
  });

  @override
  Widget build(BuildContext context) {
    final device = DeviceInfo.current;
    final duration = device.isLowPerf ? lowPerfDuration : normalDuration;
    return AnimatedSwitcher(
      duration: duration,
      switchInCurve: Curves.easeOut,
      switchOutCurve: Curves.easeIn,
      child: child,
    );
  }
}

/// Muestra children solo si el device es "high" perf.
class HighPerfOnly extends StatelessWidget {
  final Widget child;
  final Widget fallback;

  const HighPerfOnly({
    super.key,
    required this.child,
    this.fallback = const SizedBox.shrink(),
  });

  @override
  Widget build(BuildContext context) {
    return DeviceInfo.current.isHighPerf ? child : fallback;
  }
}

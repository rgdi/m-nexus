// responsive.dart — helpers para tablet/responsive layout.
// v0.62.17: detecta breakpoint y provee un builder común.

import 'package:flutter/material.dart';

enum FormFactor { phone, tablet, desktop }

class Responsive {
  static FormFactor formFactor(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    if (w >= 1024) return FormFactor.desktop;
    if (w >= 600) return FormFactor.tablet;
    return FormFactor.phone;
  }

  static bool isTabletOrLarger(BuildContext c) =>
      formFactor(c) != FormFactor.phone;

  /// Devuelve un layout según el form factor.
  /// En phone: solo [phone].
  /// En tablet: [phone] + [tablet] (al lado).
  /// En desktop: [phone] + [tablet] (al lado, anchos fijos).
  static Widget adaptive({
    required BuildContext context,
    required Widget phone,
    Widget? tablet,
    double phoneWidth = double.infinity,
    double tabletWidth = 360,
    double desktopWidth = 420,
  }) {
    final ff = formFactor(context);
    final size = MediaQuery.sizeOf(context);
    if (ff == FormFactor.phone) return phone;
    final width = ff == FormFactor.desktop ? desktopWidth : tabletWidth;
    return Row(
      children: [
        SizedBox(
          width: size.width - width,
          child: phone,
        ),
        VerticalDivider(width: 1, color: Theme.of(context).dividerColor.withOpacity(0.3)),
        SizedBox(width: width, child: tablet ?? phone),
      ],
    );
  }
}

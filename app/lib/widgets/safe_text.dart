// safe_text.dart: Text widget con proteccion contra overflow 125%/150%/200%.
//
// v0.49.14: cuando el usuario aumenta el tamano de letra del sistema
// (Accessibility > Display > Text size), los Text normales pueden overflow
// sus contenedores. Este wrapper:
//   1. Limita la escala de texto al 125% maximo (configurable)
//   2. Auto-detecta single-line y anade ellipsis
//   3. Auto-wrap a multi-line si es largo
//   4. Reserva maxLines segun el contexto (titulo=1, body=3, etc)
//
// Usar SafeText en lugar de Text en cualquier lugar donde pueda overflow.

import 'package:flutter/material.dart';

class SafeText extends StatelessWidget {
  final String data;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;
  final double maxScale;
  // Auto-detect: si el texto tiene '\n' o > 80 chars, es multi-line
  final bool? multiLine;

  const SafeText(
    this.data, {
    super.key,
    this.style,
    this.textAlign,
    this.maxLines,
    this.overflow,
    this.maxScale = 1.25,
    this.multiLine,
  });

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    final scaler = mq.textScaler.clamp(maxScaleFactor: maxScale, minScaleFactor: 0.8);

    final isMulti = multiLine ?? (data.contains('\n') || data.length > 80);
    final lines = maxLines ?? (isMulti ? 3 : 1);
    final ov = overflow ?? (lines == 1 ? TextOverflow.ellipsis : TextOverflow.ellipsis);

    return MediaQuery(
      data: mq.copyWith(textScaler: scaler),
      child: Text(
        data,
        style: style,
        textAlign: textAlign,
        maxLines: lines,
        overflow: ov,
        softWrap: true,
      ),
    );
  }
}

/// v0.49.14: SafeListTile wrapper que fuerza single-line y ellipsis
class SafeListTile extends StatelessWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const SafeListTile({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: leading,
      title: SafeText(title, maxLines: 1, maxScale: 1.25),
      subtitle: subtitle == null ? null : SafeText(subtitle!, maxLines: 2, maxScale: 1.25),
      trailing: trailing,
      onTap: onTap,
      onLongPress: onLongPress,
    );
  }
}

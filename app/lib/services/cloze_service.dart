// cloze_service.dart: parser de cloze estilo Anki (Fase 3.A).
//
// v0.46: port del ClozeService.ts del backend a Dart. Misma logica, mismo output.

import '../models/cloze.dart';

class ClozeService {
  static final _clozeRegex = RegExp(r'\{\{c(\d+)::([^}:]+)(?:::([^}]*))?\}\}');

  /// Extrae todos los clozes de un texto.
  static List<ClozeInfo> parseCloze(String content) {
    final clozes = <ClozeInfo>[];
    for (final match in _clozeRegex.allMatches(content)) {
      clozes.add(ClozeInfo(
        number: int.parse(match.group(1)!),
        hidden: match.group(2)!.trim(),
        hint: match.group(3)?.trim(),
        start: match.start,
        fullLength: match[0]!.length,
        raw: match[0]!,
      ));
    }
    return clozes;
  }

  /// Genera las cards de cloze.
  /// Cada cloze (por numero) genera una card separada.
  /// Si hay 3 cloze c1, c2, c3 → 3 cards distintas.
  /// Si hay c1 dos veces → 1 card (union de los textos).
  static List<ClozeCard> generateCards(String content) {
    final clozes = parseCloze(content);
    if (clozes.isEmpty) return [];

    final byNumber = <int, List<ClozeInfo>>{};
    for (final c in clozes) {
      byNumber.putIfAbsent(c.number, () => []);
      byNumber[c.number]!.add(c);
    }

    final cards = <ClozeCard>[];
    for (final entry in byNumber.entries) {
      final number = entry.key;
      final group = entry.value;

      // Texto con respuesta visible (front)
      var textWithAnswer = content;
      for (final c in clozes) {
        final replacement = c.hint != null ? '**${c.hidden}** [${c.hint}]' : '**${c.hidden}**';
        textWithAnswer = textWithAnswer.replaceFirst(c.raw, replacement);
      }

      // Texto con cloze (back)
      var textWithCloze = content;
      for (final c in clozes) {
        final isThisCard = c.number == number;
        if (isThisCard) {
          final clozeText = c.hint != null ? '[...] (${c.hint})' : '[...]';
          textWithCloze = textWithCloze.replaceFirst(c.raw, clozeText);
        } else {
          textWithCloze = textWithCloze.replaceFirst(c.raw, c.hidden);
        }
      }

      cards.add(ClozeCard(
        number: number,
        textWithAnswer: textWithAnswer,
        textWithCloze: textWithCloze,
        hint: group.first.hint,
      ));
    }
    cards.sort((a, b) => a.number.compareTo(b.number));
    return cards;
  }

  /// Cuenta los clozoes unicos (por numero).
  static int count(String content) {
    final clozes = parseCloze(content);
    return clozes.map((c) => c.number).toSet().length;
  }

  /// Valida que la sintaxis sea correcta.
  static List<({int position, String message})> validate(String content) {
    final errors = <({int position, String message})>[];
    final allClozeStarts = RegExp(r'\{\{c(\d*)::');
    for (final match in allClozeStarts.allMatches(content)) {
      final start = match.start;
      final closeIdx = content.indexOf('}}', start);
      if (closeIdx == -1) {
        errors.add((position: start, message: "Cloze abierto sin cerrar (falta '}}')"));
      }
    }
    final badNum = RegExp(r'\{\{c(-?\d+)::');
    for (final match in badNum.allMatches(content)) {
      final n = int.parse(match.group(1)!);
      if (n <= 0) {
        errors.add((position: match.start, message: "Numero de cloze invalido: $n (debe ser >= 1)"));
      }
    }
    return errors;
  }
}

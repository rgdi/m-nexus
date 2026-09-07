// cloze.dart: modelo de cloze (Fase 3.A).
//
// v0.46: implementacion Dart del cloze parser estilo Anki.
// v0.46: logica IDENTICA al backend (ClozeService.ts) para que el
// cliente y servidor produzcan las mismas cards a partir del mismo texto.

class ClozeInfo {
  final int number;
  final String hidden;
  final String? hint;
  final int start;
  final int fullLength;
  final String raw;

  const ClozeInfo({
    required this.number,
    required this.hidden,
    required this.hint,
    required this.start,
    required this.fullLength,
    required this.raw,
  });
}

class ClozeCard {
  final int number;
  final String textWithAnswer;
  final String textWithCloze;
  final String? hint;

  const ClozeCard({
    required this.number,
    required this.textWithAnswer,
    required this.textWithCloze,
    this.hint,
  });
}

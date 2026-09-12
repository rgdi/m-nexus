// auto_flashcard_service.dart: generación automática de flashcards.
//
// v0.47.37: extrae cloze deletions ({{c1::texto}}) y Q/A patterns
// de las notas, y genera flashcards que requieren revisión humana
// antes de aprobarse.
//
// Estrategia:
//   1. Lee notas del vault
//   2. Para cada nota:
//      a) Encuentra cloze deletions {{c1::texto}} o {{c2::texto}}
//      b) Encuentra headings (#) como preguntas implícitas
//      c) Encuentra "key: value" pairs como flashcards
//   3. Genera flashcards con question + answer extraídos
//   4. Las guarda en _M-NEXUS/Flashcards/Drafts/ (no en Approved)
//      para revisión humana antes de activar
//
// El usuario revisa las flashcards generadas en la pantalla
// "Pendientes de revisión" y las aprueba/borra/edita individualmente.

import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:uuid/uuid.dart';
import 'flashcard_service.dart';

class GeneratedFlashcard {
  final String question;
  final String answer;
  final String sourceNote; // rel path
  final String generationType; // 'cloze', 'qa-pattern', 'definition'

  const GeneratedFlashcard({
    required this.question,
    required this.answer,
    required this.sourceNote,
    required this.generationType,
  });
}

class AutoFlashcardService {
  final _uuid = const Uuid();

  /// Escanea las notas y retorna flashcards candidatas.
  Future<List<GeneratedFlashcard>> generate({
    required String vaultPath,
    String folder = '', // vacío = root, o asignatura específica
  }) async {
    final candidates = <GeneratedFlashcard>[];
    final scanPath = folder.isEmpty ? vaultPath : p.join(vaultPath, folder);
    final dir = Directory(scanPath);
    if (!await dir.exists()) return candidates;

    await for (final entity in dir.list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      if (!p.extension(entity.path).toLowerCase().startsWith('.md')) continue;
      if (entity.path.contains('_M-NEXUS')) continue;

      final content = await entity.readAsString();
      final relPath = p.relative(entity.path, from: vaultPath);
      candidates.addAll(_extractFromNote(content, relPath));
    }
    return candidates;
  }

  /// Persiste las flashcards generadas como Drafts (requieren aprobación).
  Future<int> persistDrafts({
    required String vaultPath,
    required List<GeneratedFlashcard> cards,
  }) async {
    final service = FlashcardService(vaultPath);
    var saved = 0;
    for (final card in cards) {
      try {
        await service.create(
          question: card.question,
          answer: card.answer,
          difficulty: 3,
          sourceNote: card.sourceNote,
          // v0.62.8: persist as draft so user reviews before approving
          approved: false,
        );
        saved++;
      } catch (_) {
        // ignore duplicate
      }
    }
    return saved;
  }

  /// Extrae flashcards candidatas de una nota.
  List<GeneratedFlashcard> _extractFromNote(String content, String relPath) {
    final candidates = <GeneratedFlashcard>[];
    final lines = content.split('\n');

    for (var i = 0; i < lines.length; i++) {
      final line = lines[i];

      // 1) Cloze deletions: {{c1::texto}}
      final clozeMatches = RegExp(r'\{\{c\d+::([^}]+)\}\}').allMatches(line);
      if (clozeMatches.isNotEmpty) {
        // Construye la pregunta con el contexto
        final context = line.replaceAll(RegExp(r'\{\{c\d+::([^}]+)\}\}'), '______');
        final answers = clozeMatches.map((m) => m.group(1)!.trim()).toList();
        if (answers.isNotEmpty) {
          candidates.add(GeneratedFlashcard(
            question: context,
            answer: answers.join(' / '),
            sourceNote: relPath,
            generationType: 'cloze',
          ));
        }
      }

      // 2) Definition pattern: "**término**: definición" o "término — definición"
      final defMatch = RegExp(r'^\*?\*?([^*:\n]{2,40})\*?\*?\s*[:—\-]\s+(.{10,200})$').firstMatch(line);
      if (defMatch != null) {
        final term = defMatch.group(1)!.trim();
        final def = defMatch.group(2)!.trim();
        if (!term.startsWith('http') && !term.contains('::')) {
          candidates.add(GeneratedFlashcard(
            question: '¿Qué es $term?',
            answer: def,
            sourceNote: relPath,
            generationType: 'definition',
          ));
        }
      }
    }

    // 3) Heading + siguiente línea como Q/A
    for (var i = 0; i < lines.length - 1; i++) {
      final heading = lines[i].trim();
      if (RegExp(r'^#{1,3}\s+\S').hasMatch(heading)) {
        final next = lines[i + 1].trim();
        if (next.length > 20 && !next.startsWith('#')) {
          // Heading como pregunta
          final question = heading.replaceFirst(RegExp(r'^#+\s*'), '');
          candidates.add(GeneratedFlashcard(
            question: question,
            answer: next,
            sourceNote: relPath,
            generationType: 'qa-pattern',
          ));
        }
      }
    }

    return candidates;
  }
}

/// Extensión de FlashcardService.create() para soportar sourceNote.
/// Se hace en flashcard_service.dart directamente.

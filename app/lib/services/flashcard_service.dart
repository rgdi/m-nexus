// FlashcardService: API limpia para flashcards.
// Lee de _M-NEXUS/Flashcards/Approved y Drafts.

import 'dart:io';
import 'package:path/path.dart' as p;
import '../core/constants.dart';
import 'vault_service.dart';
import 'logger.dart';

class Flashcard {
  final String id;
  final String path;
  final String question;
  final String answer;
  final int difficulty; // 1-5
  final DateTime? nextReview;
  final bool approved;

  const Flashcard({
    required this.id,
    required this.path,
    required this.question,
    required this.answer,
    required this.difficulty,
    required this.approved,
    this.nextReview,
  });

  bool get isDue {
    if (nextReview == null) return true;
    return nextReview!.isBefore(DateTime.now());
  }

  Flashcard copyWith({int? difficulty, DateTime? nextReview, bool? approved}) {
    return Flashcard(
      id: id,
      path: path,
      question: question,
      answer: answer,
      difficulty: difficulty ?? this.difficulty,
      nextReview: nextReview ?? this.nextReview,
      approved: approved ?? this.approved,
    );
  }
}

class FlashcardService {
  final String vaultPath;
  final log = AdvancedLogger.instance;

  FlashcardService(this.vaultPath);

  /// Lista todas las flashcards (approved + drafts).
  Future<List<Flashcard>> listAll() async {
    log.timeStart('fc', 'listAll');
    final cards = <Flashcard>[];
    for (final sub in [AppConstants.flashcardsApproved, AppConstants.flashcardsDrafts]) {
      final dir = Directory(p.join(vaultPath, sub));
      if (!await dir.exists()) continue;
      await for (final f in dir.list()) {
        if (f is! File || !AppConstants.mdExtensions.contains(p.extension(f.path))) continue;
        final card = await _parseCard(f, approved: sub == AppConstants.flashcardsApproved);
        if (card != null) cards.add(card);
      }
    }
    log.timeEnd('fc', 'listAll', extra: {'count': cards.length});
    return cards;
  }

  /// Cards que hay que repasar hoy.
  Future<List<Flashcard>> dueCards() async {
    final all = await listAll();
    return all.where((c) => c.isDue).toList();
  }

  /// Crea una nueva flashcard.
  Future<Flashcard> create({
    required String question,
    required String answer,
    int difficulty = 3,
  }) async {
    final id = 'fc-${DateTime.now().millisecondsSinceEpoch}';
    final filename = '$id.md';
    final dir = Directory(p.join(vaultPath, AppConstants.flashcardsDrafts));
    if (!await dir.exists()) await dir.create(recursive: true);
    final path = p.join(dir.path, filename);
    final body = '''---
id: $id
question: $question
answer: $answer
difficulty: $difficulty
nextReview: ${DateTime.now().toIso8601String().substring(0, 10)}
created: ${DateTime.now().toIso8601String()}
---

# $question

$answer
''';
    await File(path).writeAsString(body);
    log.info('fc', 'Created', context: {'id': id});
    return Flashcard(
      id: id,
      path: path,
      question: question,
      answer: answer,
      difficulty: difficulty,
      nextReview: DateTime.now(),
      approved: false,
    );
  }

  /// Aprueba una flashcard (la mueve de Drafts a Approved).
  Future<void> approve(Flashcard card) async {
    if (card.approved) return;
    final newDir = Directory(p.join(vaultPath, AppConstants.flashcardsApproved));
    if (!await newDir.exists()) await newDir.create(recursive: true);
    final newPath = p.join(newDir.path, p.basename(card.path));
    await File(card.path).rename(newPath);
    log.info('fc', 'Approved', context: {'id': card.id});
  }

  /// Actualiza la dificultad y nextReview de una flashcard.
  /// Busca el archivo actual por id (puede haberse movido de Drafts → Approved).
  Future<void> updateMetadata(
    Flashcard card, {
    required int difficulty,
    required DateTime nextReview,
  }) async {
    final now = DateTime.now();
    // Busca el archivo actual por id
    String? currentPath;
    for (final sub in [AppConstants.flashcardsApproved, AppConstants.flashcardsDrafts]) {
      final dir = Directory(p.join(vaultPath, sub));
      if (!await dir.exists()) continue;
      await for (final f in dir.list()) {
        if (f is! File) continue;
        if (p.basenameWithoutExtension(f.path) == card.id) {
          currentPath = f.path;
          break;
        }
      }
      if (currentPath != null) break;
    }
    if (currentPath == null) {
      log.warn('fc', 'Card not found for update', context: {'id': card.id});
      return;
    }
    final body = '''---
id: ${card.id}
question: ${card.question}
answer: ${card.answer}
difficulty: $difficulty
nextReview: ${nextReview.toIso8601String().substring(0, 10)}
reviewed: ${now.toIso8601String()}
---

# ${card.question}

${card.answer}
''';
    await File(currentPath).writeAsString(body);
    log.info('fc', 'Updated', context: {'id': card.id, 'difficulty': difficulty});
  }

  /// Borra una flashcard.
  Future<void> delete(Flashcard card) async {
    final f = File(card.path);
    if (await f.exists()) await f.delete();
    log.info('fc', 'Deleted', context: {'id': card.id});
  }

  /// Parsea un archivo de flashcard.
  Future<Flashcard?> _parseCard(File f, {required bool approved}) async {
    try {
      final raw = await f.readAsString();
      final parsed = VaultService.parseFrontmatter(raw);
      final fm = parsed.frontmatter;
      return Flashcard(
        id: fm['id'] ?? p.basenameWithoutExtension(f.path),
        path: f.path,
        question: fm['question'] ?? parsed.body.split('\n').first,
        answer: fm['answer'] ?? '',
        difficulty: int.tryParse(fm['difficulty'] ?? '3') ?? 3,
        nextReview: DateTime.tryParse(fm['nextReview'] ?? ''),
        approved: approved,
      );
    } catch (e) {
      log.warn('fc', 'Parse failed', context: {'path': f.path});
      return null;
    }
  }
}

// FlashcardService: API limpia para flashcards.
// Lee de _M-NEXUS/Flashcards/Approved y Drafts.

import 'dart:io';
import 'package:path/path.dart' as p;
import '../core/constants.dart';
import 'vault_service.dart';
import 'exams_service.dart';
import '../utils/error_codes.dart';
import '../utils/safe_call.dart';
import 'logger.dart';

class Flashcard {
  final String id;
  final String path;
  final String question;
  final String answer;
  final int difficulty; // 1-5 (legacy SM-2)
  final DateTime? nextReview;
  final bool approved;
  // v0.47.35: mediaPath para flashcards con imagen/GIF/video.
  // Si es null, la flashcard es texto-only (cloze o Q/A).
  // Si está presente, se renderiza como Image/GIF en el review.
  final String? mediaPath;
  final String? mediaType; // 'image', 'gif', 'video'
  // v0.46: FSRS fields (mismo shape que backend, nullable para compat legacy)
  final double stability;        // S en FSRS
  final double retrievability;    // R en FSRS
  final int reps;                 // # reviews exitosos
  final int lapses;               // # veces Again
  final int state;                // 0=new, 1=learning, 2=review, 3=relearning
  final int scheduledDays;        // intervalo en dias
  final int elapsedDays;          // dias desde ultimo review
  final DateTime? lastReview;     // timestamp del ultimo review

  const Flashcard({
    required this.id,
    required this.path,
    required this.question,
    required this.answer,
    required this.difficulty,
    required this.approved,
    this.nextReview,
    this.mediaPath,
    this.mediaType,
    this.stability = 0.0,
    this.retrievability = 1.0,
    this.reps = 0,
    this.lapses = 0,
    this.state = 0,
    this.scheduledDays = 0,
    this.elapsedDays = 0,
    this.lastReview,
  });

  bool get isDue {
    if (nextReview == null) return true;
    return nextReview!.isBefore(DateTime.now());
  }

  Flashcard copyWith({
    int? difficulty,
    DateTime? nextReview,
    bool? approved,
    String? mediaPath,
    String? mediaType,
    double? stability,
    double? retrievability,
    int? reps,
    int? lapses,
    int? state,
    int? scheduledDays,
    int? elapsedDays,
    DateTime? lastReview,
  }) {
    return Flashcard(
      id: id,
      path: path,
      question: question,
      answer: answer,
      difficulty: difficulty ?? this.difficulty,
      nextReview: nextReview ?? this.nextReview,
      approved: approved ?? this.approved,
      mediaPath: mediaPath ?? this.mediaPath,
      mediaType: mediaType ?? this.mediaType,
      stability: stability ?? this.stability,
      retrievability: retrievability ?? this.retrievability,
      reps: reps ?? this.reps,
      lapses: lapses ?? this.lapses,
      state: state ?? this.state,
      scheduledDays: scheduledDays ?? this.scheduledDays,
      elapsedDays: elapsedDays ?? this.elapsedDays,
      lastReview: lastReview ?? this.lastReview,
    );
  }

  /// Parse desde frontmatter legacy.
  /// Mapas SM-2 fields → FSRS defaults (card nuevo, sin historial FSRS).
  factory Flashcard.fromFrontmatter({
    required String id,
    required String path,
    required String question,
    required String answer,
    required int difficulty,
    required bool approved,
    DateTime? nextReview,
  }) {
    return Flashcard(
      id: id,
      path: path,
      question: question,
      answer: answer,
      difficulty: difficulty,
      approved: approved,
      nextReview: nextReview,
      // Mapear difficulty 1-5 a FSRS D 1-10
      stability: 0.0,
      retrievability: 1.0,
      reps: 0,
      lapses: 0,
      state: 0, // new
      scheduledDays: 0,
      elapsedDays: 0,
    );
  }
}

class FlashcardService {
  final String vaultPath;
  final log = AdvancedLogger.instance;

  FlashcardService(this.vaultPath);

  /// Lista todas las flashcards (approved + drafts).
  Future<List<Flashcard>> listAll() async {
    final r = await safeCallAsync<List<Flashcard>>(
      component: 'fc',
      code: 'EC-CARD-001',
      message: 'listAll failed',
      category: ErrorCategory.card,
      context: {'vault': vaultPath},
      hint: 'Check vault path readable',
      op: () async {
        log.timeStart('fc', 'listAll');
        final cards = <Flashcard>[];
        var parsed = 0;
        var skipped = 0;
        for (final sub in [AppConstants.flashcardsApproved, AppConstants.flashcardsDrafts]) {
          final dir = Directory(p.join(vaultPath, sub));
          if (!await dir.exists()) continue;
          await for (final f in dir.list()) {
            if (f is! File || !AppConstants.mdExtensions.contains(p.extension(f.path))) continue;
            final card = await _parseCard(f, approved: sub == AppConstants.flashcardsApproved);
            if (card != null) { cards.add(card); parsed++; } else { skipped++; }
          }
        }
        log.timeEnd('fc', 'listAll', extra: {'count': cards.length, 'parsed': parsed, 'skipped': skipped});
        return cards;
      },
    );
    return r.value ?? <Flashcard>[];
  }

  /// Cards que hay que repasar hoy (alias de dueCards, mismo nombre que en home).
  Future<List<Flashcard>> getDue() async => dueCards();

  /// Cards que hay que repasar hoy.
  Future<List<Flashcard>> dueCards() async {
    final all = await listAll();
    return all.where((c) => c.isDue).toList();
  }

  /// v0.47.36: cards priorizadas por proximidad de exámenes.
  ///
  /// Algoritmo:
  ///   1. Carga exámenes próximos
  ///   2. Para cada flashcard, calcula el boost basado en:
  ///      - ¿Su source_note está en topics de un examen próximo?
  ///      - boost = AppConstants.examPriorityBoost(daysUntilExam)
  ///   3. Ordena: cards con boost > 1.0 van primero
  ///
  /// El boost se aplica al due-date: si una card tiene boost 2.0,
  /// se considera "due" 2x más temprano.
  Future<List<Flashcard>> dueCardsPrioritized({DateTime? now}) async {
    final n = now ?? DateTime.now();
    final all = await listAll();

    // Cargar exámenes próximos
    final examsService = ExamsService();
    final upcoming = await examsService.upcoming(vaultPath, now: n);

    return all.where((c) => c.isDue).map((c) {
      // Calcular boost máximo aplicable a esta card
      var maxBoost = 1.0;
      for (final exam in upcoming) {
        // ¿La card tiene source_note que mencione algún topic del examen?
        if (c.path.toLowerCase().contains(
            exam.subjectId.toLowerCase())) {
          final daysUntil = exam.daysUntil(n);
          if (daysUntil >= 0) {
            final boost = AppConstants.examPriorityBoost(daysUntil);
            if (boost > maxBoost) maxBoost = boost;
          }
        }
      }
      // Aplicar boost: simular que nextReview ocurrió antes
      final adjustedDue = c.nextReview == null
          ? n
          : c.nextReview!.subtract(
              Duration(
                minutes: ((1 - 1.0 / maxBoost) * 60 * 24).toInt(),
              ),
            );
      final boosted = c.copyWith(nextReview: adjustedDue);
      return MapEntry(boosted, maxBoost);
    }).where((entry) {
      // Aplicar boost para decidir si está due
      return entry.key.isDue;
    }).map((e) => e.key).toList()
      ..sort((a, b) {
        // Ordenar por nextReview ascendente (más antiguo primero)
        if (a.nextReview == null) return -1;
        if (b.nextReview == null) return 1;
        return a.nextReview!.compareTo(b.nextReview!);
      });
  }

  /// Crea una nueva flashcard.
  /// v0.47.1: se guarda directamente en Approved (no Drafts) para que
  /// aparezca inmediatamente en repasos. El usuario puede moverla a Drafts
  /// manualmente si quiere revisarla antes.
  Future<Flashcard> create({
    required String question,
    required String answer,
    int difficulty = 3,
    bool approved = true,
    String? sourceNote, // v0.47.37: nota de la que se generó automáticamente
  }) async {
    final r = await safeCallAsync<Flashcard>(
      component: 'fc',
      code: 'EC-CARD-002',
      message: 'create failed',
      category: ErrorCategory.card,
      context: {'vault': vaultPath, 'difficulty': difficulty, 'qLen': question.length, 'aLen': answer.length, 'approved': approved},
      hint: 'Check vault path writable, Flashcards/Approved dir can be created',
      op: () async {
        final id = 'fc-${DateTime.now().millisecondsSinceEpoch}';
        final filename = '$id.md';
        final folder = approved ? AppConstants.flashcardsApproved : AppConstants.flashcardsDrafts;
        final dir = Directory(p.join(vaultPath, folder));
        if (!await dir.exists()) await dir.create(recursive: true);
        final path = p.join(dir.path, filename);
        // FSRS: new card se guarda con state=learning, due=now (la primera
        // review debe ser inmediata). Despues el algoritmo recalcula.
        final body = '''---
id: $id
question: $question
answer: $answer
difficulty: $difficulty
approved: $approved
stability: 0.0
difficulty_fsrs: 0.0
retrievability: 1.0
reps: 0
lapses: 0
state: 0
scheduled_days: 0
elapsed_days: 0
nextReview: ${DateTime.now().toIso8601String().substring(0, 10)}
created: ${DateTime.now().toIso8601String()}
${sourceNote != null ? "source_note: $sourceNote\n" : ""}---

# $question

$answer
''';
        await File(path).writeAsString(body);
        log.info('fc', 'Created', context: {'id': id, 'path': path, 'approved': approved});
        return Flashcard(
          id: id,
          path: path,
          question: question,
          answer: answer,
          difficulty: difficulty,
          nextReview: DateTime.now(),
          approved: approved,
        );
      },
    );
    if (!r.success) throw r.error!;
    return r.value!;
  }

  /// Aprueba una flashcard (la mueve de Drafts a Approved).
  Future<void> approve(Flashcard card) async {
    if (card.approved) return;
    final r = await safeCallAsync<void>(
      component: 'fc',
      code: 'EC-CARD-003',
      message: 'approve failed',
      category: ErrorCategory.card,
      context: {'vault': vaultPath, 'id': card.id, 'fromPath': card.path},
      hint: 'Check Approved dir can be created, file not locked',
      op: () async {
        final newDir = Directory(p.join(vaultPath, AppConstants.flashcardsApproved));
        if (!await newDir.exists()) await newDir.create(recursive: true);
        final newPath = p.join(newDir.path, p.basename(card.path));
        await File(card.path).rename(newPath);
        log.info('fc', 'Approved', context: {'id': card.id, 'toPath': newPath});
      },
    );
    if (!r.success) throw r.error!;
  }

  /// Actualiza la dificultad y nextReview de una flashcard.
  /// Busca el archivo actual por id (puede haberse movido de Drafts → Approved).
  Future<void> updateMetadata(
    Flashcard card, {
    required int difficulty,
    required DateTime nextReview,
  }) async {
    final r = await safeCallAsync<void>(
      component: 'fc',
      code: 'EC-CARD-004',
      message: 'updateMetadata failed',
      category: ErrorCategory.card,
      context: {'vault': vaultPath, 'id': card.id, 'difficulty': difficulty, 'nextReview': nextReview.toIso8601String()},
      hint: 'Check card id exists in Approved or Drafts dir, file writable',
      op: () async {
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
        log.info('fc', 'Updated', context: {'id': card.id, 'difficulty': difficulty, 'path': currentPath});
      },
    );
    if (!r.success) throw r.error!;
  }

  /// Borra una flashcard.
  Future<void> delete(Flashcard card) async {
    final r = await safeCallAsync<void>(
      component: 'fc',
      code: 'EC-CARD-005',
      message: 'delete failed',
      category: ErrorCategory.card,
      context: {'id': card.id, 'path': card.path},
      hint: 'Check file exists and is not locked',
      op: () async {
        final f = File(card.path);
        if (await f.exists()) await f.delete();
        log.info('fc', 'Deleted', context: {'id': card.id});
      },
    );
    if (!r.success) throw r.error!;
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

// frontmatter_migration.dart: migra .md existentes a SQLite (Fase 2.A.2).
//
// v0.46: al primer launch con DB, leer todos los .md del vault e importar
// metadata a la DB. Asi no se duplican cards y no se pierden datos.
//
// Formato frontmatter (YAML) usado en M-NEXUS legacy:
//
//   ---
//   id: card-uuid
//   type: basic|cloze|io
//   deck: default
//   question: ¿...?
//   answer: ...
//   difficulty: 1-5
//   nextReview: 2026-09-07
//   created: 2026-09-01
//   tags: [anatomia, cardio]
//   ---
//
//   # Card content (markdown)

import 'dart:io';
import 'package:drift/drift.dart';
import 'app_db.dart';
import 'package:path/path.dart' as p;

class FrontmatterMigration {
  final AppDb db;
  final String vaultPath;

  FrontmatterMigration({required this.db, required this.vaultPath});

  /// Run the migration. Returns the count of imported notes and cards.
  Future<MigrationResult> run() async {
    int notesImported = 0;
    int cardsImported = 0;
    int cardsSkipped = 0;
    final errors = <String>[];

    await for (final entity in Directory(vaultPath).list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      final name = p.basename(entity.path);
      if (name.startsWith('.')) continue;
      if (!name.endsWith('.md')) continue;

      try {
        final stat = await entity.stat();
        final content = await entity.readAsString();
        final (frontmatter, body) = _parseFrontmatter(content);
        final relPath = p.relative(entity.path, from: vaultPath);

        // Insert note index entry
        await db.upsertNote(NotesCompanion.insert(
          path: relPath,
          title: Value(frontmatter['title'] ?? _extractTitle(body, name)),
          modified: stat.modified.millisecondsSinceEpoch,
          sizeBytes: stat.size,
          wordCount: Value(_countWords(body)),
          tagsJson: Value(frontmatter['tags'] ?? '[]'),
          linksJson: Value(_extractWikilinksJson(body)),
          contentHash: Value(_sha256(content)),
        ));
        notesImported++;

        // If this is a card (has id field), import it
        if (frontmatter.containsKey('id') && frontmatter.containsKey('question')) {
          final imported = await _importCard(relPath, frontmatter, body);
          if (imported) {
            cardsImported++;
          } else {
            cardsSkipped++;
          }
        }
      } catch (e) {
        errors.add('${entity.path}: $e');
      }
    }

    return MigrationResult(
      notesImported: notesImported,
      cardsImported: cardsImported,
      cardsSkipped: cardsSkipped,
      errors: errors,
    );
  }

  Future<bool> _importCard(String notePath, Map<String, String> fm, String body) async {
    final cardId = fm['id'];
    if (cardId == null) return false;

    // Skip if already exists (idempotent migration)
    final existing = await db.getCardById(cardId);
    if (existing != null) return false;

    final question = fm['question'] ?? _extractH1(body) ?? 'No question';
    final answer = fm['answer'] ?? _stripH1(body);
    final deck = fm['deck'] ?? 'default';
    final type = fm['type'] ?? 'basic';
    final now = DateTime.now();

    // Old SM-2 fields → map to FSRS defaults
    final difficulty = (double.tryParse(fm['difficulty'] ?? '5') ?? 5).clamp(1.0, 10.0);
    final nextReview = _parseDate(fm['nextReview']) ?? now;

    await db.upsertCard(CardsCompanion.insert(
      cardId: cardId,
      notePath: Value(notePath),
      question: question,
      answer: answer,
      stability: const Value(0.0),
      difficulty: Value(difficulty),
      retrievability: const Value(1.0),
      reps: const Value(0),
      lapses: const Value(0),
      // 0=new, 1=learning, 2=review, 3=relearning
      // If nextReview is in the past, treat as due → review state.
      // Otherwise, new/learning.
      state: Value(nextReview.isBefore(now) ? 2 : 0),
      due: nextReview,
      scheduledDays: Value(nextReview.difference(now).inDays.clamp(0, 365)),
      lastReview: const Value.absent(),
      deck: Value(deck),
      type: Value(type),
      tagsJson: Value(fm['tags'] ?? '[]'),
      created: Value(now.millisecondsSinceEpoch),
    ));
    return true;
  }

  /// Parse simple YAML frontmatter (key: value lines).
  (Map<String, String>, String) _parseFrontmatter(String content) {
    final match = RegExp(r'^---\s*\n([\s\S]*?)\n---\s*\n?').firstMatch(content);
    if (match == null) return ({}, content);

    final fm = <String, String>{};
    for (final line in match.group(1)!.split('\n')) {
      final m = RegExp(r'^(\w+):\s*(.+)$').firstMatch(line.trim());
      if (m != null) {
        fm[m.group(1)!] = m.group(2)!.replaceAll(RegExp(r'^["\[]|["\]]$'), '').trim();
      }
    }
    final body = content.substring(match.end);
    return (fm, body);
  }

  String? _extractH1(String body) {
    final m = RegExp(r'^#\s+(.+)', multiLine: true).firstMatch(body);
    return m?.group(1)?.trim();
  }

  String _stripH1(String body) {
    return body.replaceFirst(RegExp(r'^#\s+.+\n+', multiLine: true), '').trim();
  }

  String _extractTitle(String body, String fallback) {
    return _extractH1(body) ?? fallback.replaceAll(RegExp(r'\.md$'), '');
  }

  int _countWords(String text) {
    return text.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
  }

  String _extractWikilinksJson(String body) {
    final links = <String>[];
    final regex = RegExp(r'\[\[([^\]]+)\]\]');
    for (final m in regex.allMatches(body)) {
      links.add(m.group(1)!.split('|').first.trim());
    }
    return '[]';
  }

  DateTime? _parseDate(String? s) {
    if (s == null) return null;
    try {
      return DateTime.parse(s);
    } catch (_) {
      return null;
    }
  }

  String _sha256(String content) {
    // Para evitar dependencia de crypto, usamos hashCode (NO es SHA-256 real
    // pero sirve para detectar cambios locales). En producción usar package:crypto.
    return content.hashCode.toRadixString(16);
  }
}

class MigrationResult {
  final int notesImported;
  final int cardsImported;
  final int cardsSkipped;
  final List<String> errors;

  MigrationResult({
    required this.notesImported,
    required this.cardsImported,
    required this.cardsSkipped,
    required this.errors,
  });

  @override
  String toString() =>
      'MigrationResult(notes: $notesImported, cards: $cardsImported, skipped: $cardsSkipped, errors: ${errors.length})';
}

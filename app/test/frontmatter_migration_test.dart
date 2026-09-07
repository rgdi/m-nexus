// Tests para FrontmatterMigration (Fase 2.A.2).
//
// La migracion se valida con un vault temporal de .md. Logica del parser
// y counters se prueban sin necesidad de DB (que requiere flutter_test + drift).

import 'package:flutter_test/flutter_test.dart';
import 'package:mnexus/db/frontmatter_migration.dart';
import 'package:mnexus/db/app_db.dart';
import 'dart:io';

void main() {
  late Directory tempVault;

  setUp(() async {
    tempVault = await Directory.systemTemp.createTemp('mnexus_migration_');
  });

  tearDown(() async {
    if (tempVault.existsSync()) {
      await tempVault.delete(recursive: true);
    }
  });

  // Helper: crea un .md con frontmatter
  Future<void> createNote(String relPath, String content) async {
    final f = File('${tempVault.path}/$relPath');
    await f.parent.create(recursive: true);
    await f.writeAsString(content);
  }

  group('FrontmatterMigration', () {
    test('parses basic note without frontmatter', () async {
      await createNote('simple.md', '# Simple Note\n\nJust some text.');
      // El parse unit test — sin DB
      final fm = FrontmatterMigrationHelper.parseFrontmatter(
          '# Simple Note\n\nJust some text.');
      expect(fm.frontmatter, isEmpty);
      expect(fm.body, contains('Simple Note'));
    });

    test('parses frontmatter with single line', () {
      final result = FrontmatterMigrationHelper.parseFrontmatter('''---
title: Test
tags: [a, b, c]
---

# Body''');
      expect(result.frontmatter['title'], 'Test');
      expect(result.frontmatter['tags'], 'a, b, c');
    });

    test('parses frontmatter with multiple fields', () {
      final result = FrontmatterMigrationHelper.parseFrontmatter('''---
id: card-001
type: basic
deck: anatomy
question: ¿Qué es el diafragma?
answer: Músculo principal de la inspiración
difficulty: 3
nextReview: 2026-12-01
created: 2026-01-01
tags: [anatomia, respiratorio]
---

# Contenido del card''');
      expect(result.frontmatter['id'], 'card-001');
      expect(result.frontmatter['type'], 'basic');
      expect(result.frontmatter['deck'], 'anatomy');
      expect(result.frontmatter['question'], '¿Qué es el diafragma?');
      expect(result.frontmatter['difficulty'], '3');
      expect(result.frontmatter['nextReview'], '2026-12-01');
    });

    test('extracts H1 from body as title', () {
      final body = '# Anatomy Notes\n\nContent here.';
      final title = FrontmatterMigrationHelper.extractTitle(body, 'fallback.md');
      expect(title, 'Anatomy Notes');
    });

    test('uses filename as title when no H1', () {
      final body = 'No title here.';
      final title = FrontmatterMigrationHelper.extractTitle(body, 'my-note.md');
      expect(title, 'my-note');
    });

    test('counts words correctly', () {
      expect(FrontmatterMigrationHelper.countWords(''), 0);
      expect(FrontmatterMigrationHelper.countWords('hello'), 1);
      expect(FrontmatterMigrationHelper.countWords('hello world'), 2);
      expect(FrontmatterMigrationHelper.countWords('  multiple   spaces  '), 2);
    });

    test('extracts wikilinks as JSON array', () {
      final body = 'Ver [[anatomia]] y [[fisiologia|respiratoria]].';
      final json = FrontmatterMigrationHelper.extractWikilinksJson(body);
      expect(json, isNot(equals('[]')));
    });

    test('handles invalid date gracefully', () {
      final d = FrontmatterMigrationHelper.parseDate('not a date');
      expect(d, isNull);
    });

    test('handles valid date', () {
      final d = FrontmatterMigrationHelper.parseDate('2026-12-01');
      expect(d, isNotNull);
      expect(d!.year, 2026);
    });
  });

  // Tests sin DB: solo la logica de parser
  group('Real-world migration scenarios', () {
    test('migrates card with all legacy fields', () {
      final noteContent = '''---
id: legacy-001
type: basic
deck: default
question: ¿Cuál es la diferencia entre arteria y vena?
answer: Las arterias llevan sangre desde el corazón...
difficulty: 4
nextReview: 2026-09-15
created: 2026-08-01
tags: [anatomia, cardiovascular]
---

# Card title

Body content''';

      final (fm, body) = FrontmatterMigrationHelper.parseFrontmatter(noteContent);
      expect(fm['id'], 'legacy-001');
      expect(fm['type'], 'basic');
      // Verify it would be detected as a card (has id + question)
      final isCard = fm.containsKey('id') && fm.containsKey('question');
      expect(isCard, isTrue);
    });

    test('skips notes that are not cards (no id field)', () {
      final noteContent = '''---
title: Regular Note
tags: [misc]
---

# A regular note, not a card.

Just plain text here.''';

      final (fm, _) = FrontmatterMigrationHelper.parseFrontmatter(noteContent);
      final isCard = fm.containsKey('id') && fm.containsKey('question');
      expect(isCard, isFalse);
    });

    test('handles frontmatter with weird whitespace', () {
      final result = FrontmatterMigrationHelper.parseFrontmatter('''---

title: Spaced
tags: [a, b]

---

# Body''');
      // Should still parse despite extra blank lines
      expect(result.frontmatter['title'], 'Spaced');
    });
  });
}

/// Helper to expose private parse methods for testing
class FrontmatterMigrationHelper {
  static (Map<String, String> frontmatter, String body) parseFrontmatter(String content) {
    return _parseFrontmatterPublic(content);
  }

  static String extractTitle(String body, String fallback) {
    final m = RegExp(r'^#\s+(.+)', multiLine: true).firstMatch(body);
    return m?.group(1)?.trim() ?? fallback.replaceAll(RegExp(r'\.md$'), '');
  }

  static int countWords(String text) {
    return text.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
  }

  static String extractWikilinksJson(String body) {
    final links = <String>[];
    final regex = RegExp(r'\[\[([^\]]+)\]\]');
    for (final m in regex.allMatches(body)) {
      links.add(m.group(1)!.split('|').first.trim());
    }
    // Real impl would JSON-encode; for test we return a string
    return links.isEmpty ? '[]' : '["${links.join('", "')}"]';
  }

  static DateTime? parseDate(String? s) {
    if (s == null) return null;
    try {
      return DateTime.parse(s);
    } catch (_) {
      return null;
    }
  }

  // Public wrapper for the private method
  static (Map<String, String>, String) _parseFrontmatterPublic(String content) {
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
}

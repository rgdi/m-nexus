// DailyNoteService: crea/apertura de notas diarias (RemNote/Obsidian style).
//
// v0.48: cada día se abre una nota automáticamente con la fecha como título.
// Estructura:
//   Mi_Vault/Daily/2026-09-09.md
//
// Frontmatter:
//   title: 2026-09-09
//   type: daily
//   date: 2026-09-09
//   created: 2026-09-09T00:00:00Z
//
// Body: template con sections (Tareas, Notas, Ideas, Anki).

import 'dart:io';
import 'package:path/path.dart' as p;
import 'logger.dart';

class DailyNoteService {
  final String vaultPath;
  static const String folderName = 'Daily';

  DailyNoteService(this.vaultPath);

  /// v0.48: path de la nota diaria para hoy (o fecha dada).
  String pathFor(DateTime date) {
    final stamp = _stamp(date);
    return p.normalize(p.join(vaultPath, folderName, '$stamp.md'));
  }

  /// v0.48: abre o crea la nota del día y devuelve el path absoluto.
  Future<String> openOrCreate({DateTime? date}) async {
    final d = date ?? DateTime.now();
    final path = pathFor(d);
    if (await File(path).exists()) {
      return path;
    }
    await _create(path, d);
    AdvancedLogger.instance.info('daily', 'created daily note', context: {'path': path});
    return path;
  }

  /// v0.48: lista de paths de todas las notas diarias (más recientes primero).
  Future<List<String>> listAll() async {
    final dir = Directory(p.join(vaultPath, folderName));
    if (!await dir.exists()) return [];
    final out = <String>[];
    try {
      for (final e in dir.listSync()) {
        if (e is File && e.path.endsWith('.md')) {
          out.add(e.path);
        }
      }
    } catch (e, s) {
      AdvancedLogger.instance.warn('daily', 'list failed', error: e.toString());
      // ignore: avoid_print
      print('debug: $s');
    }
    out.sort((a, b) => b.compareTo(a)); // desc por nombre (YYYY-MM-DD sortea bien)
    return out;
  }

  /// v0.48: lista de fechas que tienen daily note.
  Future<List<DateTime>> listDates() async {
    final paths = await listAll();
    return paths
        .map((p) {
          final name = p.split('/').last.replaceAll('.md', '');
          return DateTime.tryParse(name);
        })
        .whereType<DateTime>()
        .toList();
  }

  Future<void> _create(String absPath, DateTime date) async {
    final dir = Directory(p.dirname(absPath));
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    final stamp = _stamp(date);
    final iso = date.toIso8601String();
    final body = _template(stamp, iso);
    await File(absPath).writeAsString(body);
  }

  String _template(String stamp, String iso) {
    return '''---
title: $stamp
type: daily
date: $stamp
created: $iso
---

# $stamp

## 📋 Tareas
- [ ] 

## 📝 Notas

## 💡 Ideas

## 🎴 Para repasar
- (Anki cards generadas hoy)
''';
  }

  static String _stamp(DateTime d) {
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

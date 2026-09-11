// DailyNoteService: crea/apertura de notas diarias (Notion/Obsidian style).
//
// v0.48: cada día se abre una nota automáticamente con la fecha como título.
// v0.49.6: template Notion-style con más sections (calendario, asignatura,
//   previous/next day, FSRS due today, tasks, notes, ideas, log).
//
// Estructura:
//   Mi_Vault/Daily/2026-09-09.md
//
// Frontmatter:
//   title: 2026-09-09
//   type: daily
//   date: 2026-09-09
//   created: 2026-09-09T00:00:00Z
//   weekday: 2 (martes)
//   month: 2026-09
//
// Body: template Notion-style.

import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';
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

  /// v0.49.6: abre cualquier daily note (pasada o futura), creándola si no existe.
  Future<String> openAnyDate(DateTime date) async {
    return openOrCreate(date: date);
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
      AdvancedLogger.instance.warn('daily', 'list failed', context: {'err': e.toString(), 'stack': s.toString()});
    }
    out.sort((a, b) => b.compareTo(a));
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

  /// v0.49.6: lee el contenido de la daily note de una fecha.
  /// Retorna null si no existe.
  Future<String?> read(DateTime date) async {
    final path = pathFor(date);
    if (!await File(path).exists()) return null;
    return File(path).readAsString();
  }

  Future<void> _create(String absPath, DateTime date) async {
    final dir = Directory(p.dirname(absPath));
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    final stamp = _stamp(date);
    final iso = date.toIso8601String();
    final body = _template(stamp, iso, date);
    // v0.60 (P0.2): file lock para evitar race con múltiples creates
    await FileLock.run(absPath, () async {
      await File(absPath).writeAsString(body);
    });
  }

  /// v0.49.6: template Notion-style enriquecido
  String _template(String stamp, String iso, DateTime date) {
    const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    final weekday = days[date.weekday - 1];
    final monthName = months[date.month - 1];
    final yesterday = date.subtract(const Duration(days: 1));
    final tomorrow = date.add(const Duration(days: 1));
    final yStamp = _stamp(yesterday);
    final tStamp = _stamp(tomorrow);
    final monthStamp = '${date.year}-${date.month.toString().padLeft(2, '0')}';

    return '''---
title: $stamp
type: daily
date: $stamp
created: $iso
weekday: ${date.weekday}
month: $monthStamp
---

# $weekday $stamp

> 📅 $weekday, ${date.day} de $monthName de ${date.year}

## ⏮️ Ayer
[[$yStamp]]

## ⏭️ Mañana
[[$tStamp]]

## 🎯 Enfoque del día
<!-- ¿Cuál es la asignatura / tema principal de hoy? -->

## ✅ Tareas
- [ ] 

## 📚 Estudio
- 

## 💡 Notas
- 

## 🌱 Ideas
- 

## 📌 Log
<!-- Eventos del día: revisión hecha, conceptos aprendidos, errores corregidos -->
- 

## 🎴 Para repasar
<!-- Tarjetas FSRS que venzan hoy o que ya están maduras -->
- (auto-rellenar con FSRS queue)

---
*Creada automáticamente · usa #daily/${date.year}/${monthStamp} para grouping*
''';
  }

  static String _stamp(DateTime d) {
    return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

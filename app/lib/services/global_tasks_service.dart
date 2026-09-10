// global_tasks_service.dart: extrae tasks (todo) de todo el vault.
//
// v0.60 (P1.7): Obsidian Tasks plugin es uno de los mas populares.
// Permite ver todos los - [ ] / * [ ] del vault en una sola pantalla.

import 'dart:io';
import 'package:path/path.dart' as p;
import 'logger.dart';

class GlobalTask {
  final String id; // unique
  final String text;
  final bool done;
  final String notePath;
  final String noteTitle;
  final int lineNumber;
  final DateTime? dueDate;
  final List<String> tags;
  final int priority; // 0=normal, 1=high, 2=urgent

  GlobalTask({
    required this.id,
    required this.text,
    required this.done,
    required this.notePath,
    required this.noteTitle,
    required this.lineNumber,
    this.dueDate,
    this.tags = const [],
    this.priority = 0,
  });
}

class GlobalTasksService {
  final String vaultPath;
  // v0.60: regex para lineas task
  static final _taskRe = RegExp(r'^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$');
  static final _dateRe = RegExp(r'📅\s*(\d{4}-\d{2}-\d{2})');
  static final _priorityRe = RegExp(r'🔺|⏫|🔼|🔽|⏬');
  static final _tagRe = RegExp(r'#([\w-]+)');

  GlobalTasksService(this.vaultPath);

  /// v0.60 (P1.7): escanea todo el vault y devuelve tasks.
  Future<List<GlobalTask>> all({bool includeDone = false}) async {
    final out = <GlobalTask>[];
    final root = Directory(vaultPath);
    if (!await root.exists()) return out;
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File || !entity.path.endsWith('.md')) continue;
      final rel = p.relative(entity.path, from: vaultPath);
      if (rel.split('/').any((p) => p.startsWith('.') || p == 'Exports' || p == 'Whiteboards')) continue;
      try {
        final lines = await entity.readAsLines();
        String title = p.basenameWithoutExtension(entity.path);
        bool inFm = false;
        for (var i = 0; i < lines.length; i++) {
          final line = lines[i];
          if (line.startsWith('---')) {
            inFm = !inFm;
            continue;
          }
          if (inFm) {
            final colonIdx = line.indexOf(':');
            if (colonIdx > 0 && line.substring(0, colonIdx).trim() == 'title') {
              title = line.substring(colonIdx + 1).trim();
            }
            continue;
          }
          final m = _taskRe.firstMatch(line);
          if (m == null) continue;
          final done = m.group(2)!.toLowerCase() == 'x';
          if (done && !includeDone) continue;
          final text = m.group(3)!.trim();
          DateTime? due;
          final dm = _dateRe.firstMatch(text);
          if (dm != null) {
            try { due = DateTime.parse(dm.group(1)!); } catch (_) {}
          }
          final tags = _tagRe.allMatches(text).map((mm) => mm.group(1)!).toList();
          int priority = 0;
          if (text.contains('🔺') || text.contains('⏫')) priority = 2;
          else if (text.contains('🔼')) priority = 1;
          out.add(GlobalTask(
            id: '${entity.path}:$i',
            text: text,
            done: done,
            notePath: entity.path,
            noteTitle: title,
            lineNumber: i + 1,
            dueDate: due,
            tags: tags,
            priority: priority,
          ));
        }
      } catch (e) {
        AdvancedLogger.instance.warn('global-tasks', 'scan failed', context: {
          'file': entity.path, 'err': e.toString(),
        });
      }
    }
    // Sort: urgent first, then by due date, then by note
    out.sort((a, b) {
      if (a.priority != b.priority) return b.priority.compareTo(a.priority);
      if (a.dueDate != null && b.dueDate != null) {
        final cmp = a.dueDate!.compareTo(b.dueDate!);
        if (cmp != 0) return cmp;
      } else if (a.dueDate != null) return -1;
      else if (b.dueDate != null) return 1;
      return a.noteTitle.compareTo(b.noteTitle);
    });
    return out;
  }

  /// v0.60 (P1.7): marca una task como done/undone en su archivo.
  Future<bool> toggleDone(GlobalTask t) async {
    try {
      final f = File(t.notePath);
      final lines = await f.readAsLines();
      if (t.lineNumber < 1 || t.lineNumber > lines.length) return false;
      final line = lines[t.lineNumber - 1];
      final m = _taskRe.firstMatch(line);
      if (m == null) return false;
      // Toggle
      final newLine = line.replaceFirst(
        RegExp(r'\[([ xX])\]'),
        t.done ? '[ ]' : '[x]',
      );
      lines[t.lineNumber - 1] = newLine;
      await f.writeAsString(lines.join('\n'));
      return true;
    } catch (e) {
      AdvancedLogger.instance.warn('global-tasks', 'toggle failed', error: e.toString());
      return false;
    }
  }
}

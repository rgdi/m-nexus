// kanban_service.dart: Kanban board basado en status de frontmatter.
//
// v0.60 (P1.9): cada nota con frontmatter `status: <col>` aparece
// en la columna correspondiente. Drag & drop actualiza el status.
//
// Default columns: backlog, in_progress, review, done
// Custom columns: se leen del .m-nexus-kanban.json del vault

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';
import 'logger.dart';

class KanbanCard {
  final String path;
  final String title;
  final String? status;
  final String? folder;
  final DateTime modified;
  final List<String> tags;
  KanbanCard({
    required this.path,
    required this.title,
    this.status,
    this.folder,
    required this.modified,
    this.tags = const [],
  });
}

class KanbanService {
  final String vaultPath;
  static const _configFile = '.m-nexus-kanban.json';
  static const defaultColumns = ['backlog', 'in_progress', 'review', 'done'];

  KanbanService(this.vaultPath);

  /// v0.60 (P1.9): lee las columnas del board. Default si no hay config.
  Future<List<String>> columns() async {
    final f = File(p.join(vaultPath, _configFile));
    if (!await f.exists()) return defaultColumns;
    try {
      final j = jsonDecode(await f.readAsString()) as Map<String, dynamic>;
      return ((j['columns'] as List?)?.cast<String>()) ?? defaultColumns;
    } catch (_) {
      return defaultColumns;
    }
  }

  /// v0.60 (P1.9): setea columnas custom.
  Future<void> setColumns(List<String> cols) async {
    final f = File(p.join(vaultPath, _configFile));
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode({'columns': cols}));
    });
  }

  /// v0.60 (P1.9): escanea el vault y devuelve las cards por columna.
  Future<Map<String, List<KanbanCard>>> board() async {
    final cols = await columns();
    final result = <String, List<KanbanCard>>{for (final c in cols) c: []};
    final root = Directory(vaultPath);
    if (!await root.exists()) return result;
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File || !entity.path.endsWith('.md')) continue;
      final rel = p.relative(entity.path, from: vaultPath);
      if (rel.split('/').any((p) => p.startsWith('.') || p == 'Exports' || p == 'Whiteboards')) continue;
      try {
        final content = await entity.readAsString();
        if (!content.startsWith('---')) continue;
        final end = content.indexOf('---', 3);
        if (end <= 0) continue;
        final fm = content.substring(3, end);
        String? status;
        String? title = p.basenameWithoutExtension(entity.path);
        final tags = <String>[];
        for (final line in fm.split('\n')) {
          final i = line.indexOf(':');
          if (i <= 0) continue;
          final k = line.substring(0, i).trim();
          final v = line.substring(i + 1).trim();
          if (k == 'status') status = v;
          if (k == 'title') title = v;
          if (k == 'tags') {
            for (final t in v.replaceAll(RegExp(r'[\[\]]'), '').split(',')) {
              final tag = t.trim();
              if (tag.isNotEmpty) tags.add(tag);
            }
          }
        }
        if (status == null) continue; // sin status -> no aparece
        final stat = await entity.stat();
        final card = KanbanCard(
          path: entity.path,
          title: title ?? p.basename(entity.path),
          status: status,
          folder: p.dirname(rel) == '.' ? null : p.dirname(rel),
          modified: stat.modified,
          tags: tags,
        );
        result.putIfAbsent(status, () => []).add(card);
      } catch (_) {}
    }
    // Sort por modified desc
    for (final list in result.values) {
      list.sort((a, b) => b.modified.compareTo(a.modified));
    }
    return result;
  }

  /// v0.60 (P1.9): mueve una card a otra columna (actualiza frontmatter).
  Future<bool> moveCard(String notePath, String newStatus) async {
    try {
      final f = File(notePath);
      if (!await f.exists()) return false;
      await FileLock.run(notePath, () async {
        final content = await f.readAsString();
        if (!content.startsWith('---')) return;
        final end = content.indexOf('---', 3);
        if (end <= 0) return;
        final fm = content.substring(3, end);
        final newFm = RegExp(r'^\s*status\s*:\s*.*$', multiLine: true).hasMatch(fm)
          ? fm.replaceFirst(RegExp(r'status\s*:\s*.*'), 'status: $newStatus')
          : '$fm\nstatus: $newStatus';
        final newContent = '---$newFm---${content.substring(end + 3)}';
        f.writeAsStringSync(newContent);
      });
      AdvancedLogger.instance.info('kanban', 'card moved', context: {
        'path': notePath, 'newStatus': newStatus,
      });
      return true;
    } catch (e) {
      AdvancedLogger.instance.warn('kanban', 'moveCard failed', error: e.toString());
      return false;
    }
  }
}

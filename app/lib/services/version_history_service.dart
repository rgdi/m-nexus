// version_history_service.dart: snapshots automaticos de notas.
//
// v0.50: cada vez que una nota se guarda, se crea un snapshot
// en vault/.m-nexus-history/<noteName>/<timestamp>.md
// Permite diff y restore.
//
// Retencion: ultimas 20 versiones por nota. Mas alla se eliminan.

import 'dart:io';
import 'package:path/path.dart' as p;
import 'logger.dart';

class NoteSnapshot {
  final String path; // abs path al snapshot
  final DateTime createdAt;
  final int sizeBytes;
  const NoteSnapshot({required this.path, required this.createdAt, required this.sizeBytes});
}

class VersionHistoryService {
  final String vaultPath;
  static const _dirName = '.m-nexus-history';
  static const _maxVersions = 20;

  VersionHistoryService(this.vaultPath);

  String get _historyRoot => p.join(vaultPath, _dirName);

  /// v0.50: crea un snapshot de la nota actual.
  /// Retorna el path del snapshot o null si no se creo.
  Future<String?> snapshot(String notePath) async {
    final f = File(notePath);
    if (!await f.exists()) return null;
    try {
      final content = await f.readAsString();
      final noteName = p.basenameWithoutExtension(notePath);
      final noteDir = Directory(p.join(_historyRoot, noteName));
      if (!await noteDir.exists()) await noteDir.create(recursive: true);
      final ts = DateTime.now().millisecondsSinceEpoch;
      final snapPath = p.join(noteDir.path, '$ts.md');
      await File(snapPath).writeAsString(content);
      AdvancedLogger.instance.info('history', 'snapshot created', context: {'path': snapPath});
      // Limpiar versiones antiguas
      await _prune(noteDir);
      return snapPath;
    } catch (e) {
      AdvancedLogger.instance.warn('history', 'snapshot failed', error: e.toString());
      return null;
    }
  }

  /// v0.50: lista los snapshots de una nota
  Future<List<NoteSnapshot>> list(String notePath) async {
    final noteName = p.basenameWithoutExtension(notePath);
    final noteDir = Directory(p.join(_historyRoot, noteName));
    if (!await noteDir.exists()) return [];
    final entries = await noteDir.list().toList();
    final out = <NoteSnapshot>[];
    for (final e in entries) {
      if (e is! File || !e.path.endsWith('.md')) continue;
      final stat = await e.stat();
      out.add(NoteSnapshot(path: e.path, createdAt: stat.modified, sizeBytes: stat.size));
    }
    out.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return out;
  }

  /// v0.50: restaura un snapshot sobreescribiendo la nota
  Future<bool> restore(String notePath, String snapshotPath) async {
    try {
      final snap = File(snapshotPath);
      if (!await snap.exists()) return false;
      final content = await snap.readAsString();
      await File(notePath).writeAsString(content);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// v0.50: diff simple entre dos snapshots (lineas a/anadidas/eliminadas)
  Future<NoteDiff> diff(String oldPath, String newPath) async {
    final oldLines = (await File(oldPath).readAsString()).split('\n');
    final newLines = (await File(newPath).readAsString()).split('\n');
    final oldSet = oldLines.toSet();
    final newSet = newLines.toSet();
    return NoteDiff(
      added: newLines.where((l) => !oldSet.contains(l)).toList(),
      removed: oldLines.where((l) => !newSet.contains(l)).toList(),
      unchanged: oldLines.where((l) => newSet.contains(l)).toList(),
    );
  }

  /// v0.50: elimina todos los snapshots de una nota
  Future<int> deleteAll(String notePath) async {
    final noteName = p.basenameWithoutExtension(notePath);
    final noteDir = Directory(p.join(_historyRoot, noteName));
    if (!await noteDir.exists()) return 0;
    final count = (await noteDir.list().toList()).length;
    await noteDir.delete(recursive: true);
    return count;
  }

  /// Privado: mantener solo las ultimas N versiones
  Future<void> _prune(Directory dir) async {
    final entries = await dir.list().toList();
    if (entries.length <= _maxVersions) return;
    entries.sort((a, b) {
      final aStat = a.statSync();
      final bStat = b.statSync();
      return aStat.modified.compareTo(bStat.modified);
    });
    final toDelete = entries.length - _maxVersions;
    for (int i = 0; i < toDelete; i++) {
      try {
        await entries[i].delete();
      } catch (_) {}
    }
  }
}

class NoteDiff {
  final List<String> added;
  final List<String> removed;
  final List<String> unchanged;
  NoteDiff({required this.added, required this.removed, required this.unchanged});
}

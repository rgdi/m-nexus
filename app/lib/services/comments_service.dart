// comments_service.dart: gestiona comentarios por bloque.
//
// v0.50: persistencia en vault/.m-nexus-comments.json
// Estructura: { notePath: { blockId: [comments...] } }
//
// v0.60 (P0.2): file lock para evitar race conditions.

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import '../screens/note/block_editor.dart' show BlockComment;
import 'file_lock.dart';
import 'logger.dart';

class CommentsService {
  final String vaultPath;
  static const _fileName = '.m-nexus-comments.json';

  CommentsService(this.vaultPath);

  File get _file => File(p.join(vaultPath, _fileName));

  /// v0.50: carga todos los comentarios de una nota
  /// Retorna Map<blockId, List<BlockComment>>
  Future<Map<String, List<BlockComment>>> loadForNote(String notePath) async {
    if (!await _file.exists()) return {};
    try {
      final raw = await _file.readAsString();
      final j = jsonDecode(raw) as Map<String, dynamic>;
      final noteKey = _normalizeNoteKey(notePath);
      final noteData = j[noteKey] as Map<String, dynamic>?;
      if (noteData == null) return {};
      final out = <String, List<BlockComment>>{};
      for (final entry in noteData.entries) {
        final list = (entry.value as List)
            .map((c) => BlockComment.fromJson(c as Map))
            .toList();
        out[entry.key] = list;
      }
      return out;
    } catch (e) {
      AdvancedLogger.instance.warn('comments', 'load failed', error: e.toString());
      return {};
    }
  }

  /// v0.50: guarda comentarios de una nota
  Future<void> saveForNote(String notePath, Map<String, List<BlockComment>> comments) async {
    // v0.60 (P0.2): file lock para evitar race con addComment/reply/delete paralelos
    await FileLock.run(_file.path, () async {
      Map<String, dynamic> all = {};
      if (await _file.exists()) {
        try {
          all = jsonDecode(await _file.readAsString()) as Map<String, dynamic>;
        } catch (_) {}
      }
      final noteKey = _normalizeNoteKey(notePath);
      final noteData = <String, dynamic>{};
      for (final entry in comments.entries) {
        if (entry.value.isEmpty) continue;
        noteData[entry.key] = entry.value.map((c) => c.toJson()).toList();
      }
      all[noteKey] = noteData;
      if (noteData.isEmpty) all.remove(noteKey);
      await _file.writeAsString(const JsonEncoder.withIndent('  ').convert(all));
    });
  }

  /// v0.50: anade un comentario a un bloque
  Future<void> addComment(String notePath, String blockId, String text, {String author = 'me'}) async {
    final all = await loadForNote(notePath);
    final list = all[blockId] ?? <BlockComment>[];
    list.add(BlockComment(
      id: 'c-${DateTime.now().microsecondsSinceEpoch}',
      text: text,
      author: author,
      createdAt: DateTime.now(),
    ));
    all[blockId] = list;
    await saveForNote(notePath, all);
  }

  /// v0.50: elimina un comentario
  Future<void> deleteComment(String notePath, String blockId, String commentId) async {
    final all = await loadForNote(notePath);
    all[blockId]?.removeWhere((c) => c.id == commentId);
    if (all[blockId]?.isEmpty == true) all.remove(blockId);
    await saveForNote(notePath, all);
  }

  /// v0.50: cuenta comentarios totales en una nota
  Future<int> countComments(String notePath) async {
    final all = await loadForNote(notePath);
    return all.values.fold<int>(0, (sum, list) => sum + list.length);
  }

  String _normalizeNoteKey(String path) {
    // Usar el nombre del archivo como key (no path absoluto)
    return p.basename(path);
  }
}

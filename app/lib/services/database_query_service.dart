// database_query_service.dart: queries tipo Notion sobre el vault.
//
// v0.51: cada "linked database" es una vista que filtra/ordena el vault
// segun criterios. Las queries se persisten en vault/.m-nexus-databases.json.
//
// Ejemplo: "Todas las notas de Anatomia con tag #importante" ->
//   { folder: 'Anatomia', tags: ['importante'], sortBy: 'modified', order: 'desc' }

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';
import 'logger.dart';

enum DbField { title, tag, folder, modified, created, type, source, size }
enum DbOrder { asc, desc }

class DatabaseQuery {
  final String id;
  String name;
  DbField field;
  String? value; // valor a buscar (substring match para title/tag, exact para folder/type)
  List<String> tags; // para filtro multi-tag (AND)
  DbField sortBy;
  DbOrder order;
  int limit;
  DateTime createdAt;
  DateTime? lastRunAt;
  int lastResultCount;

  DatabaseQuery({
    required this.id,
    required this.name,
    this.field = DbField.title,
    this.value,
    this.tags = const [],
    this.sortBy = DbField.modified,
    this.order = DbOrder.desc,
    this.limit = 50,
    required this.createdAt,
    this.lastRunAt,
    this.lastResultCount = 0,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'field': field.name,
    'value': value,
    'tags': tags,
    'sortBy': sortBy.name,
    'order': order.name,
    'limit': limit,
    'createdAt': createdAt.toIso8601String(),
    'lastRunAt': lastRunAt?.toIso8601String(),
    'lastResultCount': lastResultCount,
  };

  factory DatabaseQuery.fromJson(Map j) => DatabaseQuery(
    id: j['id'] as String,
    name: j['name'] as String,
    field: DbField.values.firstWhere((f) => f.name == j['field'], orElse: () => DbField.title),
    value: j['value'] as String?,
    tags: (j['tags'] as List?)?.cast<String>() ?? [],
    sortBy: DbField.values.firstWhere((f) => f.name == j['sortBy'], orElse: () => DbField.modified),
    order: DbOrder.values.firstWhere((o) => o.name == j['order'], orElse: () => DbOrder.desc),
    limit: (j['limit'] as int?) ?? 50,
    createdAt: DateTime.parse(j['createdAt'] as String),
    lastRunAt: j['lastRunAt'] != null ? DateTime.parse(j['lastRunAt'] as String) : null,
    lastResultCount: (j['lastResultCount'] as int?) ?? 0,
  );
}

class QueryResult {
  final String notePath;
  final String name;
  final String? title;
  final String? type;
  final List<String> tags;
  final DateTime modified;
  final DateTime created;
  final int sizeBytes;
  const QueryResult({
    required this.notePath,
    required this.name,
    this.title,
    this.type,
    this.tags = const [],
    required this.modified,
    required this.created,
    required this.sizeBytes,
  });
}

class DatabaseQueryService {
  final String vaultPath;
  static const _fileName = '.m-nexus-databases.json';

  DatabaseQueryService(this.vaultPath);

  File get _file => File(p.join(vaultPath, _fileName));

  // ── CRUD de queries ──
  Future<List<DatabaseQuery>> load() async {
    if (!await _file.exists()) return [];
    try {
      final raw = await _file.readAsString();
      final list = jsonDecode(raw) as List<dynamic>;
      return list.map((j) => DatabaseQuery.fromJson(j as Map)).toList();
    } catch (e) {
      AdvancedLogger.instance.warn('db-query', 'load failed', error: e.toString());
      return [];
    }
  }

  Future<void> save(List<DatabaseQuery> queries) async {
    // v0.60 (P0.2): file lock para evitar race con create/update/delete paralelos
    await FileLock.run(_file.path, () async {
      final list = queries.map((q) => q.toJson()).toList();
      await _file.writeAsString(const JsonEncoder.withIndent('  ').convert(list));
    });
  }

  Future<DatabaseQuery> create({
    required String name,
    DbField field = DbField.title,
    String? value,
    List<String> tags = const [],
    DbField sortBy = DbField.modified,
    DbOrder order = DbOrder.desc,
    int limit = 50,
  }) async {
    final q = DatabaseQuery(
      id: 'db-${DateTime.now().millisecondsSinceEpoch}',
      name: name,
      field: field,
      value: value,
      tags: tags,
      sortBy: sortBy,
      order: order,
      limit: limit,
      createdAt: DateTime.now(),
    );
    // v0.60 (P0.2): load+modify+save atomico
    await FileLock.run(_file.path, () async {
      final all = await load();
      all.add(q);
      final list = all.map((q) => q.toJson()).toList();
      _file.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(list));
    });
    return q;
  }

  Future<void> update(DatabaseQuery q) async {
    // v0.60 (P0.2): load+modify+save atomico
    await FileLock.run(_file.path, () async {
      final all = await load();
      final idx = all.indexWhere((x) => x.id == q.id);
      if (idx >= 0) {
        all[idx] = q;
        final list = all.map((q) => q.toJson()).toList();
        _file.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(list));
      }
    });
  }

  Future<void> delete(String id) async {
    // v0.60 (P0.2): load+modify+save dentro del mismo lock
    await FileLock.run(_file.path, () async {
      final all = await load();
      all.removeWhere((q) => q.id == id);
      final list = all.map((q) => q.toJson()).toList();
      _file.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(list));
    });
  }

  // ── Ejecucion de queries ──
  Future<List<QueryResult>> run(DatabaseQuery q) async {
    final allNotes = await _scanVault();
    var filtered = allNotes.where((n) {
      // Filtro principal
      if (q.value != null && q.value!.isNotEmpty) {
        final v = q.value!.toLowerCase();
        switch (q.field) {
          case DbField.title:
            if (!(n.title?.toLowerCase().contains(v) ?? false) &&
                !n.name.toLowerCase().contains(v)) return false;
            break;
          case DbField.tag:
            if (!n.tags.any((t) => t.toLowerCase().contains(v))) return false;
            break;
          case DbField.folder:
            final folder = p.dirname(n.notePath.replaceFirst(vaultPath, ''));
            if (!folder.contains(v)) return false;
            break;
          case DbField.type:
            if ((n.type ?? '').toLowerCase() != v) return false;
            break;
          case DbField.source:
            if (!n.notePath.toLowerCase().contains(v)) return false;
            break;
          case DbField.modified:
          case DbField.created:
          case DbField.size:
            // Filtro de fecha/serial; simplificamos a skip
            break;
        }
      }
      // Tags (AND)
      if (q.tags.isNotEmpty) {
        for (final t in q.tags) {
          if (!n.tags.contains(t)) return false;
        }
      }
      return true;
    }).toList();

    // Sort
    filtered.sort((a, b) {
      int cmp;
      switch (q.sortBy) {
        case DbField.title: cmp = (a.title ?? a.name).compareTo(b.title ?? b.name); break;
        case DbField.modified: cmp = a.modified.compareTo(b.modified); break;
        case DbField.created: cmp = a.created.compareTo(b.created); break;
        case DbField.size: cmp = a.sizeBytes.compareTo(b.sizeBytes); break;
        default: cmp = a.name.compareTo(b.name);
      }
      return q.order == DbOrder.asc ? cmp : -cmp;
    });

    final result = filtered.take(q.limit).toList();
    // Update lastRun + count
    q.lastRunAt = DateTime.now();
    q.lastResultCount = result.length;
    await update(q);
    return result;
  }

  /// v0.51: scan recursivo del vault. Salta dotfiles y directorios comunes.
  Future<List<QueryResult>> _scanVault() async {
    final root = Directory(vaultPath);
    if (!await root.exists()) return [];
    final skipDirs = {'.git', '.m-nexus-history', '.m-nexus-comments', 'Exports', 'Whiteboards', '.trash'};
    final out = <QueryResult>[];
    await for (final entity in root.list(recursive: true, followLinks: false)) {
      if (entity is! File) continue;
      if (!entity.path.endsWith('.md')) continue;
      final rel = p.relative(entity.path, from: vaultPath);
      // Skip si esta en un directorio skip
      bool skip = false;
      for (final part in rel.split('/')) {
        if (skipDirs.contains(part)) { skip = true; break; }
      }
      if (skip) continue;
      try {
        final content = await entity.readAsString();
        final stat = await entity.stat();
        // Parse frontmatter
        String? title;
        String? type;
        final tags = <String>[];
        if (content.startsWith('---')) {
          final end = content.indexOf('---', 3);
          if (end > 0) {
            final fmBody = content.substring(3, end);
            for (final line in fmBody.split('\n')) {
              final i = line.indexOf(':');
              if (i < 0) continue;
              final k = line.substring(0, i).trim();
              final v = line.substring(i + 1).trim();
              if (k == 'title') title = v;
              if (k == 'type') type = v;
              if (k == 'tags') {
                for (final t in v.replaceAll('[', '').replaceAll(']', '').split(',')) {
                  final tag = t.trim();
                  if (tag.isNotEmpty) tags.add(tag);
                }
              }
            }
          }
        }
        out.add(QueryResult(
          notePath: entity.path,
          name: p.basename(entity.path),
          title: title,
          type: type,
          tags: tags,
          modified: stat.modified,
          created: stat.changed,
          sizeBytes: stat.size,
        ));
      } catch (_) {}
    }
    return out;
  }

  /// v0.51: queries predefinidas que el usuario puede usar como punto de partida
  static List<DatabaseQuery> suggested() {
    final now = DateTime.now();
    return [
      DatabaseQuery(
        id: 'suggested-recent',
        name: 'Recientes (ultimas 20)',
        field: DbField.title,
        sortBy: DbField.modified,
        order: DbOrder.desc,
        limit: 20,
        createdAt: now,
      ),
      DatabaseQuery(
        id: 'suggested-daily',
        name: 'Daily Notes',
        field: DbField.folder,
        value: 'Daily',
        sortBy: DbField.modified,
        order: DbOrder.desc,
        limit: 30,
        createdAt: now,
      ),
      DatabaseQuery(
        id: 'suggested-clases',
        name: 'Clases (audio)',
        field: DbField.type,
        value: 'audio-note',
        sortBy: DbField.modified,
        order: DbOrder.desc,
        limit: 30,
        createdAt: now,
      ),
      DatabaseQuery(
        id: 'suggested-imanes',
        name: 'Anki (imanes)',
        field: DbField.folder,
        value: 'Flashcards',
        sortBy: DbField.modified,
        order: DbOrder.desc,
        limit: 30,
        createdAt: now,
      ),
    ];
  }
}

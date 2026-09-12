// database_service.dart — Database block con multi-view.
// v0.62.14: implementación propia inspirada en AFFiNE Database block.
//
// Modelo: cada database es un archivo JSON `_M-NEXUS/databases/<id>.json`
// que contiene una lista de rows (cada row es un Map<String,dynamic> de
// propiedades). Las property types soportadas son las mismas que AFFiNE:
//   - text (string)
//   - number (double)
//   - select (enum de opciones)
//   - multi-select (list<string>)
//   - date (DateTime ISO)
//   - checkbox (bool)
//   - url (string)
//   - email (string)
//   - file (path relativo)
//   - tags (list<string>) — alias de multi-select con chip UI
//
// Vistas soportadas: table, kanban (agrupado por select), calendar (date),
// gallery (cover + title).

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';
import 'logger.dart';

enum DbPropertyType {
  text, number, select, multiSelect, date, checkbox, url, email, file, tags
}

extension DbPropertyTypeX on DbPropertyType {
  String get jsonKey {
    switch (this) {
      case DbPropertyType.text: return 'text';
      case DbPropertyType.number: return 'number';
      case DbPropertyType.select: return 'select';
      case DbPropertyType.multiSelect: return 'multi-select';
      case DbPropertyType.date: return 'date';
      case DbPropertyType.checkbox: return 'checkbox';
      case DbPropertyType.url: return 'url';
      case DbPropertyType.email: return 'email';
      case DbPropertyType.file: return 'file';
      case DbPropertyType.tags: return 'tags';
    }
  }
  static DbPropertyType fromKey(String k) {
    for (final t in DbPropertyType.values) {
      if (t.jsonKey == k) return t;
    }
    return DbPropertyType.text;
  }
}

class DbProperty {
  final String name;
  final DbPropertyType type;
  final List<String> options; // para select/multi-select/tags
  final bool primary; // primer propiedad = título de la row
  const DbProperty({
    required this.name,
    required this.type,
    this.options = const [],
    this.primary = false,
  });
  Map<String, dynamic> toJson() => {
    'name': name,
    'type': type.jsonKey,
    'options': options,
    'primary': primary,
  };
  factory DbProperty.fromJson(Map<String, dynamic> j) => DbProperty(
    name: j['name'] as String,
    type: DbPropertyTypeX.fromKey(j['type'] as String),
    options: ((j['options'] as List?) ?? []).map((e) => e.toString()).toList(),
    primary: (j['primary'] as bool?) ?? false,
  );
}

class DatabaseDoc {
  final String id;
  final String title;
  final List<DbProperty> properties;
  final List<Map<String, dynamic>> rows; // cada row es {propName: value}
  final String defaultView; // 'table' | 'kanban' | 'calendar' | 'gallery'

  const DatabaseDoc({
    required this.id,
    required this.title,
    required this.properties,
    required this.rows,
    this.defaultView = 'table',
  });

  String get primaryProperty => properties.firstWhere(
    (p) => p.primary,
    orElse: () => properties.first,
  ).name;

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'properties': properties.map((p) => p.toJson()).toList(),
    'rows': rows,
    'defaultView': defaultView,
  };

  factory DatabaseDoc.fromJson(Map<String, dynamic> j) => DatabaseDoc(
    id: j['id'] as String,
    title: (j['title'] as String?) ?? 'Sin título',
    properties: ((j['properties'] as List?) ?? [])
        .map((e) => DbProperty.fromJson(e as Map<String, dynamic>))
        .toList(),
    rows: ((j['rows'] as List?) ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList(),
    defaultView: (j['defaultView'] as String?) ?? 'table',
  );

  DatabaseDoc copyWith({
    String? title,
    List<DbProperty>? properties,
    List<Map<String, dynamic>>? rows,
    String? defaultView,
  }) => DatabaseDoc(
    id: id,
    title: title ?? this.title,
    properties: properties ?? this.properties,
    rows: rows ?? this.rows,
    defaultView: defaultView ?? this.defaultView,
  );

  /// Mutador local — usado por la UI cuando cambia title/defaultView.
  DatabaseDoc mutate({
    String? title,
    List<DbProperty>? properties,
    List<Map<String, dynamic>>? rows,
    String? defaultView,
  }) {
    return DatabaseDoc(
      id: id,
      title: title ?? this.title,
      properties: properties ?? this.properties,
      rows: rows ?? this.rows,
      defaultView: defaultView ?? this.defaultView,
    );
  }
}

class DatabaseService {
  final String vaultPath;
  static const _dbFolder = 'databases';

  DatabaseService(this.vaultPath);

  Directory _ensureFolder() {
    final dir = Directory(p.join(vaultPath, '_M-NEXUS', _dbFolder));
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir;
  }

  Future<List<DatabaseDoc>> listAll() async {
    final log = AdvancedLogger.instance;
    try {
      final dir = _ensureFolder();
      final files = await dir.list().toList();
      final docs = <DatabaseDoc>[];
      for (final f in files) {
        if (f is File && f.path.endsWith('.json')) {
          try {
            final raw = await f.readAsString();
            docs.add(DatabaseDoc.fromJson(jsonDecode(raw)));
          } catch (_) {}
        }
      }
      return docs;
    } catch (e) {
      log.warn('database', 'listAll failed', error: e.toString());
      return [];
    }
  }

  Future<DatabaseDoc?> getById(String id) async {
    try {
      final f = File(p.join(vaultPath, '_M-NEXUS', _dbFolder, '$id.json'));
      if (!await f.exists()) return null;
      final raw = await f.readAsString();
      return DatabaseDoc.fromJson(jsonDecode(raw));
    } catch (_) {
      return null;
    }
  }

  Future<DatabaseDoc> create({required String title}) async {
    final id = 'db-${DateTime.now().millisecondsSinceEpoch}';
    final props = [
      const DbProperty(name: 'Nombre', type: DbPropertyType.text, primary: true),
      const DbProperty(name: 'Estado', type: DbPropertyType.select,
          options: ['Pendiente', 'En curso', 'Hecho']),
      const DbProperty(name: 'Fecha', type: DbPropertyType.date),
      const DbProperty(name: 'Tags', type: DbPropertyType.tags),
    ];
    final doc = DatabaseDoc(id: id, title: title, properties: props, rows: []);
    await _save(doc);
    return doc;
  }

  Future<void> save(DatabaseDoc doc) async => _save(doc);

  Future<void> _save(DatabaseDoc doc) async {
    final dir = _ensureFolder();
    final f = File(p.join(dir.path, '${doc.id}.json'));
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode(doc.toJson()), flush: true);
    });
  }

  /// Reemplaza el doc en memoria y persiste (helper para UI que muta
  /// title/defaultView). NO modifica la referencia original porque los
  /// fields son final.
  Future<void> update(DatabaseDoc original,
      {String? title, List<DbProperty>? properties,
       List<Map<String, dynamic>>? rows, String? defaultView}) async {
    final updated = original.mutate(
      title: title, properties: properties, rows: rows, defaultView: defaultView);
    await _save(updated);
  }

  Future<void> delete(String id) async {
    final f = File(p.join(vaultPath, '_M-NEXUS', _dbFolder, '$id.json'));
    if (await f.exists()) await f.delete();
  }

  /// Añade una row. Genera id único.
  Map<String, dynamic> addRow(DatabaseDoc doc, Map<String, dynamic> values) {
    final rowId = 'row-${DateTime.now().microsecondsSinceEpoch}';
    final row = {'id': rowId, ...values};
    doc.rows.add(row);
    return row;
  }

  void removeRow(DatabaseDoc doc, String rowId) {
    doc.rows.removeWhere((r) => r['id'] == rowId);
  }

  /// Agrupa rows por una property (para vista kanban).
  Map<String, List<Map<String, dynamic>>> groupBy(
    DatabaseDoc doc,
    String propName,
  ) {
    final result = <String, List<Map<String, dynamic>>>{};
    for (final row in doc.rows) {
      final key = row[propName]?.toString() ?? 'Sin valor';
      result.putIfAbsent(key, () => []).add(row);
    }
    return result;
  }

  /// Agrupa rows por mes/año de una property date (para vista calendar).
  Map<String, List<Map<String, dynamic>>> groupByMonth(
    DatabaseDoc doc,
    String propName,
  ) {
    final result = <String, List<Map<String, dynamic>>>{};
    for (final row in doc.rows) {
      final raw = row[propName]?.toString();
      DateTime? d;
      if (raw != null && raw.isNotEmpty) {
        try { d = DateTime.parse(raw); } catch (_) {}
      }
      final key = d == null
          ? 'Sin fecha'
          : '${d.year}-${d.month.toString().padLeft(2, '0')}';
      result.putIfAbsent(key, () => []).add(row);
    }
    return result;
  }
}

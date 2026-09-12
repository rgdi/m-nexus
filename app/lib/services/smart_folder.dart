// smart_folder.dart — Saved queries estilo AFFiNE Smart Folders.
// v0.62.14: filtra notas del vault según reglas guardadas por el usuario.

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';

enum SmartFilterOp { contains, equals, startsWith, regex }

class SmartFilter {
  final String field; // 'name' | 'content' | 'path' | 'tag'
  final SmartFilterOp op;
  final String value;
  const SmartFilter({required this.field, required this.op, required this.value});
  Map<String, dynamic> toJson() => {
    'field': field, 'op': op.name, 'value': value,
  };
  factory SmartFilter.fromJson(Map<String, dynamic> j) => SmartFilter(
    field: j['field'] as String,
    op: SmartFilterOp.values.firstWhere(
      (o) => o.name == j['op'],
      orElse: () => SmartFilterOp.contains,
    ),
    value: j['value'] as String,
  );

  bool matches({
    required String name,
    required String content,
    required String path,
    required List<String> tags,
  }) {
    String target;
    switch (field) {
      case 'name': target = name; break;
      case 'content': target = content; break;
      case 'path': target = path; break;
      case 'tag': target = tags.join(' '); break;
      default: target = name;
    }
    switch (op) {
      case SmartFilterOp.contains: return target.toLowerCase().contains(value.toLowerCase());
      case SmartFilterOp.equals: return target == value;
      case SmartFilterOp.startsWith: return target.toLowerCase().startsWith(value.toLowerCase());
      case SmartFilterOp.regex:
        try { return RegExp(value).hasMatch(target); }
        catch (_) { return false; }
    }
  }
}

class SmartFolder {
  final String id;
  final String name;
  final String? icon;
  final List<SmartFilter> filters;
  final DateTime? createdAt;
  const SmartFolder({
    required this.id,
    required this.name,
    this.icon,
    this.filters = const [],
    this.createdAt,
  });

  Map<String, dynamic> toJson() => {
    'id': id, 'name': name, 'icon': icon ?? '',
    'filters': filters.map((f) => f.toJson()).toList(),
    'createdAt': createdAt?.toIso8601String(),
  };

  factory SmartFolder.fromJson(Map<String, dynamic> j) {
    DateTime? c;
    try {
      final s = j['createdAt'] as String?;
      if (s != null) c = DateTime.parse(s);
    } catch (_) {}
    return SmartFolder(
      id: j['id'] as String,
      name: j['name'] as String,
      icon: (j['icon'] as String?)?.isEmpty ?? true ? null : j['icon'] as String,
      filters: ((j['filters'] as List?) ?? [])
        .map((e) => SmartFilter.fromJson(e as Map<String, dynamic>))
        .toList(),
      createdAt: c,
    );
  }
}

class SmartFolderService {
  final String vaultPath;
  static const _file = 'smart_folders.json';

  SmartFolderService(this.vaultPath);

  File _fileHandle() => File(p.join(vaultPath, '_M-NEXUS', _file));

  Future<List<SmartFolder>> listAll() async {
    try {
      final f = _fileHandle();
      if (!await f.exists()) return [];
      final raw = await f.readAsString();
      final list = jsonDecode(raw) as List;
      return list.map((e) => SmartFolder.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) { return []; }
  }

  Future<void> save(List<SmartFolder> folders) async {
    final f = _fileHandle();
    await f.parent.create(recursive: true);
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode(folders.map((e) => e.toJson()).toList()), flush: true);
    });
  }

  Future<SmartFolder> create({required String name, String? icon,
      List<SmartFilter> filters = const []}) async {
    final id = 'sf-${DateTime.now().millisecondsSinceEpoch}';
    final folder = SmartFolder(id: id, name: name, icon: icon, filters: filters);
    final all = await listAll();
    all.add(folder);
    await save(all);
    return folder;
  }

  Future<void> delete(String id) async {
    final all = await listAll();
    all.removeWhere((f) => f.id == id);
    await save(all);
  }
}

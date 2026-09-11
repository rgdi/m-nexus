// subjects_service.dart: gestión de asignaturas del usuario.
//
// v0.47.36: el vault se organiza por asignaturas. El usuario
// configura sus asignaturas (e.g., 'Anatomía', 'Fisiología') y cada
// asignatura tiene su subcarpeta con notas + flashcards.
//
// Las asignaturas se persisten en _M-NEXUS/subjects.json. Cada
// asignatura tiene:
//   - id (slug)
//   - name (display name, e.g., 'Anatomía cardiovascular')
//   - color (para badge visual)
//   - createdAt (timestamp)
//
// Las asignaturas pueden activarse/desactivarse sin borrarse.
// Las inactivas siguen contando pero no aparecen en el dashboard.

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'logger.dart';

class Subject {
  final String id; // slug, e.g., 'anatomia'
  final String name; // display name, e.g., 'Anatomía'
  final int color; // 0xFFRRGGBB
  final DateTime createdAt;
  final bool active;

  const Subject({
    required this.id,
    required this.name,
    required this.color,
    required this.createdAt,
    this.active = true,
  });

  Subject copyWith({String? name, int? color, bool? active}) => Subject(
        id: id,
        name: name ?? this.name,
        color: color ?? this.color,
        createdAt: createdAt,
        active: active ?? this.active,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'color': color,
        'createdAt': createdAt.toIso8601String(),
        'active': active,
      };

  factory Subject.fromJson(Map<String, dynamic> json) => Subject(
        id: json['id'] as String,
        name: json['name'] as String,
        color: (json['color'] as num).toInt(),
        createdAt: DateTime.parse(json['createdAt'] as String),
        active: json['active'] as bool? ?? true,
      );
}

class SubjectsService {
  // v0.62.7: convenience wrappers que toman vaultPath implícito (patrón legacy).
  Future<List<Subject>> load([String? vaultPath]) async {
    final vp = vaultPath ?? _currentVaultPath;
    if (vp == null) return loadAll('');
    return loadAll(vp);
  }
  String? _currentVaultPath;

  /// Crea una asignatura nueva y la persiste.
  Future<Subject> create({
    required String vaultPath,
    required String name,
    int? color,
  }) async {
    final id = _slugify(name);
    final subject = Subject(
      id: id,
      name: name,
      color: color ?? _colorForId(id),
      createdAt: DateTime.now(),
    );
    await _save(vaultPath, [...await loadAll(vaultPath), subject]);
    // Crear carpeta física
    final dir = Directory(p.join(vaultPath, name));
    if (!await dir.exists()) await dir.create();
    return subject;
  }

  Future<List<Subject>> loadAll(String vaultPath) async {
    final f = File(p.join(vaultPath, '_M-NEXUS', 'subjects.json'));
    if (!await f.exists()) return [];
    try {
      final raw = await f.readAsString();
      final decoded = jsonDecode(raw);
      // Aceptar tanto Array como {subjects: [...]} para flexibilidad.
      final list = decoded is List ? decoded : (decoded as Map<String, dynamic>)['subjects'] as List;
      return list.map((j) => Subject.fromJson(j as Map<String, dynamic>)).toList();
    } catch (e) {
      // v0.60 (P0.6): use logger instead of print
      AdvancedLogger.instance.warn('subjects', 'loadAll parse error', error: e.toString());
      return [];
    }
  }

  Future<void> _save(String vaultPath, List<Subject> subjects) async {
    final mnexusDir = Directory(p.join(vaultPath, '_M-NEXUS'));
    if (!await mnexusDir.exists()) await mnexusDir.create();
    final f = File(p.join(mnexusDir.path, 'subjects.json'));
    await f.writeAsString(
      jsonEncode(subjects.map((s) => s.toJson()).toList()),
      flush: true,
    );
  }

  /// v0.47.36: _save público (alias). Se usa desde pantallas
  /// que necesitan actualizar un subject específico.
  Future<void> update(String vaultPath, Subject subject) async {
    final all = await loadAll(vaultPath);
    final idx = all.indexWhere((s) => s.id == subject.id);
    if (idx == -1) {
      all.add(subject);
    } else {
      all[idx] = subject;
    }
    await _save(vaultPath, all);
  }

  Future<void> delete(String vaultPath, String id) async {
    final all = await loadAll(vaultPath);
    await _save(vaultPath, all.where((s) => s.id != id).toList());
  }

  String _slugify(String s) {
    return s
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9áéíóúñü\s-]'), '')
        .replaceAll(RegExp(r'\s+'), '-')
        .replaceAll(RegExp(r'-+'), '-');
  }

  /// Colores predeterminados para asignaturas (paleta Material).
  int _colorForId(String id) {
    final palette = [
      0xFFE57373, // rojo
      0xFF64B5F6, // azul
      0xFF81C784, // verde
      0xFFFFB74D, // naranja
      0xFFBA68C8, // púrpura
      0xFF4DB6AC, // teal
      0xFFFFD54F, // amarillo
      0xFFA1887F, // marrón
    ];
    return palette[id.hashCode.abs() % palette.length];
  }
}

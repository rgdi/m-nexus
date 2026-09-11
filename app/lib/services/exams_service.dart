// exams_service.dart: gestión de exámenes programados.
//
// v0.47.38: el usuario programa exámenes con fecha + temario oficial
// (lista de temas). Esto se usa para:
//   1. Priorizar tarjetas en el repaso (FSRS boost)
//   2. Mostrar "examen en X días" en el dashboard
//   3. Generar flashcards automáticamente desde las notas que
//      coincidan con temas del examen
//
// Los exámenes se persisten en _M-NEXUS/exams.json.

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';
import 'logger.dart';

class Exam {
  final String id;
  final String subjectId; // ref a Subject.id
  final String title; // 'Parcial 1 Anatomía'
  final DateTime date;
  final List<String> topics; // lista oficial de temas
  final DateTime createdAt;

  const Exam({
    required this.id,
    required this.subjectId,
    required this.title,
    required this.date,
    required this.topics,
    required this.createdAt,
  });

  /// Días hasta el examen (negativo si ya pasó).
  int daysUntil(DateTime now) {
    final today = DateTime(now.year, now.month, now.day);
    final examDay = DateTime(date.year, date.month, date.day);
    return examDay.difference(today).inDays;
  }

  bool isPast(DateTime now) => daysUntil(now) < 0;
  bool isToday(DateTime now) => daysUntil(now) == 0;

  /// Score de cobertura: % de topics que tienen al menos una nota.
  double coverageScore(Map<String, int> topicToNoteCount) {
    if (topics.isEmpty) return 0.0;
    final covered = topics.where((t) => (topicToNoteCount[t] ?? 0) > 0).length;
    return covered / topics.length;
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'subjectId': subjectId,
        'title': title,
        'date': date.toIso8601String(),
        'topics': topics,
        'createdAt': createdAt.toIso8601String(),
      };

  factory Exam.fromJson(Map<String, dynamic> json) => Exam(
        id: json['id'] as String,
        subjectId: json['subjectId'] as String,
        title: json['title'] as String,
        date: DateTime.parse(json['date'] as String),
        topics: ((json['topics'] as List?) ?? []).map((e) => e.toString()).toList(),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class ExamsService {
  // v0.62.7: alias de loadAll que acepta optional vaultPath
  Future<List<Exam>> all([String? vaultPath]) async {
    if (vaultPath == null) return loadAll(_currentVaultPath ?? '');
    return loadAll(vaultPath);
  }
  String? _currentVaultPath;

  // v0.62.7: load() alias
  Future<List<Exam>> load([String? vaultPath]) async => all(vaultPath);

  Future<List<Exam>> loadAll(String vaultPath) async {
    final f = File(p.join(vaultPath, '_M-NEXUS', 'exams.json'));
    if (!await f.exists()) return [];
    try {
      final raw = await f.readAsString();
      final decoded = jsonDecode(raw);
      // Aceptar tanto Array como {exams: [...]} para flexibilidad.
      final list = decoded is List ? decoded : (decoded as Map<String, dynamic>)['exams'] as List;
      return list.map((j) => Exam.fromJson(j as Map<String, dynamic>)).toList();
    } catch (e) {
      // v0.60 (P0.6): use logger instead of print
      AdvancedLogger.instance.warn('exams', 'loadAll parse error', error: e.toString());
      return [];
    }
  }

  Future<void> save(String vaultPath, List<Exam> exams) async {
    final mnexusDir = Directory(p.join(vaultPath, '_M-NEXUS'));
    if (!await mnexusDir.exists()) await mnexusDir.create();
    final f = File(p.join(mnexusDir.path, 'exams.json'));
    // v0.60 (P0.2): file lock para evitar race con create/update/delete paralelos
    await FileLock.run(f.path, () async {
      await f.writeAsString(
        jsonEncode(exams.map((e) => e.toJson()).toList()),
        flush: true,
      );
    });
  }

  Future<Exam> create({
    required String vaultPath,
    required String subjectId,
    required String title,
    required DateTime date,
    required List<String> topics,
  }) async {
    final exam = Exam(
      id: 'exam-${DateTime.now().millisecondsSinceEpoch}',
      subjectId: subjectId,
      title: title,
      date: date,
      topics: topics,
      createdAt: DateTime.now(),
    );
    await save(vaultPath, [...await loadAll(vaultPath), exam]);
    return exam;
  }

  Future<void> delete(String vaultPath, String id) async {
    final all = await loadAll(vaultPath);
    await save(vaultPath, all.where((e) => e.id != id).toList());
  }

  /// Devuelve los exámenes ordenados por proximidad (más cercano primero).
  Future<List<Exam>> upcoming(String vaultPath, {DateTime? now}) async {
    final n = now ?? DateTime.now();
    final all = await loadAll(vaultPath);
    final upcoming = all.where((e) => !e.isPast(n)).toList();
    upcoming.sort((a, b) => a.date.compareTo(b.date));
    return upcoming;
  }

  /// Para cada topic de cada examen, cuenta cuántas notas contienen
  /// ese topic (case-insensitive substring match en el título o body).
  Future<Map<String, int>> topicCoverage(
    String vaultPath, {
    required Map<String, String> notePathToContent,
  }) async {
    final exams = await loadAll(vaultPath);
    final coverage = <String, int>{};
    for (final exam in exams) {
      for (final topic in exam.topics) {
        final key = '${exam.id}:$topic';
        final lower = topic.toLowerCase();
        final count = notePathToContent.values
            .where((content) => content.toLowerCase().contains(lower))
            .length;
        coverage[key] = count;
      }
    }
    return coverage;
  }
}

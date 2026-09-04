// SyncQueue: cola de sincronización offline-first (v0.34).
//
// Cada grabación tiene un SyncEntry con estado: pending/uploading/synced/failed/manual.
// Se persiste en SharedPreferences como JSON. Al detectar conexión, intentamos subir.
//
// Si el backend no responde o no hay red, los entries quedan en pending
// y se reintentan en el siguiente _syncAll().

import 'dart:async';
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

enum SyncStatus { pending, uploading, synced, failed, manual }

class SyncEntry {
  final String localPath;
  final String deviceId;
  final DateTime createdAt;
  final SyncStatus status;
  final int attempts;
  final String? lastError;
  final DateTime? lastAttempt;

  SyncEntry({
    required this.localPath,
    required this.deviceId,
    required this.createdAt,
    this.status = SyncStatus.pending,
    this.attempts = 0,
    this.lastError,
    this.lastAttempt,
  });

  SyncEntry copyWith({
    SyncStatus? status,
    int? attempts,
    String? lastError,
    DateTime? lastAttempt,
  }) {
    return SyncEntry(
      localPath: localPath,
      deviceId: deviceId,
      createdAt: createdAt,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      lastError: lastError ?? this.lastError,
      lastAttempt: lastAttempt ?? this.lastAttempt,
    );
  }

  Map<String, dynamic> toJson() => {
        'localPath': localPath,
        'deviceId': deviceId,
        'createdAt': createdAt.toIso8601String(),
        'status': status.name,
        'attempts': attempts,
        'lastError': lastError,
        'lastAttempt': lastAttempt?.toIso8601String(),
      };

  factory SyncEntry.fromJson(Map<String, dynamic> j) => SyncEntry(
        localPath: j['localPath'] as String,
        deviceId: j['deviceId'] as String? ?? 'unknown',
        createdAt: DateTime.tryParse(j['createdAt'] as String? ?? '') ?? DateTime.now(),
        status: SyncStatus.values.firstWhere(
          (s) => s.name == j['status'],
          orElse: () => SyncStatus.pending,
        ),
        attempts: (j['attempts'] as num?)?.toInt() ?? 0,
        lastError: j['lastError'] as String?,
        lastAttempt: j['lastAttempt'] != null
            ? DateTime.tryParse(j['lastAttempt'] as String)
            : null,
      );
}

class SyncQueue {
  static const _prefsKey = 'mnexus.sync_queue';
  final _controller = StreamController<void>.broadcast();
  final _httpClient = () {}; // marcador, no se usa

  /// Stream de cambios (notifica cuando algo cambia).
  Stream<void> get stream => _controller.stream;

  /// Devuelve todos los entries.
  Future<List<SyncEntry>> getAll() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_prefsKey);
    if (raw == null || raw.isEmpty) return [];
    try {
      final list = (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
      return list.map(SyncEntry.fromJson).toList();
    } catch (_) {
      return [];
    }
  }

  /// Devuelve solo los pending y failed (los que hay que reintentar).
  Future<List<SyncEntry>> getPending() async {
    final all = await getAll();
    return all
        .where((e) =>
            e.status == SyncStatus.pending || e.status == SyncStatus.failed)
        .toList();
  }

  /// Encola un nuevo entry (o actualiza si ya existía).
  Future<void> enqueue(SyncEntry entry) async {
    final all = await getAll();
    // Si ya existe, no duplicar
    final existing = all.indexWhere((e) => e.localPath == entry.localPath);
    if (existing >= 0) {
      all[existing] = entry;
    } else {
      all.add(entry);
    }
    await _save(all);
    _controller.add(null);
  }

  /// Marca un entry como sincronizado.
  Future<void> markSynced(String localPath) async {
    final all = await getAll();
    final idx = all.indexWhere((e) => e.localPath == localPath);
    if (idx < 0) return;
    all[idx] = all[idx].copyWith(
      status: SyncStatus.synced,
      lastError: null,
      lastAttempt: DateTime.now(),
    );
    await _save(all);
    _controller.add(null);
  }

  /// Marca un entry como fallido.
  Future<void> markFailed(String localPath, String error) async {
    final all = await getAll();
    final idx = all.indexWhere((e) => e.localPath == localPath);
    if (idx < 0) return;
    all[idx] = all[idx].copyWith(
      status: SyncStatus.failed,
      lastError: error,
      attempts: all[idx].attempts + 1,
      lastAttempt: DateTime.now(),
    );
    await _save(all);
    _controller.add(null);
  }

  /// Marca un entry como "uploading" (estado intermedio).
  Future<void> markUploading(String localPath) async {
    final all = await getAll();
    final idx = all.indexWhere((e) => e.localPath == localPath);
    if (idx < 0) return;
    all[idx] = all[idx].copyWith(
      status: SyncStatus.uploading,
      lastAttempt: DateTime.now(),
    );
    await _save(all);
    _controller.add(null);
  }

  /// Actualiza la ruta de un entry (cuando se renombra).
  Future<void> updatePath(String oldPath, String newPath) async {
    final all = await getAll();
    final idx = all.indexWhere((e) => e.localPath == oldPath);
    if (idx < 0) return;
    all[idx] = SyncEntry(
      localPath: newPath,
      deviceId: all[idx].deviceId,
      createdAt: all[idx].createdAt,
      status: all[idx].status,
      attempts: all[idx].attempts,
      lastError: all[idx].lastError,
      lastAttempt: all[idx].lastAttempt,
    );
    await _save(all);
    _controller.add(null);
  }

  /// Borra un entry.
  Future<void> remove(String localPath) async {
    final all = await getAll();
    all.removeWhere((e) => e.localPath == localPath);
    await _save(all);
    _controller.add(null);
  }

  /// Stats: cuántos hay en cada estado.
  Future<Map<SyncStatus, int>> stats() async {
    final all = await getAll();
    final out = <SyncStatus, int>{};
    for (final s in SyncStatus.values) {
      out[s] = 0;
    }
    for (final e in all) {
      out[e.status] = (out[e.status] ?? 0) + 1;
    }
    return out;
  }

  /// Limpia entries synced con más de N días de antigüedad.
  Future<int> pruneSynced({int olderThanDays = 7}) async {
    final all = await getAll();
    final cutoff = DateTime.now().subtract(Duration(days: olderThanDays));
    final before = all.length;
    all.removeWhere((e) =>
        e.status == SyncStatus.synced && e.lastAttempt != null &&
        e.lastAttempt!.isBefore(cutoff));
    await _save(all);
    return before - all.length;
  }

  Future<void> _save(List<SyncEntry> entries) async {
    final prefs = await SharedPreferences.getInstance();
    final json = jsonEncode(entries.map((e) => e.toJson()).toList());
    await prefs.setString(_prefsKey, json);
  }
}

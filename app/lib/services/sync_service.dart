// sync_service.dart — Sync simple entre devices (last-write-wins).
// v0.62.17: implementa push/pull de notas via backend. No es CRDT (eso
// sería más complejo) pero sí garantiza que cambios hechos en device A
// aparezcan en device B en cuanto el user abre la app o pull-to-refresh.
//
// Endpoints backend:
//   POST /api/v1/notes/sync/pull  {since: ISO8601} → {notes: [...], serverTime: ...}
//   POST /api/v1/notes/sync/push  {notes: [{path, content, lastModified}]}
//                                       → {accepted: [...], conflicts: [...]}
//
// Estrategia: cada nota tiene frontmatter.lastModified. Si el servidor
// tiene una versión más reciente que el cliente, la del servidor gana
// (last-write-wins). El cliente siempre puede forzar push con
// `force=true` en el body.

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import '../services/logger.dart';
import '../services/settings_service.dart';

class SyncDelta {
  final String path;
  final String content;
  final DateTime lastModified;
  final int frontmatterVersion;

  SyncDelta({
    required this.path,
    required this.content,
    required this.lastModified,
    this.frontmatterVersion = 1,
  });

  Map<String, dynamic> toJson() => {
    'path': path,
    'content': content,
    'lastModified': lastModified.toIso8601String(),
    'fmVersion': frontmatterVersion,
  };

  factory SyncDelta.fromJson(Map<String, dynamic> j) => SyncDelta(
    path: j['path'] as String,
    content: (j['content'] as String?) ?? '',
    lastModified: DateTime.parse(j['lastModified'] as String),
    frontmatterVersion: (j['fmVersion'] as int?) ?? 1,
  );
}

class SyncResult {
  final List<SyncDelta> accepted;
  final List<SyncDelta> conflicts; // server-side has newer
  final DateTime serverTime;
  SyncResult({required this.accepted, required this.conflicts, required this.serverTime});

  factory SyncResult.fromJson(Map<String, dynamic> j) => SyncResult(
    accepted: ((j['accepted'] as List?) ?? [])
      .map((e) => SyncDelta.fromJson(e as Map<String, dynamic>))
      .toList(),
    conflicts: ((j['conflicts'] as List?) ?? [])
      .map((e) => SyncDelta.fromJson(e as Map<String, dynamic>))
      .toList(),
    serverTime: DateTime.parse(j['serverTime'] as String),
  );
}

class PullResult {
  final List<SyncDelta> notes;
  final DateTime serverTime;
  PullResult({required this.notes, required this.serverTime});
  factory PullResult.fromJson(Map<String, dynamic> j) => PullResult(
    notes: ((j['notes'] as List?) ?? [])
      .map((e) => SyncDelta.fromJson(e as Map<String, dynamic>))
      .toList(),
    serverTime: DateTime.parse(j['serverTime'] as String),
  );
}

enum SyncStatus { idle, syncing, success, offline, error }

class SyncService {
  final String vaultPath;
  http.Client? _http;

  SyncService(this.vaultPath) {
    _http = http.Client();
  }

  String? get _baseUrl {
    final url = SettingsService.instance.current.backendUrl;
    if (url == null || url.isEmpty) return null;
    return url;
  }

  bool get isAvailable => _baseUrl != null;

  /// Extrae lastModified del frontmatter de una nota .md.
  /// Formato: "---\nlastModified: 2025-09-13T...\n---\n..."
  static DateTime? parseLastModified(String content) {
    if (!content.startsWith('---')) return null;
    final end = content.indexOf('---', 3);
    if (end <= 0) return null;
    final fm = content.substring(3, end);
    final match = RegExp(r'^lastModified:\s*(\S+)', multiLine: true).firstMatch(fm);
    if (match == null) return null;
    try {
      return DateTime.parse(match.group(1)!);
    } catch (_) {
      return null;
    }
  }

  /// Push: envía notas locales al servidor. Devuelve las que el server aceptó
  /// y las que tenían conflicto (server tenía versión más reciente).
  Future<SyncResult> push(List<SyncDelta> deltas) async {
    if (_baseUrl == null) {
      throw Exception('No backend URL configurado en Ajustes');
    }
    final uri = Uri.parse('$_baseUrl/api/v1/notes/sync/push');
    final body = jsonEncode({
      'notes': deltas.map((d) => d.toJson()).toList(),
    });
    log.debug('sync', 'push', context: {'count': deltas.length});
    final resp = await _http!.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: body,
    ).timeout(const Duration(seconds: 10));
    if (resp.statusCode == 200) {
      return SyncResult.fromJson(jsonDecode(resp.body));
    } else {
      throw Exception('Push failed: HTTP ${resp.statusCode}: ${resp.body}');
    }
  }

  /// Pull: pide al servidor las notas modificadas desde `since`.
  Future<PullResult> pull(DateTime since) async {
    if (_baseUrl == null) {
      throw Exception('No backend URL configurado en Ajustes');
    }
    final uri = Uri.parse('$_baseUrl/api/v1/notes/sync/pull');
    final body = jsonEncode({'since': since.toIso8601String()});
    log.debug('sync', 'pull', context: {'since': since.toIso8601String()});
    final resp = await _http!.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: body,
    ).timeout(const Duration(seconds: 10));
    if (resp.statusCode == 200) {
      return PullResult.fromJson(jsonDecode(resp.body));
    } else {
      throw Exception('Pull failed: HTTP ${resp.statusCode}: ${resp.body}');
    }
  }
}

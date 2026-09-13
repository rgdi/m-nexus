// web_vault_service.dart — vault service para web usando SharedPreferences.
// v0.62.18: usa shared_preferences (ya en pubspec) para persistir notas
// en localStorage del browser. Apto para vault personal pequeño.
//
// Limitación: localStorage ~5MB. Para vault grande (>1000 notas)
// habría que migrar a IndexedDB real.

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'logger.dart';

class WebNote {
  final String path;
  final String name;
  final String title;
  final String content;
  final DateTime modified;
  WebNote({
    required this.path,
    required this.name,
    required this.title,
    required this.content,
    required this.modified,
  });
  Map<String, dynamic> toMap() => {
    'path': path,
    'name': name,
    'title': title,
    'content': content,
    'modified': modified.toIso8601String(),
  };
  factory WebNote.fromMap(Map<String, dynamic> m) => WebNote(
    path: m['path'] as String,
    name: m['name'] as String,
    title: (m['title'] as String?) ?? '',
    content: m['content'] as String,
    modified: DateTime.parse(m['modified'] as String),
  );
}

class WebVaultService {
  static const _key = 'mnexus_web_vault_v1';

  Future<Map<String, WebNote>> _readAll() async {
    if (!kIsWeb) return {};
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_key);
      if (raw == null || raw.isEmpty) return {};
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return m.map((k, v) => MapEntry(
        k, WebNote.fromMap(Map<String, dynamic>.from(v as Map)),
      ));
    } catch (e) {
      log.warn('web_vault', 'readAll failed', context: {'err': '$e'});
      return {};
    }
  }

  Future<void> _writeAll(Map<String, WebNote> notes) async {
    if (!kIsWeb) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final m = notes.map((k, v) => MapEntry(k, v.toMap()));
      await prefs.setString(_key, jsonEncode(m));
    } catch (e) {
      log.warn('web_vault', 'writeAll failed', context: {'err': '$e'});
    }
  }

  Future<List<WebNote>> listAll() async {
    final m = await _readAll();
    return m.values.toList();
  }

  Future<List<WebNote>> listRecentNotes(int limit) async {
    final all = (await _readAll()).values.toList()
      ..sort((a, b) => b.modified.compareTo(a.modified));
    return all.take(limit).toList();
  }

  Future<WebNote?> readNote(String absPath) async {
    final m = await _readAll();
    return m[absPath];
  }

  Future<WebNote> writeNote(String absPath, String content) async {
    final m = await _readAll();
    final title = _extractTitle(content);
    final name = absPath.split('/').last;
    final note = WebNote(
      path: absPath,
      name: name,
      title: title,
      content: content,
      modified: DateTime.now(),
    );
    m[absPath] = note;
    await _writeAll(m);
    return note;
  }

  Future<void> deleteNote(String absPath) async {
    final m = await _readAll();
    m.remove(absPath);
    await _writeAll(m);
  }

  String _extractTitle(String content) {
    if (content.startsWith('---')) {
      final end = content.indexOf('---', 3);
      if (end > 0) {
        final fm = content.substring(3, end);
        final m = RegExp(r'^title:\s*(.+)$', multiLine: true).firstMatch(fm);
        if (m != null) return m.group(1)!.trim();
      }
    }
    final h1 = RegExp(r'^#\s+(.+)$', multiLine: true).firstMatch(content);
    if (h1 != null) return h1.group(1)!.trim();
    return '';
  }
}

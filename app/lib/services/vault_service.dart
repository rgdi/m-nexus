// VaultService: API limpia para el vault.
// Lee/escribe archivos, parsea markdown, extrae metadata.
// Es la pieza central que todas las screens usan.

import 'dart:io';
import 'package:path/path.dart' as p;
import '../core/constants.dart';
import 'logger.dart';

class Note {
  final String path; // ruta absoluta
  final String relPath; // ruta relativa al vault
  final String name;
  final String content;
  final Map<String, String> frontmatter;
  final DateTime modified;
  final int sizeBytes;
  final List<String> tags;
  final List<String> links; // [[wikilinks]]
  final String? title;

  const Note({
    required this.path,
    required this.relPath,
    required this.name,
    required this.content,
    required this.frontmatter,
    required this.modified,
    required this.sizeBytes,
    required this.tags,
    required this.links,
    this.title,
  });

  /// Primeras 200 chars del contenido sin markdown.
  String get preview {
    final clean = content
        .replaceAll(RegExp(r'#+\s'), '')
        .replaceAll(RegExp(r'\*+'), '')
        .replaceAll(RegExp(r'`'), '')
        .replaceAll(RegExp(r'\n+'), ' ')
        .trim();
    return clean.length > 200 ? '${clean.substring(0, 200)}…' : clean;
  }

  /// Cuenta palabras.
  int get wordCount => content.split(RegExp(r'\s+')).where((w) => w.isNotEmpty).length;
}

class VaultNode {
  final String name;
  final String relPath;
  final bool isDir;
  final List<VaultNode> children;
  final Note? note;

  const VaultNode({
    required this.name,
    required this.relPath,
    required this.isDir,
    this.children = const [],
    this.note,
  });
}

class VaultService {
  final String vaultPath;
  final log = AdvancedLogger.instance;

  VaultService(this.vaultPath);

  // ── Tree ────────────────────────────────────────────

  /// Carga el árbol completo (excluye _M-NEXUS y archivos ocultos).
  Future<VaultNode> loadTree() async {
    log.timeStart('vault', 'loadTree');
    final root = Directory(vaultPath);
    final node = await _buildNode(root, '');
    log.timeEnd('vault', 'loadTree');
    return node;
  }

  Future<VaultNode> _buildNode(Directory dir, String relPath) async {
    final entries = await dir.list().toList();
    final children = <VaultNode>[];
    for (final e in entries) {
      final name = p.basename(e.path);
      if (name.startsWith('.')) continue; // archivos ocultos
      if (relPath.isEmpty && name == AppConstants.internalFolder) continue; // _M-NEXUS root
      final childRel = relPath.isEmpty ? name : p.join(relPath, name);
      if (e is Directory) {
        children.add(await _buildNode(e, childRel));
      } else if (e is File) {
        if (!AppConstants.mdExtensions.contains(p.extension(name))) continue;
        children.add(VaultNode(
          name: name,
          relPath: childRel,
          isDir: false,
        ));
      }
    }
    children.sort((a, b) {
      if (a.isDir != b.isDir) return a.isDir ? -1 : 1;
      return a.name.toLowerCase().compareTo(b.name.toLowerCase());
    });
    return VaultNode(
      name: p.basename(dir.path),
      relPath: relPath,
      isDir: true,
      children: children,
    );
  }

  // ── Read / Write ────────────────────────────────────

  /// Lee una nota por path absoluto.
  Future<Note?> readNote(String absPath) async {
    log.timeStart('vault', 'readNote');
    final file = File(absPath);
    if (!await file.exists()) {
      log.warn('vault', 'Note not found', context: {'path': absPath});
      return null;
    }
    final stat = await file.stat();
    final raw = await file.readAsString();
    final parsed = parseFrontmatter(raw);
    final note = Note(
      path: absPath,
      relPath: p.relative(absPath, from: vaultPath),
      name: p.basenameWithoutExtension(absPath),
      content: parsed.body,
      frontmatter: parsed.frontmatter,
      modified: stat.modified,
      sizeBytes: stat.size,
      tags: _extractTags(parsed.body, parsed.frontmatter),
      links: _extractLinks(parsed.body),
      title: parsed.frontmatter['title'] ?? p.basenameWithoutExtension(absPath),
    );
    log.timeEnd('vault', 'readNote',
        extra: {'path': absPath, 'words': note.wordCount});
    return note;
  }

  /// Escribe (sobrescribe) una nota.
  Future<void> writeNote(String absPath, String content) async {
    log.info('vault', 'Write note', context: {'path': absPath, 'size': content.length});
    await File(absPath).writeAsString(content);
  }

  /// Crea una nota nueva con frontmatter.
  Future<String> createNote({
    required String folder,
    required String title,
    required String content,
    Map<String, String>? frontmatter,
  }) async {
    final stamp = DateTime.now().toIso8601String().substring(0, 10);
    final slug = title
        .toLowerCase()
        .replaceAll(RegExp(r'[^a-z0-9\s-]'), '')
        .replaceAll(RegExp(r'\s+'), '-');
    final filename = '$stamp-$slug.md';
    final relPath = folder.isEmpty ? filename : p.join(folder, filename);
    final absPath = p.join(vaultPath, relPath);
    final fm = {
      'title': title,
      'date': stamp,
      'created': DateTime.now().toIso8601String(),
      ...?frontmatter,
    };
    final buffer = StringBuffer()
      ..writeln('---')
      ..writeln('title: ${fm['title']}')
      ..writeln('date: ${fm['date']}')
      ..writeln('created: ${fm['created']}');
    for (final e in fm.entries) {
      if (e.key == 'title' || e.key == 'date' || e.key == 'created') continue;
      buffer.writeln('${e.key}: ${e.value}');
    }
    buffer
      ..writeln('---')
      ..writeln('')
      ..writeln(content);
    await File(absPath).create(recursive: true);
    await File(absPath).writeAsString(buffer.toString());
    log.info('vault', 'Created note', context: {'path': absPath});
    return absPath;
  }

  // ── Search ──────────────────────────────────────────

  /// Búsqueda full-text en todas las notas del vault.
  Future<List<Note>> search(String query, {int limit = 50}) async {
    if (query.trim().isEmpty) return [];
    log.info('vault', 'Search', context: {'query': query});
    final results = <Note>[];
    final q = query.toLowerCase();
    await for (final f in Directory(vaultPath).list(recursive: true)) {
      if (f is! File) continue;
      if (!AppConstants.mdExtensions.contains(p.extension(f.path))) continue;
      try {
        final note = await readNote(f.path);
        if (note == null) continue;
        if (note.content.toLowerCase().contains(q) ||
            note.name.toLowerCase().contains(q) ||
            note.tags.any((t) => t.toLowerCase().contains(q))) {
          results.add(note);
          if (results.length >= limit) break;
        }
      } catch (_) {
        // skip
      }
    }
    log.info('vault', 'Search done', context: {'results': results.length});
    return results;
  }

  /// Devuelve las notas que enlazan a `targetRelPath` (backlinks).
  Future<List<Note>> backlinks(String targetRelPath) async {
    final target = p.basenameWithoutExtension(targetRelPath);
    final all = await search('[[$target]]');
    return all;
  }

  // ── Stats ───────────────────────────────────────────

  Future<int> countNotes() async {
    var count = 0;
    await for (final f in Directory(vaultPath).list(recursive: true)) {
      if (f is File && AppConstants.mdExtensions.contains(p.extension(f.path))) {
        count++;
      }
    }
    return count;
  }

  // ── Helpers ─────────────────────────────────────────

  /// Parsea YAML frontmatter simple.
  static ({String body, Map<String, String> frontmatter}) parseFrontmatter(String raw) {
    if (!raw.startsWith('---')) return (body: raw, frontmatter: const {});
    final lines = raw.split('\n');
    if (lines.length < 3 || lines[0].trim() != '---') {
      return (body: raw, frontmatter: const {});
    }
    final endIdx = lines.indexWhere((l) => l.trim() == '---', 1);
    if (endIdx == -1) return (body: raw, frontmatter: const {});

    final fm = <String, String>{};
    for (final line in lines.sublist(1, endIdx)) {
      final m = RegExp(r'^([\w-]+)\s*:\s*(.*)$').firstMatch(line.trim());
      if (m != null) {
        fm[m.group(1)!] = m.group(2)!.trim();
      }
    }
    return (body: lines.sublist(endIdx + 1).join('\n').trim(), frontmatter: fm);
  }

  List<String> _extractTags(String body, Map<String, String> fm) {
    final tags = <String>{};
    if (fm['tags'] != null) {
      fm['tags']!.split(RegExp(r'[\s,]+')).forEach((t) {
        if (t.isNotEmpty) tags.add(t.replaceAll('#', ''));
      });
    }
    // # inline tags
    final inlineRe = RegExp(r'#([a-zA-Z0-9_/-]+)');
    for (final m in inlineRe.allMatches(body)) {
      tags.add(m.group(1)!);
    }
    return tags.toList();
  }

  List<String> _extractLinks(String body) {
    final links = <String>[];
    // [[wikilinks]]
    for (final m in RegExp(r'\[\[([^\]]+)\]\]').allMatches(body)) {
      links.add(m.group(1)!.split('|').first.split('#').first);
    }
    // [text](path.md)
    for (final m in RegExp(r'\[([^\]]+)\]\(([^)]+\.md)\)').allMatches(body)) {
      links.add(m.group(2)!);
    }
    return links;
  }
}

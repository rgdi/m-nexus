// note_metadata.dart — metadata AFFiNE-style por nota.
// v0.62.14: cover (image path o color hex), favicon (emoji o 2-letter initials),
// journal entries (history of edits con timestamp + summary).
//
// Persistencia: archivo `_M-NEXUS/note_meta/<basename>.json` (no en el .md
// para no interferir con el editor). Si el archivo no existe, devuelve
// defaults (sin cover, favicon = null, journal vacío).

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';

class NoteMetadata {
  final String coverPath; // ruta absoluta de imagen o ''
  final String coverColorHex; // ej '#A78BFA' o ''
  final String favicon; // emoji o 2 chars
  final List<JournalEntry> journal;
  final DateTime? updatedAt;

  const NoteMetadata({
    this.coverPath = '',
    this.coverColorHex = '',
    this.favicon = '',
    this.journal = const [],
    this.updatedAt,
  });

  Map<String, dynamic> toJson() => {
    'coverPath': coverPath,
    'coverColorHex': coverColorHex,
    'favicon': favicon,
    'journal': journal.map((e) => e.toJson()).toList(),
    'updatedAt': updatedAt?.toIso8601String(),
  };

  factory NoteMetadata.fromJson(Map<String, dynamic> j) => NoteMetadata(
    coverPath: (j['coverPath'] as String?) ?? '',
    coverColorHex: (j['coverColorHex'] as String?) ?? '',
    favicon: (j['favicon'] as String?) ?? '',
    journal: ((j['journal'] as List?) ?? [])
      .map((e) => JournalEntry.fromJson(e as Map<String, dynamic>))
      .toList(),
    updatedAt: j['updatedAt'] != null
        ? DateTime.parse(j['updatedAt'] as String)
        : null,
  );
}

class JournalEntry {
  final DateTime at;
  final String summary; // ej 'Creada', 'Editada', 'Cubo movido', 'Flashcard añadida'
  final Map<String, dynamic> meta;
  const JournalEntry({required this.at, required this.summary, this.meta = const {}});
  Map<String, dynamic> toJson() => {
    'at': at.toIso8601String(),
    'summary': summary,
    'meta': meta,
  };
  factory JournalEntry.fromJson(Map<String, dynamic> j) => JournalEntry(
    at: DateTime.parse(j['at'] as String),
    summary: j['summary'] as String,
    meta: (j['meta'] as Map?)?.cast<String, dynamic>() ?? const {},
  );
}

class NoteMetadataService {
  final String vaultPath;
  static const _metaFolder = 'note_meta';

  NoteMetadataService(this.vaultPath);

  Directory _ensureFolder() {
    final dir = Directory(p.join(vaultPath, '_M-NEXUS', _metaFolder));
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return dir;
  }

  File _file(String notePath) {
    final base = p.basenameWithoutExtension(notePath);
    return File(p.join(_ensureFolder().path, '$base.json'));
  }

  Future<NoteMetadata> get(String notePath) async {
    try {
      final f = _file(notePath);
      if (!await f.exists()) return const NoteMetadata();
      final raw = await f.readAsString();
      return NoteMetadata.fromJson(jsonDecode(raw));
    } catch (_) {
      return const NoteMetadata();
    }
  }

  Future<void> save(String notePath, NoteMetadata meta) async {
    final f = _file(notePath);
    await FileLock.run(f.path, () async {
      await f.writeAsString(jsonEncode(meta.toJson()), flush: true);
    });
  }

  /// Añade entrada al journal.
  Future<NoteMetadata> log(String notePath, String summary,
      {Map<String, dynamic> meta = const {}}) async {
    final current = await get(notePath);
    final now = DateTime.now();
    final updated = NoteMetadata(
      coverPath: current.coverPath,
      coverColorHex: current.coverColorHex,
      favicon: current.favicon,
      journal: [
        ...current.journal,
        JournalEntry(at: now, summary: summary, meta: meta),
      ],
      updatedAt: now,
    );
    await save(notePath, updated);
    return updated;
  }
}

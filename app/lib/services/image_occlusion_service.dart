// image_occlusion_service.dart: genera N flashcards a partir de una imagen
// con rectangulos ocluidos (estilo Anki image occlusion).
//
// v0.60 (P1.1): el backend tiene POST /api/v1/flashcards/image-occlusion,
// pero la app nunca lo llamaba. Aqui implementamos el cliente.
//
// Formato en disco: una .md por cada oclusion en
// vault/Flashcards/Approved/io-<nota>-<idx>.md con frontmatter:
//
//   ---
//   id: io-...
//   type: image-occlusion
//   source_image: /path/to/image.png
//   occlusion: { x, y, w, h, label }
//   created: ...
//   ---
//   # Que estructura se senala en este rectangulo?
//   ![](/path/to/image.png)
//   {{reveal: 1=label}}
//
// Donde label se revela al hacer tap en review.

import 'dart:convert';
import 'dart:io';
import 'package:path/path.dart' as p;
import 'file_lock.dart';
import 'logger.dart';

class Occlusion {
  final double x; // 0..1 normalized
  final double y;
  final double w;
  final double h;
  final String label;
  const Occlusion({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    required this.label,
  });

  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'w': w, 'h': h, 'label': label};
  factory Occlusion.fromJson(Map j) => Occlusion(
    x: (j['x'] as num).toDouble(),
    y: (j['y'] as num).toDouble(),
    w: (j['w'] as num).toDouble(),
    h: (j['h'] as num).toDouble(),
    label: j['label'] as String? ?? '',
  );
}

class ImageOcclusionService {
  final String vaultPath;
  static const _approvedDir = 'Flashcards/Approved';
  static const _draftsDir = 'Flashcards/Drafts';

  ImageOcclusionService(this.vaultPath);

  /// v0.60 (P1.1): crea N flashcards (1 por oclusion) en Approved.
  /// Devuelve los paths de los .md creados.
  Future<List<String>> createOcclusionCards({
    required String sourceImage,
    required List<Occlusion> occlusions,
    String noteTitle = '',
    String? sourceNote,
  }) async {
    if (occlusions.isEmpty) return [];
    final dir = Directory(p.join(vaultPath, _approvedDir));
    if (!await dir.exists()) await dir.create(recursive: true);

    final created = <String>[];
    final stamp = DateTime.now().millisecondsSinceEpoch;
    for (var i = 0; i < occlusions.length; i++) {
      final occ = occlusions[i];
      final id = 'io-$stamp-$i';
      final cardPath = p.join(dir.path, '$id.md');
      final body = _serialize(id, sourceImage, occ, noteTitle, sourceNote);
      // v0.60 (P0.2): file lock
      await FileLock.run(cardPath, () async {
        await File(cardPath).writeAsString(body);
      });
      created.add(cardPath);
    }
    AdvancedLogger.instance.info('image-occlusion', 'created cards', context: {
      'count': created.length, 'image': sourceImage,
    });
    return created;
  }

  /// v0.60 (P1.1): serializa una flashcard image-occlusion a markdown.
  String _serialize(String id, String sourceImage, Occlusion occ, String noteTitle, String? sourceNote) {
    final buf = StringBuffer();
    buf.writeln('---');
    buf.writeln('id: $id');
    buf.writeln('type: image-occlusion');
    buf.writeln('source_image: $sourceImage');
    buf.writeln('occlusion: ${jsonEncode(occ.toJson())}');
    if (sourceNote != null) buf.writeln('source_note: $sourceNote');
    if (noteTitle.isNotEmpty) buf.writeln('note_title: $noteTitle');
    buf.writeln('created: ${DateTime.now().toIso8601String()}');
    buf.writeln('---');
    buf.writeln();
    buf.writeln('## ${occ.label}');
    buf.writeln();
    buf.writeln('Identifica la region marcada en la imagen:');
    buf.writeln();
    buf.writeln('![Imagen con region oculta]($sourceImage)');
    buf.writeln();
    buf.writeln('<!-- Reveal on tap: ${occ.label} -->');
    return buf.toString();
  }

  /// v0.60 (P1.1): parsea un .md de image-occlusion.
  static Map<String, dynamic>? parse(String content) {
    if (!content.startsWith('---')) return null;
    final end = content.indexOf('---', 3);
    if (end <= 0) return null;
    final fm = content.substring(3, end);
    if (!fm.contains('type: image-occlusion')) return null;
    final out = <String, dynamic>{};
    String? occJson;
    for (final line in fm.split('\n')) {
      final i = line.indexOf(':');
      if (i < 0) continue;
      final k = line.substring(0, i).trim();
      final v = line.substring(i + 1).trim();
      if (k == 'id') out['id'] = v;
      if (k == 'source_image') out['sourceImage'] = v;
      if (k == 'note_title') out['noteTitle'] = v;
      if (k == 'source_note') out['sourceNote'] = v;
      if (k == 'created') out['created'] = v;
      if (k == 'occlusion') occJson = v;
    }
    if (occJson != null) {
      try {
        out['occlusion'] = Occlusion.fromJson(jsonDecode(occJson) as Map);
      } catch (_) {}
    }
    return out;
  }
}

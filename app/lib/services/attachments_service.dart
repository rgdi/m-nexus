// attachments_service.dart: indexa PDFs/PPTs/images en el vault.
//
// v0.49.11: detecta archivos multimedia en el vault, extrae metadata,
// permite busqueda por nombre, y mantiene una lista de notas que
// referencian cada attachment (predecesor de backlinks para PDF/PPT).
//
// Estrategia:
//   1. Walk recursivo del vault, filtrar por extension
//   2. Para PDFs: usar el binario para extraer titulo del metadata (1ª pagina)
//   3. Para PPTs: parsear el zip (pptx es un zip) y leer docProps/core.xml
//   4. Indexar nombre, tamano, fecha mod, titulo, page count estimado
//
// Caching: el resultado se cachea por 5 min para no re-scannear.

import 'dart:io';
import 'dart:convert';
import 'package:path/path.dart' as p;
import 'logger.dart';

class Attachment {
  final String path; // abs path
  final String relPath; // path relativo al vault
  final String name;
  final String extension; // '.pdf' | '.pptx' | '.png' | '.jpg' | ...
  final int sizeBytes;
  final DateTime modified;
  final String? title; // metadata title (PDF/PPTX)
  final int? pageCount; // PDFs
  final int? slideCount; // PPTXs

  const Attachment({
    required this.path,
    required this.relPath,
    required this.name,
    required this.extension,
    required this.sizeBytes,
    required this.modified,
    this.title,
    this.pageCount,
    this.slideCount,
  });

  Map<String, dynamic> toJson() => {
    'path': path,
    'relPath': relPath,
    'name': name,
    'extension': extension,
    'sizeBytes': sizeBytes,
    'modified': modified.toIso8601String(),
    'title': title,
    'pageCount': pageCount,
    'slideCount': slideCount,
  };

  String get displayTitle => title ?? name;

  bool get isPdf => extension.toLowerCase() == '.pdf';
  bool get isPptx => extension.toLowerCase() == '.pptx';
  bool get isImage =>
      ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
          .contains(extension.toLowerCase());
}

class AttachmentsService {
  final String vaultPath;
  static const _supportedExts = {
    '.pdf', '.pptx', '.ppt', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.mp3', '.wav', '.m4a', '.mp4', '.mov'
  };
  static const _docExts = {'.pdf', '.pptx', '.ppt'};

  /// cache index por vault
  List<Attachment> _cache = [];
  DateTime? _cacheTime;
  static const _cacheTtl = Duration(minutes: 5);

  AttachmentsService(this.vaultPath);

  Future<List<Attachment>> listAll({bool forceRefresh = false}) async {
    if (!forceRefresh && _cache.isNotEmpty && _cacheTime != null) {
      if (DateTime.now().difference(_cacheTime!) < _cacheTtl) {
        return _cache;
      }
    }
    final out = <Attachment>[];
    final root = Directory(vaultPath);
    if (!await root.exists()) {
      return out;
    }
    try {
      await for (final entity in root.list(recursive: true, followLinks: false)) {
        if (entity is! File) continue;
        final ext = p.extension(entity.path).toLowerCase();
        if (!_supportedExts.contains(ext)) continue;
        // Ignorar dotfiles
        if (p.basename(entity.path).startsWith('.')) continue;
        try {
          final stat = await entity.stat();
          String? title;
          int? pageCount;
          int? slideCount;
          if (ext == '.pdf') {
            final meta = await _readPdfMetadata(entity.path);
            title = meta.title;
            pageCount = meta.pages;
          } else if (ext == '.pptx') {
            final meta = await _readPptxMetadata(entity.path);
            title = meta.title;
            slideCount = meta.slides;
          }
          final rel = p.relative(entity.path, from: vaultPath);
          out.add(Attachment(
            path: entity.path,
            relPath: rel,
            name: p.basename(entity.path),
            extension: ext,
            sizeBytes: stat.size,
            modified: stat.modified,
            title: title,
            pageCount: pageCount,
            slideCount: slideCount,
          ));
        } catch (e) {
          AdvancedLogger.instance.warn('attachments', 'failed to read attachment', context: {'path': entity.path, 'err': e.toString()});
        }
      }
    } catch (e) {
      AdvancedLogger.instance.warn('attachments', 'list failed', error: e.toString());
    }
    out.sort((a, b) => b.modified.compareTo(a.modified));
    _cache = out;
    _cacheTime = DateTime.now();
    return out;
  }

  /// Filtra por extension y/o query
  Future<List<Attachment>> filter({String? extension, String? query, int limit = 100}) async {
    final all = await listAll();
    Iterable<Attachment> result = all;
    if (extension != null && extension.isNotEmpty) {
      final e = extension.toLowerCase();
      result = result.where((a) => a.extension == e);
    }
    if (query != null && query.isNotEmpty) {
      final q = query.toLowerCase();
      result = result.where((a) =>
        a.name.toLowerCase().contains(q) ||
        (a.title?.toLowerCase().contains(q) ?? false));
    }
    return result.take(limit).toList();
  }

  /// Lista notas que referencian este attachment
  /// (busca '[[relPath]]' o 'name.pdf' en los .md)
  Future<List<String>> findReferencingNotes(Attachment att, {int maxNotes = 50}) async {
    final refs = <String>[];
    final root = Directory(vaultPath);
    if (!await root.exists()) return refs;
    final patterns = [
      att.relPath,
      att.name,
      p.basenameWithoutExtension(att.name),
    ];
    try {
      await for (final entity in root.list(recursive: true, followLinks: false)) {
        if (entity is! File || !entity.path.endsWith('.md')) continue;
        if (refs.length >= maxNotes) break;
        try {
          final content = await entity.readAsString();
          for (final p in patterns) {
            if (content.contains(p)) {
              refs.add(entity.path);
              break;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
    return refs;
  }

  /// Lee metadata basica de un PDF sin librerias externas.
  /// Encuentra 'Page count N' en el header o cuenta '/Type /Page '.
  Future<_PdfMeta> _readPdfMetadata(String path) async {
    try {
      final bytes = await File(path).readAsBytes();
      final str = String.fromCharCodes(bytes.take(8192));
      // /Title in metadata
      String? title;
      final titleMatch = RegExp(r'/Title\s*\(([^)]+)\)').firstMatch(str);
      if (titleMatch != null) {
        title = titleMatch.group(1);
      }
      // Conteo de paginas: /Count N
      int? pages;
      final countMatch = RegExp(r'/Count\s+(\d+)').firstMatch(str);
      if (countMatch != null) {
        pages = int.tryParse(countMatch.group(1)!);
      } else {
        // Fallback: contar /Type /Page (no /Pages)
        final matches = RegExp(r'/Type\s*/Page(?![sA-Za-z])').allMatches(str);
        pages = matches.length;
      }
      return _PdfMeta(title: title, pages: pages);
    } catch (_) {
      return _PdfMeta();
    }
  }

  /// Lee metadata de PPTX (es un zip con docProps/core.xml)
  /// Sin libreria zip externa, hacemos best-effort parseando bytes raw
  Future<_PptxMeta> _readPptxMetadata(String path) async {
    try {
      final bytes = await File(path).readAsBytes();
      // Buscar 'docProps/core.xml' en el zip (pptx es zip)
      // Local file header: 0x04034b50, luego filename, luego contenido
      int idx = 0;
      String? title;
      while (idx < bytes.length - 4) {
        // PK\x03\x04 = local file header
        if (bytes[idx] == 0x50 && bytes[idx + 1] == 0x4B && bytes[idx + 2] == 0x03 && bytes[idx + 3] == 0x04) {
          // name length en bytes 26-27
          final nameLen = bytes[idx + 26] | (bytes[idx + 27] << 8);
          final start = idx + 30;
          final name = String.fromCharCodes(bytes.sublist(start, start + nameLen));
          if (name == 'docProps/core.xml') {
            // Compressed data (deflate). Skip por simplicidad.
            // Buscar /Title en el resto del archivo
            final rest = String.fromCharCodes(bytes.sublist(start, start + 4096).where((b) => b < 128));
            final m = RegExp(r'<dc:title[^>]*>([^<]+)</dc:title>').firstMatch(rest);
            if (m != null) title = m.group(1);
            // slideCount por nombre de archivo: ppt/slides/slideN.xml
            break;
          }
          idx = start + nameLen;
        } else {
          idx++;
        }
      }
      // Contar slides
      int? slideCount;
      final allStr = String.fromCharCodes(bytes.where((b) => b < 128));
      final slideMatches = RegExp(r'ppt/slides/slide(\d+)\.xml').allMatches(allStr);
      if (slideMatches.isNotEmpty) {
        slideCount = slideMatches.length;
      }
      return _PptxMeta(title: title, slides: slideCount);
    } catch (_) {
      return _PptxMeta();
    }
  }

  void invalidate() {
    _cache = [];
    _cacheTime = null;
  }
}

class _PdfMeta {
  final String? title;
  final int? pages;
  _PdfMeta({this.title, this.pages});
}

class _PptxMeta {
  final String? title;
  final int? slides;
  _PptxMeta({this.title, this.slides});
}

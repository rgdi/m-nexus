// PluginInstaller: descarga el ZIP del plugin, lo extrae a
// {vault}/.obsidian/plugins/m-nexus/ y crea las carpetas internas
// necesarias para el funcionamiento (_M-NEXUS/...).
//
// v0.8: extrae los 3 archivos obligatorios (main.js, manifest.json, styles.css)
// y crea la estructura de carpetas para M-NEXUS v0.8.

import 'dart:io';
import 'dart:typed_data';
import 'package:archive/archive.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import '../models/plugin_release.dart';
import '../utils/hash.dart';

class PluginInstaller {
  static const pluginFolderName = 'm-nexus';
  static const requiredFolders = [
    '_M-NEXUS', // raíz interna del plugin
    '_M-NEXUS/Flashcards',
    '_M-NEXUS/Flashcards/Drafts',
    '_M-NEXUS/Flashcards/Approved',
    '_M-NEXUS/Inbox',
    '_M-NEXUS/Photos',
    '_M-NEXUS/Photos/occlusions',
    '_M-NEXUS/server',     // cola offline
    '_M-NEXUS/PDFs',       // versiones PDF
    '_M-NEXUS/backups',    // backups locales
  ];

  final http.Client _http;
  PluginInstaller({http.Client? client}) : _http = client ?? http.Client();

  /// Descarga el release, verifica checksum y devuelve los bytes del ZIP.
  Future<Uint8List> downloadRelease(PluginRelease release, {void Function(double)? onProgress}) async {
    if (release.downloadUrl.isEmpty) {
      throw Exception('URL de descarga vacía');
    }
    final request = http.Request('GET', Uri.parse(release.downloadUrl));
    final streamed = await _http.send(request);
    final total = streamed.contentLength ?? 0;
    final chunks = <int>[];
    int received = 0;
    await for (final chunk in streamed.stream) {
      chunks.addAll(chunk);
      received += chunk.length;
      if (total > 0) onProgress?.call(received / total);
    }
    final bytes = Uint8List.fromList(chunks);
    if (release.checksumSha256.isNotEmpty) {
      final actual = hashToHex(bytes);
      if (actual != release.checksumSha256) {
        throw Exception('Checksum inválido. Esperado: ${release.checksumSha256}, real: $actual');
      }
    }
    return bytes;
  }

  /// Extrae el ZIP a {vault}/.obsidian/plugins/m-nexus/.
  /// Crea todas las carpetas necesarias para M-NEXUS.
  Future<InstallResult> installTo(String vaultPath, Uint8List zipBytes) async {
    final createdFolders = <String>[];
    final installedFiles = <String>[];

    // 1) Asegurar .obsidian/plugins/
    final pluginsRoot = p.join(vaultPath, '.obsidian', 'plugins', pluginFolderName);
    await _ensureDir(pluginsRoot, createdFolders);

    // 2) Extraer ZIP
    final archive = ZipDecoder().decodeBytes(zipBytes);
    for (final file in archive) {
      final name = file.name;
      if (!file.isFile) continue;
      // Limpiar prefijos comunes del ZIP
      final cleanName = _stripPrefixes(name);
      if (cleanName == null) continue;
      // Solo los archivos esenciales del plugin van a plugins/m-nexus/
      if (cleanName == 'main.js' ||
          cleanName == 'manifest.json' ||
          cleanName == 'styles.css' ||
          cleanName == 'versions.json' ||
          cleanName == 'README.md' ||
          cleanName.startsWith('data/')) {
        final destPath = p.join(pluginsRoot, cleanName);
        if (cleanName.contains('/')) {
          final dir = p.dirname(destPath);
          await _ensureDir(dir, createdFolders);
        }
        await File(destPath).writeAsBytes(file.content as List<int>);
        installedFiles.add(destPath);
      }
    }

    // 3) Crear carpetas internas de M-NEXUS
    for (final rel in requiredFolders) {
      final full = p.join(vaultPath, rel);
      await _ensureDir(full, createdFolders);
    }

    // 4) Verificar manifest.json
    final manifestFile = File(p.join(pluginsRoot, 'manifest.json'));
    if (!await manifestFile.exists()) {
      return InstallResult(
        status: InstallStatus.error,
        errorMessage: 'No se encontró manifest.json tras la extracción',
        createdFolders: createdFolders,
        installedFiles: installedFiles,
      );
    }
    final manifestContent = await manifestFile.readAsString();
    final versionMatch = RegExp(r'"version"\s*:\s*"([^"]+)"').firstMatch(manifestContent);
    final version = versionMatch?.group(1);

    return InstallResult(
      status: InstallStatus.success,
      installedVersion: version,
      createdFolders: createdFolders,
      installedFiles: installedFiles,
    );
  }

  /// Helper: asegura que un directorio existe (recursivo).
  Future<void> _ensureDir(String path, List<String> createdLog) async {
    final dir = Directory(path);
    if (await dir.exists()) return;
    await dir.create(recursive: true);
    createdLog.add(path);
  }

  /// Quita prefijos comunes del ZIP (m-nexus/, m-nexus-v0.x/, etc.).
  String? _stripPrefixes(String name) {
    if (name.contains('..')) return null;
    final parts = name.split('/');
    // Quitar el primer segmento si parece raíz del repo
    if (parts[0].startsWith('m-nexus') || parts[0] == 'm-nexus-obsidian') {
      return parts.sublist(1).join('/');
    }
    return name;
  }

  void dispose() {
    _http.close();
  }
}

// PluginInstaller: descarga el ZIP del plugin, lo extrae a
// {vault}/.obsidian/plugins/m-nexus/, crea las carpetas internas
// necesarias, y ACTIVA el plugin editando community-plugins.json.
//
// v0.36 (auto-activate):
//   Antes: solo creaba las carpetas y copiaba los archivos
//          → Obsidian no reconocía el plugin hasta que el usuario
//            lo activaba manualmente
//   Ahora: edita .obsidian/community-plugins.json para añadir
//          "m-nexus" a la lista, de forma que al próximo launch
//          de Obsidian el plugin ya está activado.
//
// Pasos del installTo():
//   1) Asegurar .obsidian/plugins/m-nexus/ existe
//   2) Extraer ZIP (main.js, manifest.json, styles.css)
//   3) Crear carpetas internas (_M-NEXUS/...)
//   4) Verificar manifest.json
//   5) **NUEVO**: leer .obsidian/community-plugins.json
//   6) **NUEVO**: añadir "m-nexus" a la lista (si no está)
//   7) **NUEVO**: escribir el JSON de vuelta
//   8) Verificar resultado

import 'dart:convert';
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

  /// Extrae el ZIP a {vault}/.obsidian/plugins/m-nexus/, crea las
  /// carpetas internas, y ACTIVA el plugin en community-plugins.json.
  Future<InstallResult> installTo(String vaultPath, Uint8List zipBytes) async {
    final createdFolders = <String>[];
    final installedFiles = <String>[];

    // 1) Asegurar .obsidian/plugins/m-nexus/
    final pluginsRoot = p.join(vaultPath, '.obsidian', 'plugins', pluginFolderName);
    await _ensureDir(pluginsRoot, createdFolders);

    // 2) Extraer ZIP
    final archive = ZipDecoder().decodeBytes(zipBytes);
    for (final file in archive) {
      final name = file.name;
      if (!file.isFile) continue;
      final cleanName = _stripPrefixes(name);
      if (cleanName == null) continue;
      // Solo los archivos esenciales van a plugins/m-nexus/
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

    // 5) v0.36: ACTIVAR el plugin en community-plugins.json
    final activateResult = await activatePluginInCommunityFile(vaultPath);
    if (activateResult.error != null) {
      // No es fatal (los archivos ya están copiados), pero avisamos
      return InstallResult(
        status: InstallStatus.success,
        installedVersion: version,
        createdFolders: createdFolders,
        installedFiles: installedFiles,
        activated: false,
        errorMessage: 'Plugin instalado, pero no se pudo activar automáticamente: ${activateResult.error}',
        communityPluginsPath: activateResult.filePath,
      );
    }

    return InstallResult(
      status: InstallStatus.success,
      installedVersion: version,
      createdFolders: createdFolders,
      installedFiles: installedFiles,
      activated: activateResult.added,
      alreadyEnabled: activateResult.alreadyEnabled,
      communityPluginsPath: activateResult.filePath,
    );
  }

  /// Activa el plugin en .obsidian/community-plugins.json.
  ///
  /// Lee el JSON (que es una lista de strings con los IDs de plugins
  /// habilitados), añade "m-nexus" si no está, y lo escribe de vuelta.
  ///
  /// Si el archivo no existe, lo crea con ["m-nexus"].
  /// Si la carpeta .obsidian no existe, la crea.
  /// Si el JSON está corrupto, hace backup y crea uno nuevo.
  Future<CommunityPluginsResult> activatePluginInCommunityFile(String vaultPath) async {
    final obsidianDir = p.join(vaultPath, '.obsidian');
    final filePath = p.join(obsidianDir, 'community-plugins.json');

    try {
      // 1) Asegurar que .obsidian/ existe
      await Directory(obsidianDir).create(recursive: true);

      // 2) Leer archivo actual (o crear uno nuevo)
      List<String> plugins = [];
      final file = File(filePath);
      if (await file.exists()) {
        try {
          final content = await file.readAsString();
          if (content.trim().isNotEmpty) {
            final decoded = jsonDecode(content);
            if (decoded is List) {
              plugins = decoded.map((e) => e.toString()).toList();
            }
          }
        } catch (e) {
          // JSON corrupto: hacer backup y crear uno nuevo
          final backupPath = '$filePath.bak.${DateTime.now().millisecondsSinceEpoch}';
          await file.copy(backupPath);
          plugins = [];
        }
      }

      // 3) Verificar si ya está habilitado
      if (plugins.contains(pluginFolderName)) {
        return CommunityPluginsResult(
          added: false,
          alreadyEnabled: true,
          filePath: filePath,
        );
      }

      // 4) Añadir "m-nexus" a la lista
      plugins.add(pluginFolderName);

      // 5) Escribir de vuelta (formato pretty para que sea legible)
      final encoder = JsonEncoder.withIndent('  ');
      await file.writeAsString(encoder.convert(plugins));

      return CommunityPluginsResult(
        added: true,
        alreadyEnabled: false,
        filePath: filePath,
      );
    } catch (e) {
      return CommunityPluginsResult(
        added: false,
        alreadyEnabled: false,
        filePath: filePath,
        error: e.toString(),
      );
    }
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
    if (parts[0].startsWith('m-nexus') || parts[0] == 'm-nexus-obsidian') {
      return parts.sublist(1).join('/');
    }
    return name;
  }

  void dispose() {
    _http.close();
  }
}

/// Resultado de activar el plugin en community-plugins.json.
class CommunityPluginsResult {
  final bool added;
  final bool alreadyEnabled;
  final String filePath;
  final String? error;

  const CommunityPluginsResult({
    required this.added,
    required this.alreadyEnabled,
    required this.filePath,
    this.error,
  });

  bool get ok => error == null;
}

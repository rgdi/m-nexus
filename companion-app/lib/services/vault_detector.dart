// Detector de vaults de Obsidian en el dispositivo Android.
// v0.34: rutas ampliadas y mejor manejo de MANAGE_EXTERNAL_STORAGE.
//
// Rutas escaneadas (en orden):
//   1. /storage/emulated/0/Documents/* (default Obsidian)
//   2. /storage/emulated/0/ (root, si MANAGE_EXTERNAL_STORAGE)
//   3. External storage (getExternalStorageDirectory())
//   4. App-specific storage (getApplicationDocumentsDirectory)
//   5. SAF (Storage Access Framework) - ruta seleccionada por el usuario
//
// Si no se encuentran vaults automáticamente, el usuario puede:
//   - Pulsar "Elegir manualmente" para abrir SAF
//   - Conceder MANAGE_EXTERNAL_STORAGE para /sdcard completo

import 'dart:io';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class VaultInfo {
  final String path;
  final String name;
  final bool hasObsidianFolder;
  final String? installedPluginVersion;
  final String? detectionMethod;     // "auto" | "documents" | "external" | "app" | "saf"

  const VaultInfo({
    required this.path,
    required this.name,
    required this.hasObsidianFolder,
    this.installedPluginVersion,
    this.detectionMethod,
  });
}

class VaultDetector {
  /// Devuelve los vaults candidatos detectados en el dispositivo.
  Future<List<VaultInfo>> detectVaults() async {
    final candidates = <String>[];
    final methods = <String, String>{};  // path -> method

    // 1) /storage/emulated/0/Documents (default Obsidian en Android)
    await _scanDir('/storage/emulated/0/Documents', candidates, methods, 'documents');

    // 2) Root /storage/emulated/0 (requiere MANAGE_EXTERNAL_STORAGE en Android 11+)
    await _scanDir('/storage/emulated/0', candidates, methods, 'root', maxDepth: 2);

    // 3) External storage directory
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        await _scanDir(ext.path, candidates, methods, 'external');
      }
    } catch (_) {}

    // 4) App-specific storage
    try {
      final app = await getApplicationDocumentsDirectory();
      await _scanDir(app.path, candidates, methods, 'app');
    } catch (_) {}

    // 5) SAF vault seleccionado manualmente
    try {
      final prefs = await _loadSafPath();
      if (prefs != null) {
        await _scanDir(prefs, candidates, methods, 'saf');
      }
    } catch (_) {}

    // Deduplicar
    final unique = <String>[];
    for (final c in candidates) {
      if (!unique.contains(c)) unique.add(c);
    }

    // Construir VaultInfo
    final result = <VaultInfo>[];
    for (final path in unique) {
      final installedVersion = await _readInstalledVersion(path);
      result.add(VaultInfo(
        path: path,
        name: p.basename(path),
        hasObsidianFolder: true,
        installedPluginVersion: installedVersion,
        detectionMethod: methods[path],
      ));
    }
    return result;
  }

  /// v0.34: añade un path SAF persistente al escaneo.
  Future<void> addSafPath(String path) async {
    final prefs = await _loadSafMap();
    prefs['default'] = path;
    await _saveSafMap(prefs);
  }

  Future<void> removeSafPath() async {
    final prefs = await _loadSafMap();
    prefs.remove('default');
    await _saveSafMap(prefs);
  }

  Future<Map<String, String>> _loadSafMap() async {
    // Re-uso de SharedPreferences (importado por path_provider transitivamente)
    try {
      const channel = MethodChannel('com.mnexus.installer/vault');
      final raw = await channel.invokeMethod<String>('getSafPath');
      if (raw == null || raw.isEmpty) return {};
      return {'default': raw};
    } catch (_) {
      return {};
    }
  }

  Future<void> _saveSafMap(Map<String, String> map) async {
    try {
      const channel = MethodChannel('com.mnexus.installer/vault');
      await channel.invokeMethod('setSafPath', {'path': map['default'] ?? ''});
    } catch (_) {}
  }

  Future<String?> _loadSafPath() async {
    final map = await _loadSafMap();
    return map['default'];
  }

  Future<void> _scanDir(
    String path,
    List<String> candidates,
    Map<String, String> methods,
    String methodName, {
    int maxDepth = 1,
  }) async {
    try {
      final dir = Directory(path);
      if (!await dir.exists()) return;
      await for (final entity in dir.list(followLinks: false)) {
        if (entity is Directory) {
          final obsDir = Directory(p.join(entity.path, '.obsidian'));
          if (await obsDir.exists()) {
            candidates.add(entity.path);
            methods[entity.path] = methodName;
          } else if (maxDepth > 1) {
            // Recursar un nivel más
            await _scanDir(
              entity.path,
              candidates,
              methods,
              methodName,
              maxDepth: maxDepth - 1,
            );
          }
        }
      }
    } catch (_) {
      // Permiso denegado o dir inaccesible
    }
  }

  Future<String?> _readInstalledVersion(String vaultPath) async {
    try {
      final manifest = File(p.join(vaultPath, '.obsidian', 'plugins', 'm-nexus', 'manifest.json'));
      if (!await manifest.exists()) return null;
      final content = await manifest.readAsString();
      final match = RegExp(r'"version"\s*:\s*"([^"]+)"').firstMatch(content);
      return match?.group(1);
    } catch (_) {
      return null;
    }
  }
}

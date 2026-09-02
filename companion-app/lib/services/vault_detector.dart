// Detector de vaults de Obsidian en el dispositivo Android.
// v0.8: usamos los public storage directories. Obsidian en Android
// guarda vaults en /storage/emulated/0/Documents/ o en
// /Android/data/md.obsidian/files/

import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

class VaultInfo {
  final String path;
  final String name;
  final bool hasObsidianFolder;
  final String? installedPluginVersion;

  const VaultInfo({
    required this.path,
    required this.name,
    required this.hasObsidianFolder,
    this.installedPluginVersion,
  });
}

class VaultDetector {
  /// Devuelve los vaults candidatos detectados en el dispositivo.
  Future<List<VaultInfo>> detectVaults() async {
    final candidates = <String>[];

    // 1) /storage/emulated/0/Documents (default Obsidian en Android)
    try {
      final docs = Directory('/storage/emulated/0/Documents');
      if (await docs.exists()) {
        await for (final entity in docs.list()) {
          if (entity is Directory) {
            final hasObsidian = Directory(p.join(entity.path, '.obsidian')).existsSync();
            if (hasObsidian) {
              candidates.add(entity.path);
            }
          }
        }
      }
    } catch (_) {}

    // 2) External storage root
    try {
      final ext = await getExternalStorageDirectory();
      if (ext != null) {
        await for (final entity in ext.list()) {
          if (entity is Directory && !candidates.contains(entity.path)) {
            final hasObsidian = Directory(p.join(entity.path, '.obsidian')).existsSync();
            if (hasObsidian) {
              candidates.add(entity.path);
            }
          }
        }
      }
    } catch (_) {}

    // 3) App-specific storage (donde Obsidian guarda vaults privados)
    try {
      final app = await getApplicationDocumentsDirectory();
      await for (final entity in app.list()) {
        if (entity is Directory && !candidates.contains(entity.path)) {
          final hasObsidian = Directory(p.join(entity.path, '.obsidian')).existsSync();
          if (hasObsidian) {
            candidates.add(entity.path);
          }
        }
      }
    } catch (_) {}

    // Construir VaultInfo
    final result = <VaultInfo>[];
    for (final path in candidates) {
      final installedVersion = await _readInstalledVersion(path);
      result.add(VaultInfo(
        path: path,
        name: p.basename(path),
        hasObsidianFolder: true,
        installedPluginVersion: installedVersion,
      ));
    }
    return result;
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
